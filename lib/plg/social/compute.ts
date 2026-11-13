/**
 * Social tab view model. Pure: Sigma rows (sql.ts) + YouTube documents
 * (scripts/sync-youtube.mjs) in, render-ready numbers out.
 *
 * Anything blocked on access is null and renders "Not connected": impressions
 * and impression CTR everywhere, and views / watch time for channels without
 * Analytics access. Nothing downstream substitutes a value.
 */
import { addDays, daysBetween, minDate, type ISODate } from '../dates'
import { CHANNELS, COHORT_DAYS, OFFER_PAGE_PATTERNS, STEP_GOALS, TIER_LABELS, type CreatorChannel } from './config'
import type { ChannelFallback, TaggedVideo } from './sql'

export interface YtVideo {
  id: string; title: string; published: ISODate; durationSec: number; lifetimeViews: number
  campaign: string | null
  destination: string | null
  destinationKind: 'clay' | 'short_unresolved' | 'external' | 'none'
  links: { url: string; kind: string; campaign: string | null }[]
  /** [day, views, minutes, avgViewPct, subsGained] */
  daily: [ISODate, number, number, number, number][]
  cohort28: { start: ISODate; end: ISODate; days: number; views: number; minutes: number; avgViewPct: number; subsGained: number } | null
}
export interface YtChannelDoc {
  channelId: string; key: string; title: string; handle: string; subscribers: number; videoCount: number
  fetchedAt: string
  /** false = no Viewer access; views/watch time unknown (Data API metadata only). */
  analyticsAccess?: boolean
  /** [day, views, minutes, subsGained, subsLost, avgViewPct] */
  daily: [ISODate, number, number, number, number, number][]
  videos: YtVideo[]
}

export type CreatorId = CreatorChannel['id']
export type SocialScope = 'all' | CreatorId
export type SocialMode = 'calendar' | 'cohort'
type Row = { k: string; b: string; key: string; d: string; n: number; a: number; p: number; x: number; c: number; t: number[] }

