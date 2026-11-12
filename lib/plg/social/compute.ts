/**
 * Social video tab view model. Pure: Sigma rows (lib/plg/social/sql.ts) +
 * YouTube documents (scripts/sync-youtube.mjs) in, render-ready numbers out.
 */
import { addDays, daysBetween, type ISODate } from '../dates'
import { ACTIVATION_DAYS, CHANNELS, CREATOR_WINDOW_DAYS, NOT_TRACKED, VISIT_GROUPS, YT_WORKSPACE_GROUPS } from './config'
import type { SocialRanges, SocialScope } from './sql'

export interface YtVideo {
  id: string; title: string; published: ISODate; durationSec: number; lifetimeViews: number
  link: { kind: 'tagged' | 'offer' | 'short' | 'untagged' | 'none'; url: string | null; campaign: string | null }
  daily: [ISODate, number, number][]
}
export interface YtChannelDoc {
  channelId: string; key: string; title: string; handle: string; subscribers: number
  fetchedAt: string; daily: [ISODate, number, number, number, number][]; videos: YtVideo[]
}

type Row = { k: string; b: string; d: string; g: string; n: number; a: number; p: number; x: number; c: number; h: number; t: number[] }

export function parseSocialRows(payload: unknown): Row[] {
  const tbl = payload as { columns: string[]; rows: unknown[][] }
  if (!tbl || !Array.isArray(tbl.columns) || !Array.isArray(tbl.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(tbl.columns.map((c, i) => [c, i]))
  const s = (r: unknown[], c: string) => String(r[ix[c]] ?? '')
  const n = (r: unknown[], c: string) => Number(r[ix[c]] ?? 0) || 0
  return tbl.rows.map(r => ({
    k: s(r, 'k'), b: s(r, 'b'), d: s(r, 'd').slice(0, 10), g: s(r, 'g'),
    n: n(r, 'n'), a: n(r, 'a'), p: n(r, 'p'), x: n(r, 'x'), c: n(r, 'c'), h: n(r, 'h'),
    t: ['t1', 't2', 't3', 't4', 't5'].map(c => n(r, c)),
  }))
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null)
const rate = (a: number, b: number) => (b > 0 ? a / b : null)

function ytViews(docs: YtChannelDoc[], [s, e]: [ISODate, ISODate]) {
  let views = 0; let minutes = 0; let subs = 0
  for (const doc of docs) for (const [d, v, m, g, l] of doc.daily) if (d >= s && d <= e) { views += v; minutes += m; subs += g - l }
  return { views, minutes, subs }
}

export function buildSocial(opts: {
  scope: SocialScope; ranges: SocialRanges; rows: Row[]; yt: YtChannelDoc[]
}) {
  const { scope, ranges, rows } = opts
  const peterDoc = opts.yt.filter(d => d.channelId === CHANNELS.find(c => c.id === 'peter')!.youtubeId)
  const ytDocs = scope === 'peter' ? peterDoc : opts.yt
  const pick = (k: string, b?: string, g?: string) => rows.filter(r => r.k === k && (b == null || r.b === b) && (g == null || r.g === g))
  const total = (k: string, b: string, g?: string) => sum(pick(k, b, g).map(r => r.n))
  const visitGroup = scope === 'peter' ? 'peter' : undefined

  // ── Reach (YouTube) ────────────────────────────────────────────────────────
  // YouTube Analytics runs ~2 days behind. Compare like with like: clip the
  // current range to the last reported day and the previous range to the same length.
  const ytLastDay = ytDocs.flatMap(d => d.daily.map(r => r[0])).sort().at(-1) ?? null
  const ytLagging = ytLastDay != null && ytLastDay < ranges.cur[1]
  const ytCurRange: [ISODate, ISODate] = ytLagging ? [ranges.cur[0], ytLastDay!] : ranges.cur
  const ytDays = ytCurRange[1] >= ytCurRange[0] ? daysBetween(...ytCurRange) : 0
  const ytPrevRange: [ISODate, ISODate] = [ranges.prev[0], addDays(ranges.prev[0], Math.max(0, ytDays - 1))]
  const ytCur = ytDays ? ytViews(ytDocs, ytCurRange) : { views: 0, minutes: 0, subs: 0 }
  const ytPrev = ytDays ? ytViews(ytDocs, ytPrevRange) : { views: 0, minutes: 0, subs: 0 }

  // ── Site visits / offer page / captures ────────────────────────────────────
  const visitors = { cur: total('vis', 'cur', visitGroup), prev: total('vis', 'prev', visitGroup) }
  const offer = { cur: total('visw', 'cur', visitGroup), prev: total('visw', 'prev', visitGroup) }
  const forms = {
    cur: scope === 'peter' ? total('form', 'cur', 'peter') : total('form', 'cur'),
    prev: scope === 'peter' ? total('form', 'prev', 'peter') : total('form', 'prev'),
  }

  // ── Workspaces ─────────────────────────────────────────────────────────────
  const wsAgg = (b: string) => {
    const rs = pick('ws', b)
    return {
      n: sum(rs.map(r => r.n)), act: sum(rs.map(r => r.a)), paid: sum(rs.map(r => r.p)), exp: sum(rs.map(r => r.x)),
      churn: sum(rs.map(r => r.c)), hq: sum(rs.map(r => r.h)), tiers: [0, 1, 2, 3, 4].map(i => sum(rs.map(r => r.t[i]))),
    }
  }
  const ws = { cur: wsAgg('cur'), prev: wsAgg('prev') }
  const existing = scope === 'peter'
    ? { cur: total('exist', 'cur'), prev: total('exist', 'prev'), tiers: [0, 1, 2, 3, 4].map(i => sum(pick('exist', 'cur').map(r => r.t[i]))) }
    : null
  const mention = scope === 'all' ? { cur: total('mention', 'cur'), prev: total('mention', 'prev') } : null
  const activationMatured = addDays(ranges.cur[1], ACTIVATION_DAYS) <= addDays(new Date().toISOString().slice(0, 10), -1)

  // ── Funnel ─────────────────────────────────────────────────────────────────
  type Step = { id: string; stage: string; label: string; lever: string; source: string; cur: number | null; prev: number | null; rate: number | null; prevRate: number | null; note?: string }
  const step = (s: Omit<Step, 'rate' | 'prevRate'>, base?: Step): Step => ({
    ...s,
    rate: base && s.cur != null && base.cur != null ? rate(s.cur, base.cur) : null,
    prevRate: base && s.prev != null && base.prev != null ? rate(s.prev, base.prev) : null,
  })
  const views = step({ id: 'views', stage: 'Reach', label: 'YouTube views', lever: 'Topic, thumbnail & title, cadence', source: 'YouTube Analytics API', cur: ytCur.views, prev: ytPrev.views,
    note: ytLagging ? `YouTube reports through ${ytLastDay}; both periods compared over the same ${ytDays} days` : undefined })
  const visits = step({ id: 'visits', stage: 'Click', label: scope === 'peter' ? 'Visitors from Peter’s links' : 'Visitors from YouTube', lever: 'CTA: description link, pinned comment, mention', source: 'Snowflake · MARKETING_PAGEVIEWS', cur: visitors.cur, prev: visitors.prev,
    note: scope === 'all' ? 'Includes affiliate and untagged YouTube links, not only the channels above' : 'pk_yt_* tagged links + offer-page clicks from YouTube' }, views)
  const offerStep = step({ id: 'offer', stage: 'Click', label: 'Offer page visitors (/wedge)', lever: 'Where the link sends people', source: 'Snowflake · MARKETING_PAGEVIEWS', cur: offer.cur, prev: offer.prev }, visits)
  const formStep = step({ id: 'forms', stage: 'Capture', label: 'Offer page form submits', lever: 'Offer page headline & form', source: 'Snowflake · SEGMENT.VERCEL.FORM_SUBMITTED', cur: forms.cur, prev: forms.prev,
    note: 'People, not submissions. No email is captured, so these cannot be qualified yet' }, offerStep)
  const wsStep = step({ id: 'ws', stage: 'Workspaces', label: scope === 'peter' ? `New workspaces (≤${CREATOR_WINDOW_DAYS} days after a click)` : 'New workspaces credited to YouTube', lever: 'Signup flow', source: 'Snowflake · blended attribution', cur: ws.cur.n, prev: ws.prev.n,
    note: scope === 'all' ? 'Blended first-touch model; most are credited from the signup survey, not a tracked click' : 'Matched by website cookie, so only visitors who signed up on the same browser count' }, scope === 'peter' ? visits : undefined)
  const actStep = step({ id: 'act', stage: 'Workspaces', label: `Activated within ${ACTIVATION_DAYS} days`, lever: 'Onboarding', source: 'Snowflake · golden table (2+ advanced, 1+ basic enrichments)', cur: ws.cur.act, prev: ws.prev.act,
    note: activationMatured ? undefined : `Workspaces from the last ${ACTIVATION_DAYS} days are still inside their activation window` }, wsStep)
  const paidStep = step({ id: 'paid', stage: 'Workspaces', label: 'Paid', lever: 'Pricing & upgrade prompts', source: 'Snowflake · CUSTOMERS first invoice', cur: ws.cur.paid, prev: ws.prev.paid }, wsStep)
  const funnel = scope === 'peter' ? [views, visits, offerStep, formStep, wsStep, actStep, paidStep] : [views, visits, offerStep, formStep, wsStep, actStep, paidStep]

  // ── Trend ──────────────────────────────────────────────────────────────────
  const days = daysBetween(...ranges.cur)
  const series = (metric: 'views' | 'visitors' | 'workspaces', [s]: [ISODate, ISODate]) => Array.from({ length: days }, (_, i) => {
    const d = addDays(s, i)
    if (metric === 'views') return { d, v: sum(ytDocs.map(doc => doc.daily.find(r => r[0] === d)?.[1] ?? 0)) }
    if (metric === 'visitors') return { d, v: sum(rows.filter(r => r.k === 'vday' && r.d === d && (!visitGroup || r.g === visitGroup)).map(r => r.n)) }
    return { d, v: sum(rows.filter(r => r.k === 'wsday' && r.d === d).map(r => r.n)) }
  })
  const trend = (['views', 'visitors', 'workspaces'] as const).map(m => ({
    metric: m, cur: series(m, ranges.cur), prev: series(m, ranges.prev).slice(0, days),
  }))

  // ── Sources (All) ──────────────────────────────────────────────────────────
  const sources = scope === 'all' ? VISIT_GROUPS.map(g => {
    const ch = CHANNELS.find(c => c.id === g.id)
    const doc = ch?.youtubeId ? opts.yt.find(d => d.channelId === ch.youtubeId) : undefined
    return {
      id: g.id, label: g.label,
      views: doc ? ytViews([doc], ytCurRange).views : null,
      visitors: total('vis', 'cur', g.id), prevVisitors: total('vis', 'prev', g.id),
      offer: total('visw', 'cur', g.id),
      forms: g.id === 'peter' ? total('form', 'cur', 'peter') : null,
    }
  }) : null
  const wsSources = scope === 'all' ? YT_WORKSPACE_GROUPS.map(g => {
    const c = pick('ws', 'cur', g.id); const p = pick('ws', 'prev', g.id)
    return { id: g.id, label: g.label, cur: sum(c.map(r => r.n)), prev: sum(p.map(r => r.n)), act: sum(c.map(r => r.a)), paid: sum(c.map(r => r.p)), hq: sum(c.map(r => r.h)) }
  }).filter(r => r.cur || r.prev) : null

  // ── After signup ───────────────────────────────────────────────────────────
  const plans = pick('plan', 'cur').map(r => ({ plan: r.g === 'Other' ? 'Free / other' : r.g, n: r.n, paid: r.p, exp: r.x, churn: r.c }))
    .sort((a, b) => b.n - a.n)
  const months = pick('month', 'cur').map(r => ({ month: r.g, n: r.n, act: r.a, paid: r.p, exp: r.x, churn: r.c, hq: r.h })).sort((a, b) => a.month.localeCompare(b.month))
  const outcome = {
    free: ws.cur.n - ws.cur.paid, paidOnly: ws.cur.paid - ws.cur.exp - ws.cur.churn, expanded: ws.cur.exp, churned: ws.cur.churn,
  }
  const personas = pick('persona', 'cur').map(r => ({ label: r.g, n: r.n })).sort((a, b) => b.n - a.n)

  // ── Videos ─────────────────────────────────────────────────────────────────
  const campaignVisitors = new Map(pick('camp', 'cur').map(r => [r.g, r.n]))
  const campaigns = pick('camp', 'cur').map(r => ({ campaign: r.g, visitors: r.n, prev: total('camp', 'prev', r.g) }))
    .concat(pick('camp', 'prev').filter(r => !pick('camp', 'cur', r.g).length).map(r => ({ campaign: r.g, visitors: 0, prev: r.n })))
    .sort((a, b) => b.visitors - a.visitors || b.prev - a.prev)
  const videos = ytDocs.flatMap(doc => doc.videos.map(v => {
    const inRange = (r: [ISODate, ISODate]) => v.daily.filter(x => x[0] >= r[0] && x[0] <= r[1])
    const c = inRange(ytCurRange); const p = inRange(ytPrevRange)
    return {
      id: v.id, title: v.title, published: v.published, channel: doc.title, durationSec: v.durationSec,
      views: sum(c.map(x => x[1])), prevViews: sum(p.map(x => x[1])), minutes: sum(c.map(x => x[2])),
      lifetimeViews: v.lifetimeViews, link: v.link,
      trackedVisitors: v.link.campaign ? campaignVisitors.get(v.link.campaign) ?? null : null,
    }
  })).sort((a, b) => b.views - a.views || b.published.localeCompare(a.published))

  return {
    scope,
    kpis: {
      views: { cur: ytCur.views, prev: ytPrev.views, delta: pct(ytCur.views, ytPrev.views), minutes: ytCur.minutes, subs: ytCur.subs, days: ytDays, lagging: ytLagging },
      visitors: { ...visitors, delta: pct(visitors.cur, visitors.prev), clickRate: rate(visitors.cur, ytCur.views) },
      workspaces: { cur: ws.cur.n, prev: ws.prev.n, delta: pct(ws.cur.n, ws.prev.n), hq: ws.cur.hq, existing: existing?.cur ?? null, mention: mention?.cur ?? null },
      activated: { cur: ws.cur.act, prev: ws.prev.act, delta: pct(ws.cur.act, ws.prev.act), rate: rate(ws.cur.act, ws.cur.n), matured: activationMatured },
      paid: { cur: ws.cur.paid, prev: ws.prev.paid, delta: pct(ws.cur.paid, ws.prev.paid), rate: rate(ws.cur.paid, ws.cur.n), churned: ws.cur.churn },
    },
    yt: { lastDay: ytLastDay, lagging: ytLagging, fetchedAt: ytDocs.map(d => d.fetchedAt).sort()[0] ?? null, channels: ytDocs.map(d => ({ title: d.title, handle: d.handle, subscribers: d.subscribers })) },
    funnel, notTracked: NOT_TRACKED, trend, sources, wsSources, campaigns, offerVisitors: offer.cur,
    outcome, plans, months, personas,
    tiers: { labels: ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Unmatched'], fresh: ws.cur.tiers, existing: existing?.tiers ?? null },
    videos,
  }
}

export type SocialView = ReturnType<typeof buildSocial>
