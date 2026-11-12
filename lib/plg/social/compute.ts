/**
 * Social tab view model. Pure: Sigma rows (sql.ts) + YouTube documents
 * (scripts/sync-youtube.mjs) in, render-ready numbers out.
 *
 * Impressions and impression CTR are null everywhere ("Not connected") until
 * the Reporting API is authorized; nothing downstream substitutes a value.
 */
import { addDays, daysBetween, minDate, type ISODate } from '../dates'
import { CHANNELS, COHORT_DAYS, OFFER_PAGE_PATTERNS, STEP_GOALS, TIER_LABELS } from './config'
import type { TaggedVideo } from './sql'

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
  /** [day, views, minutes, subsGained, subsLost, avgViewPct] */
  daily: [ISODate, number, number, number, number, number][]
  videos: YtVideo[]
}

export type SocialScope = 'all' | 'peter'
export type SocialMode = 'calendar' | 'cohort'
type Row = { k: string; b: string; key: string; d: string; n: number; a: number; p: number; x: number; c: number; t: number[] }

export function parseSocialRows(payload: unknown): Row[] {
  const tbl = payload as { columns: string[]; rows: unknown[][] }
  if (!tbl || !Array.isArray(tbl.columns) || !Array.isArray(tbl.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(tbl.columns.map((c, i) => [c, i]))
  const s = (r: unknown[], c: string) => String(r[ix[c]] ?? '')
  const n = (r: unknown[], c: string) => Number(r[ix[c]] ?? 0) || 0
  return tbl.rows.map(r => ({
    k: s(r, 'k'), b: s(r, 'b'), key: s(r, 'key'), d: s(r, 'k') === 'plan' ? s(r, 'd') : s(r, 'd').slice(0, 10),
    n: n(r, 'n'), a: n(r, 'a'), p: n(r, 'p'), x: n(r, 'x'), c: n(r, 'c'), t: ['t1', 't2', 't3', 't4', 't5'].map(c => n(r, c)),
  }))
}

/** Tagged videos (with cohort windows) the SQL needs to map campaigns → videos. */
export function taggedVideos(docs: YtChannelDoc[], dataEnd: ISODate): TaggedVideo[] {
  return docs.flatMap(doc => doc.videos.filter(v => v.campaign).map(v => ({
    videoId: v.id, campaign: v.campaign!,
    cohortStart: v.published, cohortEnd: minDate(addDays(v.published, COHORT_DAYS - 1), dataEnd),
  })))
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const pct = (cur: number | null, prev: number | null) => (cur != null && prev ? (cur - prev) / prev : null)
const rate = (a: number | null, b: number | null) => (a != null && b ? a / b : null)
const zeroT = () => [0, 0, 0, 0, 0]
const addT = (a: number[], b: number[]) => a.map((x, i) => x + (b[i] ?? 0))

export function buildSocial(o: {
  scope: SocialScope; mode: SocialMode; cur: [ISODate, ISODate]; prev: [ISODate, ISODate]
  dataEnd: ISODate; rows: Row[]; yt: YtChannelDoc[]
}) {
  const { rows } = o
  const get = (k: string, b: string, key: string) => rows.filter(r => r.k === k && r.b === b && r.key === key)
  const one = (k: string, b: string, key: string) => {
    const rs = get(k, b, key)
    return { n: sum(rs.map(r => r.n)), a: sum(rs.map(r => r.a)), p: sum(rs.map(r => r.p)), x: sum(rs.map(r => r.x)), c: sum(rs.map(r => r.c)), t: rs.reduce((acc, r) => addT(acc, r.t), zeroT()) }
  }
  const today = o.dataEnd

  // ── Videos (each over its first 28 days) ───────────────────────────────────
  const peterDoc = o.yt.find(d => d.channelId === CHANNELS[0].youtubeId) ?? null
  const videoRows = (doc: YtChannelDoc) => doc.videos.map(v => {
    const tagged = !!v.campaign
    const coh = v.cohort28
    const vis = tagged ? one('vis', 'coh', v.id) : null
    const ws = tagged ? one('ws', 'coh', v.id) : null
    const ex = tagged ? one('ex', 'coh', v.id) : null
    const cohortDay = Math.min(COHORT_DAYS, Math.max(0, daysBetween(v.published, today)))
    return {
      id: v.id, title: v.title, published: v.published, channel: doc.title, durationSec: v.durationSec,
      cohortDay, cohortComplete: cohortDay >= COHORT_DAYS,
      impressions: null as number | null, ctr: null as number | null,
      views: coh?.views ?? 0, minutes: coh?.minutes ?? 0, avgViewPct: coh ? coh.avgViewPct / 100 : null, subsGained: coh?.subsGained ?? 0,
      destination: v.destination, destinationKind: v.destinationKind, campaign: v.campaign, tagged,
      offerPage: !!v.destination && OFFER_PAGE_PATTERNS.some(re => re.test(v.destination!)),
      visits: vis?.n ?? null, newWs: ws?.n ?? null, activated: ws?.a ?? null, paid: ws?.p ?? null, expanded: ws?.x ?? null, churned: ws?.c ?? null,
      visitRate: tagged && coh?.views ? (vis?.n ?? 0) / coh.views : null,
      wsRate: tagged && vis?.n ? (ws?.n ?? 0) / vis.n : null,
      tiersNew: ws?.t ?? null, existing: ex?.n ?? null, tiersExisting: ex?.t ?? null,
    }
  }).sort((a, b) => b.published.localeCompare(a.published))
  const peterVideos = peterDoc ? videoRows(peterDoc) : []

  // ── Calendar totals for a channel ──────────────────────────────────────────
  // YouTube Analytics lags ~2 days: clip both periods to the days YouTube has reported.
  const ytLastDay = peterDoc?.daily.map(r => r[0]).sort().at(-1) ?? null
  const ytCurEnd = ytLastDay && ytLastDay < o.cur[1] ? ytLastDay : o.cur[1]
  const ytDays = ytCurEnd >= o.cur[0] ? daysBetween(o.cur[0], ytCurEnd) : 0
  const ytPrevEnd = addDays(o.prev[0], Math.max(0, ytDays - 1))
  const ytSum = (doc: YtChannelDoc | null, s: ISODate, e: ISODate) => {
    if (!doc || !ytDays) return { views: 0, minutes: 0, subs: 0, avgPct: null as number | null }
    const rs = doc.daily.filter(r => r[0] >= s && r[0] <= e)
    const views = sum(rs.map(r => r[1]))
    return { views, minutes: sum(rs.map(r => r[2])), subs: sum(rs.map(r => r[3] - r[4])), avgPct: views ? sum(rs.map(r => r[1] * r[5])) / views / 100 : null }
  }
  const videoKeys = new Set(peterVideos.map(v => v.id))
  const calendarFor = (b: 'cur' | 'prev') => {
    const keyRows = (k: string) => rows.filter(r => r.k === k && r.b === b && videoKeys.has(r.key))
    const ws = keyRows('ws'); const ex = keyRows('ex')
    return {
      visits: sum(keyRows('vis').map(r => r.n)),
      newWs: sum(ws.map(r => r.n)), activated: sum(ws.map(r => r.a)), paid: sum(ws.map(r => r.p)),
      expanded: sum(ws.map(r => r.x)), churned: sum(ws.map(r => r.c)), plans: plansOf(keyRows('plan')),
      tiersNew: ws.reduce((acc, r) => addT(acc, r.t), zeroT()),
      existing: sum(ex.map(r => r.n)), tiersExisting: ex.reduce((acc, r) => addT(acc, r.t), zeroT()),
    }
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

  // ── Cohort totals: videos published in the selected range (and the previous range) ──
  const cohortFor = (range: [ISODate, ISODate]) => {
    const vs = peterVideos.filter(v => v.published >= range[0] && v.published <= range[1])
    // Videos YouTube hasn't reported yet are "pending", not zero.
    const reported = vs.filter(v => v.views > 0)
    const views = reported.length ? sum(reported.map(v => v.views)) : (vs.length ? null : 0)
    return {
      videos: vs.length, pending: vs.length - reported.length,
      views, minutes: sum(vs.map(v => v.minutes)), subs: sum(vs.map(v => v.subsGained)),
      avgPct: views ? sum(reported.map(v => v.views * (v.avgViewPct ?? 0))) / views : null,
      visits: sum(vs.map(v => v.visits ?? 0)), newWs: sum(vs.map(v => v.newWs ?? 0)),
      activated: sum(vs.map(v => v.activated ?? 0)), paid: sum(vs.map(v => v.paid ?? 0)),
      expanded: sum(vs.map(v => v.expanded ?? 0)), churned: sum(vs.map(v => v.churned ?? 0)),
      plans: plansOf(rows.filter(r => r.k === 'plan' && r.b === 'coh' && vs.some(v => v.id === r.key))),
      tiersNew: vs.reduce((acc, v) => addT(acc, v.tiersNew ?? zeroT()), zeroT()),
      existing: sum(vs.map(v => v.existing ?? 0)), tiersExisting: vs.reduce((acc, v) => addT(acc, v.tiersExisting ?? zeroT()), zeroT()),
      taggedVideos: vs.filter(v => v.tagged).length,
    }
  }

  const peter = (b: 'cur' | 'prev') => {
    if (o.mode === 'cohort') return cohortFor(b === 'cur' ? o.cur : o.prev)
    const y = b === 'cur' ? ytSum(peterDoc, o.cur[0], ytCurEnd) : ytSum(peterDoc, o.prev[0], ytPrevEnd)
    return { videos: null as number | null, pending: 0, views: y.views as number | null, minutes: y.minutes, subs: y.subs, avgPct: y.avgPct, ...calendarFor(b), taggedVideos: null as number | null }
  }
  const pc = peter('cur'); const pp = peter('prev')

  // ── Funnel (creator channels; email steps only for offer-page videos) ──────
  const inScope = o.mode === 'cohort' ? peterVideos.filter(v => v.published >= o.cur[0] && v.published <= o.cur[1]) : peterVideos
  const showEmailSteps = inScope.some(v => v.offerPage)
  const wsRate = rate(pc.newWs, pc.visits)
  type Step = { id: string; stage: string; label: string; lever: string; source: string; cur: number | null; prev: number | null; rate: number | null; prevRate: number | null; goal: number | null; notConnected?: boolean; impact: number | null }
  const steps: Step[] = [
    { id: 'impr', stage: 'Reach', label: 'Impressions', lever: 'Thumbnail, title, cadence', source: 'YouTube Reporting API', cur: null, prev: null, rate: null, prevRate: null, goal: null, notConnected: true, impact: null },
    { id: 'views', stage: 'Reach', label: 'Views', lever: 'Thumbnail & title CTR', source: 'YouTube Analytics API', cur: pc.views, prev: pp.views, rate: null, prevRate: null, goal: STEP_GOALS.viewRate, notConnected: true, impact: null },
    { id: 'visits', stage: 'Click', label: 'Site visits (tagged links)', lever: 'CTA: description link, pinned comment, mention', source: 'Snowflake · MARKETING_PAGEVIEWS', cur: pc.visits, prev: pp.visits,
      rate: rate(pc.visits, pc.views), prevRate: rate(pp.visits, pp.views), goal: STEP_GOALS.viewToVisit,
      // Extra new workspaces if this step hit goal, holding the visit → workspace rate at today's value.
      impact: pc.views && wsRate != null ? Math.max(0, (pc.views * STEP_GOALS.viewToVisit - pc.visits) * wsRate) : 0 },
    { id: 'ws', stage: 'Workspaces', label: 'New workspaces (first touch)', lever: 'Signup flow & where the link lands', source: 'Snowflake · FIRST_TOUCH_ATTRIBUTION', cur: pc.newWs, prev: pp.newWs,
      rate: wsRate, prevRate: rate(pp.newWs, pp.visits), goal: STEP_GOALS.newWorkspace,
      impact: pc.visits ? Math.max(0, pc.visits * STEP_GOALS.newWorkspace - pc.newWs) : 0 },
  ]
  const leak = steps.filter(s => s.impact != null && s.impact > 0).sort((a, b) => b.impact! - a.impact!)[0] ?? null

  // ── All channels rows ──────────────────────────────────────────────────────
  const untagged = { visits: one('vis', 'cur', 'untagged').n, prevVisits: one('vis', 'prev', 'untagged').n, ws: one('ws', 'cur', 'untagged'), prevWs: one('ws', 'prev', 'untagged').n }
  const unmapped = [...new Set(rows.filter(r => r.key.startsWith('unmapped:')).map(r => r.key))].map(key => ({
    campaign: key.slice('unmapped:'.length), visits: one('vis', 'cur', key).n, prevVisits: one('vis', 'prev', key).n, ws: one('ws', 'cur', key).n,
  })).sort((a, b) => b.visits - a.visits)
  const channelRows = CHANNELS.map(c => {
    if (c.id !== 'peter' || !peterDoc) return { id: c.id, label: c.label, connected: false } as const
    return {
      id: c.id, label: c.label, connected: true as const, handle: peterDoc.handle,
      impressions: null, ctr: null, views: pc.views, visits: pc.visits, newWs: pc.newWs, tiersNew: pc.tiersNew,
      existing: pc.existing, tiersExisting: pc.tiersExisting,
      trackedShare: peterDoc.videos.length ? peterDoc.videos.filter(v => v.campaign).length / peterDoc.videos.length : null,
      trackedCount: peterDoc.videos.filter(v => v.campaign).length, videoCount: peterDoc.videos.length,
    }
  })

  // ── Trend (calendar) ───────────────────────────────────────────────────────
  const days = daysBetween(o.cur[0], o.cur[1])
  const series = (metric: 'views' | 'visits' | 'untagged' | 'ws' | 'ws_untagged', start: ISODate) =>
    Array.from({ length: days }, (_, i) => {
      const day = addDays(start, i)
      if (metric === 'views') return { d: day, v: peterDoc?.daily.find(r => r[0] === day)?.[1] ?? null }
      const k = metric.startsWith('ws') ? 'wsday' : 'vday'
      const key = metric === 'visits' || metric === 'ws' ? 'tagged' : 'untagged'
      return { d: day, v: sum(rows.filter(r => r.k === k && r.d === day && r.key === key).map(r => r.n)) }
    })
  const trendMetrics = o.scope === 'all'
    ? (['views', 'visits', 'untagged', 'ws', 'ws_untagged'] as const)
    : (['views', 'visits', 'ws'] as const)
  const trend = trendMetrics.map(m => ({ metric: m, cur: series(m, o.cur[0]), prev: series(m, o.prev[0]) }))

  const allNew = o.scope === 'all' ? pc.newWs + untagged.ws.n : pc.newWs
  const allNewPrev = o.scope === 'all' ? pp.newWs + untagged.prevWs : pp.newWs

  return {
    scope: o.scope, mode: o.mode,
    yt: { lastDay: ytLastDay, lagging: !!ytLastDay && ytLastDay < o.cur[1], days: ytDays, fetchedAt: peterDoc?.fetchedAt ?? null, subscribers: peterDoc?.subscribers ?? null, handle: peterDoc?.handle ?? null, connected: !!peterDoc },
    kpis: {
      newWs: { cur: allNew, prev: allNewPrev, delta: pct(allNew, allNewPrev), tagged: pc.newWs, untagged: o.scope === 'all' ? untagged.ws.n : null },
      activated: (() => {
        const cur = pc.activated + (o.scope === 'all' ? untagged.ws.a : 0)
        const prev = pp.activated + (o.scope === 'all' ? one('ws', 'prev', 'untagged').a : 0)
        return { cur, prev, delta: pct(cur, prev), rate: rate(cur, allNew) }
      })(),
      paid: (() => {
        const cur = pc.paid + (o.scope === 'all' ? untagged.ws.p : 0)
        const prev = pp.paid + (o.scope === 'all' ? one('ws', 'prev', 'untagged').p : 0)
        return { cur, prev, delta: pct(cur, prev), rate: rate(cur, allNew), churned: pc.churned + (o.scope === 'all' ? untagged.ws.c : 0) }
      })(),
      views: { cur: pc.views, prev: pp.views, delta: pct(pc.views, pp.views), avgPct: pc.avgPct, subs: pc.subs, minutes: pc.minutes },
      visits: { cur: pc.visits, prev: pp.visits, delta: pct(pc.visits, pp.visits), untagged: o.scope === 'all' ? untagged.visits : null },
      cohortVideos: o.mode === 'cohort' ? (pc.videos ?? 0) : null,
      pendingVideos: pc.pending,
    },
    steps, leak, showEmailSteps,
    afterSignup: (() => {
      const n = allNew; const paid = pc.paid + (o.scope === 'all' ? untagged.ws.p : 0)
      const exp = pc.expanded + (o.scope === 'all' ? untagged.ws.x : 0); const churn = pc.churned + (o.scope === 'all' ? untagged.ws.c : 0)
      const plans = o.scope === 'all' ? plansOf([...rows.filter(r => r.k === 'plan' && r.b === 'cur' && (videoKeys.has(r.key) || r.key === 'untagged'))]) : pc.plans
      return { n, free: n - paid, paidOnly: Math.max(0, paid - exp - churn), expanded: exp, churned: churn, plans }
    })(),
    channelRows, untagged, unmapped,
    affiliateVisitors: one('vis', 'cur', 'affiliate').n,
    tiers: { labels: TIER_LABELS, fresh: o.scope === 'all' ? addT(pc.tiersNew, untagged.ws.t) : pc.tiersNew, existing: pc.tiersExisting },
    videos: peterVideos,
    missingLinks: peterVideos.filter(v => !v.tagged),
    trend,
  }
}

export type SocialViewModel = ReturnType<typeof buildSocial>