export function parseSocialRows(payload: unknown): Row[] {
  const tbl = payload as { columns: string[]; rows: unknown[][] }
  if (!tbl || !Array.isArray(tbl.columns) || !Array.isArray(tbl.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(tbl.columns.map((c, i) => [c, i]))
  const s = (r: unknown[], c: string) => String(r[ix[c]] ?? '')
  const n = (r: unknown[], c: string) => Number(r[ix[c]] ?? 0) || 0
  return tbl.rows.map(r => ({
    k: s(r, 'k'), b: s(r, 'b'), key: s(r, 'key'), d: s(r, 'k') === 'vday' || s(r, 'k') === 'wsday' ? s(r, 'd').slice(0, 10) : s(r, 'd'),
    n: n(r, 'n'), a: n(r, 'a'), p: n(r, 'p'), x: n(r, 'x'), c: n(r, 'c'), t: ['t1', 't2', 't3', 't4', 't5'].map(c => n(r, c)),
  }))
}

const channelOf = (doc: YtChannelDoc) => CHANNELS.find(c => c.youtubeId === doc.channelId) ?? null
const cohortEnd = (published: ISODate, dataEnd: ISODate) => minDate(addDays(published, COHORT_DAYS - 1), dataEnd)

/** Videos whose description link carries a utm_campaign; the SQL maps campaign → video. */
export function taggedVideos(docs: YtChannelDoc[], dataEnd: ISODate): TaggedVideo[] {
  return docs.flatMap(doc => doc.videos.filter(v => v.campaign).map(v => ({
    videoId: v.id, campaign: v.campaign!, cohortStart: v.published, cohortEnd: cohortEnd(v.published, dataEnd),
    requireSource: channelOf(doc)?.requireSource ?? null,
  })))
}

/** Channel rules for traffic Snowflake stored without its campaign. One linked video → that video; else the channel. */
export function channelFallbacks(docs: YtChannelDoc[], dataEnd: ISODate): ChannelFallback[] {
  return docs.flatMap(doc => {
    const ch = channelOf(doc)
    if (!ch?.fallback) return []
    const linked = doc.videos.filter(v => v.campaign)
    const only = linked.length === 1 ? linked[0] : null
    const first = [...doc.videos].map(v => v.published).sort()[0] ?? dataEnd
    return [{
      key: only ? only.id : `ch:${ch.id}`,
      cohortStart: only ? only.published : first, cohortEnd: only ? cohortEnd(only.published, dataEnd) : dataEnd,
      pageview: ch.fallback.pageview, firstTouch: ch.fallback.firstTouch,
    }]
  })
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (cur: number | null, prev: number | null) => (cur != null && prev ? (cur - prev) / prev : null)
const rate = (a: number | null, b: number | null) => (a != null && b ? a / b : null)
const zeroT = () => [0, 0, 0, 0, 0]
const addT = (a: number[], b: number[]) => a.map((x, i) => x + (b[i] ?? 0))
/** A video counts for a period while it is in its first COHORT_DAYS days during that period. */
const inCohort = (published: ISODate, [s, e]: [ISODate, ISODate]) => published <= e && addDays(published, COHORT_DAYS - 1) >= s
const nsum = (xs: (number | null)[]) => (xs.some(x => x == null) ? null : sum(xs as number[]))

export function buildSocial(o: {
  scope: SocialScope; mode: SocialMode; cur: [ISODate, ISODate]; prev: [ISODate, ISODate]
  dataEnd: ISODate; rows: Row[]; yt: YtChannelDoc[]
}) {
  const { rows } = o
  const one = (k: string, b: string, key: string) => {
    const rs = rows.filter(r => r.k === k && r.b === b && r.key === key)
    return { n: sum(rs.map(r => r.n)), a: sum(rs.map(r => r.a)), p: sum(rs.map(r => r.p)), x: sum(rs.map(r => r.x)), c: sum(rs.map(r => r.c)), t: rs.reduce((acc, r) => addT(acc, r.t), zeroT()) }
  }
  const fallbackKeys = new Set(channelFallbacks(o.yt, o.dataEnd).map(f => f.key))
  /** Device / geo cut over the given keys, each video in its first 28 days. */
  function cutOf(k: 'dev' | 'geo', keys: string[]) {
    const m = new Map<string, { name: string; visits: number; captures: number; newWs: number }>()
    for (const r of rows) {
      if (r.k !== k || r.b !== 'coh' || !keys.includes(r.key)) continue
      const e = m.get(r.d) ?? { name: r.d, visits: 0, captures: 0, newWs: 0 }
      e.visits += r.n; e.captures += r.a; e.newWs += r.p
      m.set(r.d, e)
    }
    return [...m.values()].sort((a, b) => (a.name === 'Unknown' ? 1 : b.name === 'Unknown' ? -1 : b.visits - a.visits))
  }

  function plansOf(rs: Row[]) {
    const m = new Map<string, { plan: string; n: number; paid: number; exp: number; churn: number }>()
    for (const r of rs) {
      const plan = r.d === 'Other' || !r.d ? 'Free / other' : r.d
      const e = m.get(plan) ?? { plan, n: 0, paid: 0, exp: 0, churn: 0 }
      e.n += r.n; e.paid += r.p; e.exp += r.x; e.churn += r.c
      m.set(plan, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }

  // ── Per-channel model ──────────────────────────────────────────────────────
  const channels = CHANNELS.map(ch => {
    const doc = o.yt.find(d => d.channelId === ch.youtubeId) ?? null
    if (!doc) return { ch, doc: null }
    const analytics = doc.analyticsAccess !== false
    const tracked = (v: YtVideo) => !!v.campaign || fallbackKeys.has(v.id)
    const videos = doc.videos.map(v => {
      const isTracked = tracked(v)
      const coh = v.cohort28
      const vis = isTracked ? one('vis', 'coh', v.id) : null
      const form = isTracked ? one('form', 'coh', v.id) : null
      const ws = isTracked ? one('ws', 'coh', v.id) : null
      const ex = isTracked ? one('ex', 'coh', v.id) : null
      const cohortDay = Math.min(COHORT_DAYS, Math.max(0, daysBetween(v.published, o.dataEnd)))
      const views = analytics ? (coh?.views || null) : null
      const offerPage = !!v.destination && OFFER_PAGE_PATTERNS.some(re => re.test(v.destination!))
      return {
        id: v.id, title: v.title, published: v.published, channel: ch.label, durationSec: v.durationSec,
        cohortDay, cohortComplete: cohortDay >= COHORT_DAYS, analytics, lifetimeViews: v.lifetimeViews,
        impressions: null as number | null, ctr: null as number | null,
        views, viewsPending: analytics && !coh?.views, minutes: coh?.minutes ?? 0, avgViewPct: analytics && coh ? coh.avgViewPct / 100 : null, subsGained: coh?.subsGained ?? 0,
        destination: v.destination, campaign: v.campaign, tagged: isTracked, offerPage,
        visits: vis?.n ?? null, captures: offerPage && form ? form.n : null,
        newWs: ws?.n ?? null, activated: ws?.a ?? null, paid: ws?.p ?? null, expanded: ws?.x ?? null, churned: ws?.c ?? null,
        visitRate: isTracked && views ? (vis?.n ?? 0) / views : null,
        captureRate: offerPage && vis?.n ? (form?.n ?? 0) / vis.n : null,
        wsRate: isTracked ? (offerPage ? rate(ws?.n ?? 0, form?.n ?? null) : rate(ws?.n ?? 0, vis?.n ?? null)) : null,
        tiersNew: ws?.t ?? null, existing: ex?.n ?? null, tiersExisting: ex?.t ?? null,
        device: isTracked ? cutOf('dev', [v.id]) : [], geo: isTracked ? cutOf('geo', [v.id]) : [],
      }
    }).sort((a, b) => b.published.localeCompare(a.published))
    const keys = new Set([...doc.videos.map(v => v.id), `ch:${ch.id}`])
    return { ch, doc, analytics, videos, keys }
  })
  type Ch = Extract<(typeof channels)[number], { videos: unknown }>
  const connected = channels.filter((c): c is Ch => !!c.doc)

  // YouTube Analytics lags ~2 days: clip calendar comparisons to reported days.
  const ytLastDay = connected.filter(c => c.analytics).flatMap(c => c.doc!.daily.map(r => r[0])).sort().at(-1) ?? null
  const ytCurEnd = ytLastDay && ytLastDay < o.cur[1] ? ytLastDay : o.cur[1]
  const ytDays = ytCurEnd >= o.cur[0] ? daysBetween(o.cur[0], ytCurEnd) : 0
  const ytPrevEnd = addDays(o.prev[0], Math.max(0, ytDays - 1))

  /** Totals for one channel, one period. */
  function totals(c: Ch, b: 'cur' | 'prev') {
    const range = b === 'cur' ? o.cur : o.prev
    if (o.mode === 'cohort') {
      const vs = c.videos.filter(v => inCohort(v.published, range))
      const reported = vs.filter(v => v.views)
      const views = !c.analytics ? null : reported.length ? sum(reported.map(v => v.views!)) : (vs.length ? null : 0)
      const tagged = vs.filter(v => v.tagged)
      return {
        videos: vs.length, pending: c.analytics ? vs.length - reported.length : 0,
        views, minutes: sum(vs.map(v => v.minutes)), subs: sum(vs.map(v => v.subsGained)),
        avgPct: views ? sum(reported.map(v => v.views! * (v.avgViewPct ?? 0))) / views : null,
        visits: sum(tagged.map(v => v.visits ?? 0)), captures: sum(tagged.map(v => v.captures ?? 0)),
        newWs: sum(tagged.map(v => v.newWs ?? 0)), activated: sum(tagged.map(v => v.activated ?? 0)), paid: sum(tagged.map(v => v.paid ?? 0)),
        expanded: sum(tagged.map(v => v.expanded ?? 0)), churned: sum(tagged.map(v => v.churned ?? 0)),
        plans: plansOf(rows.filter(r => r.k === 'plan' && r.b === 'coh' && tagged.some(v => v.id === r.key))),
        tiersNew: tagged.reduce((acc, v) => addT(acc, v.tiersNew ?? zeroT()), zeroT()),
        existing: sum(tagged.map(v => v.existing ?? 0)), tiersExisting: tagged.reduce((acc, v) => addT(acc, v.tiersExisting ?? zeroT()), zeroT()),
      }
    }
    const end = b === 'cur' ? ytCurEnd : ytPrevEnd
    const yt = c.analytics && ytDays ? c.doc!.daily.filter(r => r[0] >= range[0] && r[0] <= end) : null
    const views = yt ? sum(yt.map(r => r[1])) : null
    const kr = (k: string) => rows.filter(r => r.k === k && r.b === b && c.keys.has(r.key))
    const ws = kr('ws'); const ex = kr('ex')
    return {
      videos: null as number | null, pending: 0,
      views, minutes: yt ? sum(yt.map(r => r[2])) : 0, subs: yt ? sum(yt.map(r => r[3] - r[4])) : 0,
      avgPct: yt && views ? sum(yt.map(r => r[1] * r[5])) / views / 100 : null,
      visits: sum(kr('vis').map(r => r.n)), captures: sum(kr('form').map(r => r.n)),
      newWs: sum(ws.map(r => r.n)), activated: sum(ws.map(r => r.a)), paid: sum(ws.map(r => r.p)),
      expanded: sum(ws.map(r => r.x)), churned: sum(ws.map(r => r.c)), plans: plansOf(kr('plan')),
      tiersNew: ws.reduce((acc, r) => addT(acc, r.t), zeroT()),
      existing: sum(ex.map(r => r.n)), tiersExisting: ex.reduce((acc, r) => addT(acc, r.t), zeroT()),
    }
  }

  // ── Scope totals ───────────────────────────────────────────────────────────
  const inScope = o.scope === 'all' ? connected : connected.filter(c => c.ch.id === o.scope)
  type Tot = ReturnType<typeof totals>
  const combine = (ts: Tot[]): Tot => ({
    videos: ts.every(t => t.videos == null) ? null : sum(ts.map(t => t.videos ?? 0)), pending: sum(ts.map(t => t.pending)),
    views: nsum(ts.map(t => t.views)), minutes: sum(ts.map(t => t.minutes)), subs: sum(ts.map(t => t.subs)), avgPct: ts.length === 1 ? ts[0].avgPct : null,
    visits: sum(ts.map(t => t.visits)), captures: sum(ts.map(t => t.captures)), newWs: sum(ts.map(t => t.newWs)),
    activated: sum(ts.map(t => t.activated)), paid: sum(ts.map(t => t.paid)), expanded: sum(ts.map(t => t.expanded)), churned: sum(ts.map(t => t.churned)),
    plans: plansOf(ts.flatMap(t => t.plans.map(p => ({ k: 'plan', b: '', key: '', d: p.plan, n: p.n, a: 0, p: p.paid, x: p.exp, c: p.churn, t: zeroT() })))),
    tiersNew: ts.reduce((acc, t) => addT(acc, t.tiersNew), zeroT()), existing: sum(ts.map(t => t.existing)),
    tiersExisting: ts.reduce((acc, t) => addT(acc, t.tiersExisting), zeroT()),
  })
  const pc = combine(inScope.map(c => totals(c, 'cur')))
  const pp = combine(inScope.map(c => totals(c, 'prev')))
  const scopeVideos = inScope.flatMap(c => c.videos)
  /** Rows of one kind for the current period: cohort = in-cohort tracked videos; calendar = scope keys (+ untagged on All). */
  const periodKeys = o.mode === 'cohort'
    ? new Set(scopeVideos.filter(v => v.tagged && inCohort(v.published, o.cur)).map(v => v.id))
    : new Set([...inScope.flatMap(c => [...c.keys]), ...(o.scope === 'all' ? ['untagged'] : [])])
  const periodRows = (k: string) => rows.filter(r => r.k === k && r.b === (o.mode === 'cohort' ? 'coh' : 'cur') && periodKeys.has(r.key))
  const personaMap = new Map<string, number>()
  for (const r of periodRows('per')) personaMap.set(r.d, (personaMap.get(r.d) ?? 0) + r.n)
  const persona = [...personaMap.entries()].map(([label, n]) => ({ label, n }))
    .sort((a, b) => (a.label === 'No answer' ? 1 : b.label === 'No answer' ? -1 : b.n - a.n))
  const monthMap = new Map<string, { month: string; n: number; act: number; paid: number; exp: number; churn: number }>()
  for (const r of periodRows('mon')) {
    const e = monthMap.get(r.d) ?? { month: r.d, n: 0, act: 0, paid: 0, exp: 0, churn: 0 }
    e.n += r.n; e.act += r.a; e.paid += r.p; e.exp += r.x; e.churn += r.c
    monthMap.set(r.d, e)
  }
  const signupMonths = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month))
  const backCatalog = inScope.map(c => {
    const keys = c.videos.filter(v => v.tagged).map(v => v.id)
    const pick = (k: string) => rows.filter(r => r.k === k && r.b === 'bc' && keys.includes(r.key))
    const ws = pick('ws')
    return { channel: c.ch.label, visits: sum(pick('vis').map(r => r.n)), newWs: sum(ws.map(r => r.n)), activated: sum(ws.map(r => r.a)), paid: sum(ws.map(r => r.p)),
      tiersNew: ws.reduce((acc, r) => addT(acc, r.t), zeroT()) }
  }).filter(b => b.visits || b.newWs)
  const trackedIds = scopeVideos.filter(v => v.tagged).map(v => v.id)
  const cuts = { device: cutOf('dev', trackedIds), geo: cutOf('geo', trackedIds) }

  // ── Funnel (email steps only when an in-scope video links to the offer page) ──
  const periodVideos = o.mode === 'cohort' ? scopeVideos.filter(v => inCohort(v.published, o.cur)) : scopeVideos
  const showEmailSteps = periodVideos.some(v => v.offerPage && v.tagged)
  const wsBase = showEmailSteps ? pc.captures : pc.visits
  const wsRate = rate(pc.newWs, wsBase)
  type Step = { id: string; stage: string; label: string; lever: string; source: string; cur: number | null; prev: number | null; rate: number | null; prevRate: number | null; goal: number | null; notConnected?: boolean; impact: number | null; goalNote?: string }
  const nc = (id: string, stage: string, label: string, lever: string, source: string, goal: number | null): Step =>
    ({ id, stage, label, lever, source, cur: null, prev: null, rate: null, prevRate: null, goal, notConnected: true, impact: null })
  const steps: Step[] = [
    nc('impr', 'Reach', 'Impressions', 'Thumbnail, title, cadence', 'YouTube Reporting API', null),
    { id: 'views', stage: 'Reach', label: 'Views', lever: 'Thumbnail & title CTR', source: 'YouTube Analytics API', cur: pc.views, prev: pp.views, rate: null, prevRate: null, goal: STEP_GOALS.viewRate, notConnected: true, impact: null },
    { id: 'visits', stage: 'Click', label: showEmailSteps ? 'Offer page visits' : 'Site visits (tagged links)', lever: 'CTA: pinned comment, description, end screen', source: 'Snowflake · MARKETING_PAGEVIEWS', cur: pc.visits, prev: pp.visits,
      rate: rate(pc.visits, pc.views), prevRate: rate(pp.visits, pp.views), goal: STEP_GOALS.viewToVisit,
      // Extra new workspaces if this step hit goal, holding every later step at today's rate.
      impact: pc.views ? Math.max(0, (pc.views * STEP_GOALS.viewToVisit - pc.visits) * (rate(pc.newWs, pc.visits) ?? 0)) : null },
  ]
  if (showEmailSteps) {
    steps.push(
      { id: 'captures', stage: 'Capture', label: 'Email captures', lever: 'Offer page headline & form', source: 'Snowflake · SEGMENT.VERCEL.FORM_SUBMITTED', cur: pc.captures, prev: pp.captures,
        rate: rate(pc.captures, pc.visits), prevRate: rate(pp.captures, pp.visits), goal: STEP_GOALS.capture,
        impact: pc.visits ? Math.max(0, (pc.visits * STEP_GOALS.capture - pc.captures) * (rate(pc.newWs, pc.captures) ?? 0)) : 0 },
      nc('qualified', 'Capture', 'Qualified emails', 'Who the video attracts', 'Clay enrichment', STEP_GOALS.qualified),
      nc('opens', 'Nurture', 'Email opens', 'Subject line & send time', 'Lifecycle (Inflection)', STEP_GOALS.open),
      nc('clicks', 'Nurture', 'Email clicks', 'Email body & CTA', 'Lifecycle (Inflection)', STEP_GOALS.click),
    )
  }
  steps.push({ id: 'ws', stage: 'Workspaces', label: 'New workspaces (first touch)', lever: 'Signup flow', source: 'Snowflake · FIRST_TOUCH_ATTRIBUTION', cur: pc.newWs, prev: pp.newWs,
    rate: wsRate, prevRate: rate(pp.newWs, showEmailSteps ? pp.captures : pp.visits),
    goal: showEmailSteps ? STEP_GOALS.newWorkspaceOfCaptures : STEP_GOALS.newWorkspace,
    goalNote: showEmailSteps ? 'of captures (placeholder while opens/clicks aren’t connected)' : 'of site visits',
    impact: wsBase ? Math.max(0, wsBase * (showEmailSteps ? STEP_GOALS.newWorkspaceOfCaptures : STEP_GOALS.newWorkspace) - pc.newWs) : 0 })
  const leak = steps.filter(s => s.impact != null && s.impact > 0).sort((a, b) => b.impact! - a.impact!)[0] ?? null

  // ── All channels rows ──────────────────────────────────────────────────────
  const untagged = { visits: one('vis', 'cur', 'untagged').n, prevVisits: one('vis', 'prev', 'untagged').n, ws: one('ws', 'cur', 'untagged'), prevWs: one('ws', 'prev', 'untagged') }
  const unmapped = [...new Set(rows.filter(r => r.key.startsWith('unmapped:')).map(r => r.key))].map(key => ({
    campaign: key.slice('unmapped:'.length), visits: one('vis', 'cur', key).n, prevVisits: one('vis', 'prev', key).n, ws: one('ws', 'cur', key).n,
  })).sort((a, b) => b.visits - a.visits)
  const channelRows = channels.map(c => {
    if (!c.doc) return { id: c.ch.id, label: c.ch.label, connected: false } as const
    const cc = c as Ch
    const t = totals(cc, 'cur')
    return {
      id: c.ch.id, label: c.ch.label, connected: true as const, handle: c.doc.handle, analytics: cc.analytics,
      impressions: null, ctr: null, views: t.views, visits: t.visits, captures: t.captures, newWs: t.newWs, tiersNew: t.tiersNew,
      existing: t.existing, tiersExisting: t.tiersExisting,
      trackedCount: cc.videos.filter(v => v.tagged).length, videoCount: cc.videos.length,
      trackedShare: cc.videos.length ? cc.videos.filter(v => v.tagged).length / cc.videos.length : null,
      matching: c.ch.fallback ? 'channel rule' : 'per-video campaign',
    }
  })

  // ── Trend (calendar) ───────────────────────────────────────────────────────
  const days = daysBetween(o.cur[0], o.cur[1])
  const scopeKeys = new Set(inScope.flatMap(c => [...c.keys]))
  const viewsKnown = inScope.length > 0 && inScope.every(c => c.analytics)
  const series = (metric: 'views' | 'visits' | 'untagged' | 'ws' | 'ws_untagged', start: ISODate) =>
    Array.from({ length: days }, (_, i) => {
      const day = addDays(start, i)
      if (metric === 'views') return { d: day, v: viewsKnown ? sum(inScope.map(c => c.doc!.daily.find(r => r[0] === day)?.[1] ?? 0)) : null }
      const k = metric.startsWith('ws') ? 'wsday' : 'vday'
      const match = (key: string) => (metric === 'untagged' || metric === 'ws_untagged' ? key === 'untagged' : scopeKeys.has(key))
      return { d: day, v: sum(rows.filter(r => r.k === k && r.d === day && match(r.key)).map(r => r.n)) }
    })
  const trendMetrics = o.scope === 'all'
    ? (['views', 'visits', 'untagged', 'ws', 'ws_untagged'] as const)
    : (['views', 'visits', 'ws'] as const)
  const trend = trendMetrics.map(m => ({ metric: m, cur: series(m, o.cur[0]), prev: series(m, o.prev[0]) }))

  const withUntagged = o.scope === 'all'
  const allNew = pc.newWs + (withUntagged ? untagged.ws.n : 0)
  const allNewPrev = pp.newWs + (withUntagged ? untagged.prevWs.n : 0)
  const act = pc.activated + (withUntagged ? untagged.ws.a : 0); const actPrev = pp.activated + (withUntagged ? untagged.prevWs.a : 0)
  const paid = pc.paid + (withUntagged ? untagged.ws.p : 0); const paidPrev = pp.paid + (withUntagged ? untagged.prevWs.p : 0)
  const exp = pc.expanded + (withUntagged ? untagged.ws.x : 0); const churn = pc.churned + (withUntagged ? untagged.ws.c : 0)
  const scopeChannel = o.scope === 'all' ? null : CHANNELS.find(c => c.id === o.scope)!

  return {
    scope: o.scope, mode: o.mode,
    channel: scopeChannel ? { id: scopeChannel.id, label: scopeChannel.label, handle: scopeChannel.handle, fallbackNote: scopeChannel.fallback?.note ?? null } : null,
    yt: { lastDay: ytLastDay, lagging: !!ytLastDay && ytLastDay < o.cur[1], days: ytDays, viewsKnown,
      fetchedAt: inScope.map(c => c.doc!.fetchedAt).sort()[0] ?? null },
    kpis: {
      newWs: { cur: allNew, prev: allNewPrev, delta: pct(allNew, allNewPrev), tagged: pc.newWs, untagged: withUntagged ? untagged.ws.n : null },
      activated: { cur: act, prev: actPrev, delta: pct(act, actPrev), rate: rate(act, allNew) },
      paid: { cur: paid, prev: paidPrev, delta: pct(paid, paidPrev), rate: rate(paid, allNew), churned: churn },
      views: { cur: pc.views, prev: pp.views, delta: pct(pc.views, pp.views), avgPct: pc.avgPct, subs: pc.subs, minutes: pc.minutes, known: viewsKnown },
      lifetimeViews: sum(scopeVideos.map(v => v.lifetimeViews)),
      visits: { cur: pc.visits, prev: pp.visits, delta: pct(pc.visits, pp.visits), untagged: withUntagged ? untagged.visits : null },
      captures: { cur: pc.captures, prev: pp.captures, delta: pct(pc.captures, pp.captures) },
      cohortVideos: o.mode === 'cohort' ? (pc.videos ?? 0) : null,
      pendingVideos: pc.pending,
    },
    steps, leak, showEmailSteps,
    afterSignup: {
      n: allNew, free: allNew - paid, paidOnly: Math.max(0, paid - exp - churn), expanded: exp, churned: churn,
      plans: withUntagged ? plansOf([...rows.filter(r => r.k === 'plan' && r.b === 'cur' && (scopeKeys.has(r.key) || r.key === 'untagged'))]) : pc.plans,
    },
    channelRows, untagged, unmapped,
    affiliateVisitors: one('vis', 'cur', 'affiliate').n,
    tiers: { labels: TIER_LABELS, fresh: withUntagged ? addT(pc.tiersNew, untagged.ws.t) : pc.tiersNew, existing: pc.tiersExisting },
    videos: scopeVideos,
    persona, signupMonths, backCatalog, cuts,
    trend,
  }
}

export type SocialViewModel = ReturnType<typeof buildSocial>
