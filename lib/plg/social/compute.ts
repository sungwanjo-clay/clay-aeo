/**
 * Social tab view model. Pure: Sigma rows (sql.ts) + YouTube documents
 * (scripts/sync-youtube.mjs) in, render-ready numbers out.
 *
 * Anything blocked on access is null and renders "Not connected": the email
 * steps (no lifecycle data in Snowflake yet), and views / watch time for channels without
 * Analytics access. Nothing downstream substitutes a value.
 */
import { addDays, daysBetween, minDate, type ISODate } from '../dates'
import { code, driverPara, headlineLine, pct as pctTxt, type Block, type Insight, type Item, type Para } from '../insights'
import { CHANNELS, COHORT_DAYS, NO_ANALYTICS, OFFER_PAGE_PATTERNS, STEP_GOALS, TIER_LABELS, type CreatorChannel } from './config'
import type { ChannelFallback, TaggedVideo } from './sql'

export interface YtVideo {
  id: string; title: string; published: ISODate; durationSec: number; lifetimeViews: number
  campaign: string | null
  destination: string | null
  destinationKind: 'clay' | 'short_unresolved' | 'external' | 'none'
  /** full = the link as written with its query string; params = every query parameter (absent in older syncs). */
  links: { url: string; full?: string; params?: Record<string, string>; kind: string; campaign: string | null }[]
  likes?: number | null; comments?: number | null; publishedAt?: string; live?: boolean
  /** [day, views, minutes, avgViewPct, subsGained] */
  daily: [ISODate, number, number, number, number][]
  cohort28: { start: ISODate; end: ISODate; days: number; views: number; minutes: number; avgViewPct: number; subsGained: number } | null
  /** [day, thumbnail impressions, thumbnail clicks] from the Reporting API; null/absent = not connected. */
  impressions?: [ISODate, number, number][] | null
}
export interface YtChannelDoc {
  channelId: string; key: string; title: string; handle: string; subscribers: number; videoCount: number
  fetchedAt: string
  /** false = no Viewer access; views/watch time unknown (Data API metadata only). */
  analyticsAccess?: boolean
  /** Channel [day, impressions, clicks]. null/absent = no owner sign-in; [] = job set up, no files yet. */
  impressionsDaily?: [ISODate, number, number][] | null
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
    // Channel-level rule: start no earlier than the sync window (an old channel's first video can be years back).
    const since = (doc as YtChannelDoc & { since?: ISODate }).since ?? addDays(dataEnd, -180)
    const firstVideo = [...doc.videos].map(v => v.published).sort()[0] ?? dataEnd
    const first = firstVideo > since ? firstVideo : since
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
      if (r.k !== k || r.b !== 'cur' || !keys.includes(r.key)) continue
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
    const sinceDay = (doc as YtChannelDoc & { since?: ISODate }).since ?? '1970-01-01'
    // Impressions only over days views are in for too, so the view rate never divides mismatched days.
    const viewsThrough = analytics ? (doc.daily.at(-1)?.[0] ?? null) : null
    const videos = doc.videos.filter(v => v.published >= sinceDay).map(v => {
      const isTracked = tracked(v)
      const coh = v.cohort28
      const vis = isTracked ? one('vis', 'coh', v.id) : null
      const form = isTracked ? one('form', 'coh', v.id) : null
      const ws = isTracked ? one('ws', 'coh', v.id) : null
      const ex = isTracked ? one('ex', 'coh', v.id) : null
      const cohortDay = Math.min(COHORT_DAYS, Math.max(0, daysBetween(v.published, o.dataEnd)))
      const views = analytics ? (coh?.views || null) : null
      const imprRows = v.impressions?.length ? v.impressions.filter(r => r[0] >= v.published && r[0] <= addDays(v.published, COHORT_DAYS - 1) && (!viewsThrough || r[0] <= viewsThrough)) : null
      const impr28 = imprRows ? sum(imprRows.map(r => r[1])) : null
      const clicks28 = imprRows ? sum(imprRows.map(r => r[2])) : null
      const offerPage = !!v.destination && OFFER_PAGE_PATTERNS.some(re => re.test(v.destination!))
      return {
        id: v.id, title: v.title, published: v.published, channel: ch.label, durationSec: v.durationSec,
        cohortDay, cohortComplete: cohortDay >= COHORT_DAYS, analytics, lifetimeViews: v.lifetimeViews, impressions: impr28, imprClicks: clicks28,
        views, viewsPending: analytics && !coh?.views, minutes: coh?.minutes ?? 0, avgViewPct: analytics && coh ? coh.avgViewPct / 100 : null, subsGained: coh?.subsGained ?? 0,
        destination: v.destination, campaign: v.campaign, tagged: isTracked, offerPage,
        links: v.links, likes: v.likes ?? null, comments: v.comments ?? null, publishedAt: v.publishedAt ?? null, live: !!v.live,
        avgViewPct28: coh?.avgViewPct ?? null, subsGained28: coh?.subsGained ?? null,
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
    const imprState: 'live' | 'pending' | 'none' = doc.impressionsDaily == null ? 'none' : doc.impressionsDaily.length ? 'live' : 'pending'
    // Days Google has delivered a reach report for. Impressions are only compared with views over days that are all in.
    const imprDays = new Set((doc.impressionsDaily ?? []).map(r => r[0]))
    // Last day YouTube has delivered everything this channel reports (views and, once connected, impressions). Days after
    // it are still in YouTube's 1–3 day lag, so they're left out of coverage instead of being flagged as missing.
    const lastView = doc.daily.at(-1)?.[0] ?? null, lastImpr = [...imprDays].sort().at(-1) ?? null
    const through = [lastView, lastImpr].filter((d): d is ISODate => !!d).sort()[0] ?? null
    return { ch, doc, analytics, videos, keys, imprState, imprDays, through }
  })
  type Ch = Extract<(typeof channels)[number], { videos: unknown }>
  const connected = channels.filter((c): c is Ch => !!c.doc)

  // YouTube Analytics lags ~2 days: clip calendar comparisons to reported days.
  // Clipped to the day every connected source has reached, so views, impressions and view rate cover the same days in both periods.
  const ytLastDay = connected.filter(c => c.analytics).map(c => c.through).filter((d): d is ISODate => !!d).sort()[0] ?? null
  const ytCurEnd = ytLastDay && ytLastDay < o.cur[1] ? ytLastDay : o.cur[1]
  const ytDays = ytCurEnd >= o.cur[0] ? daysBetween(o.cur[0], ytCurEnd) : 0
  const ytPrevEnd = addDays(o.prev[0], Math.max(0, ytDays - 1))

  /** Days a..b (inclusive) and how many of them have a delivered reach report. */
  const coverage = (c: Ch, a: ISODate, e: ISODate) => {
    if (c.through && c.through < e) e = c.through
    let days = 0, have = 0
    for (let d = a; d <= e; d = addDays(d, 1)) { days++; if (c.imprDays.has(d)) have++ }
    return { days, have }
  }
  /** Totals for one channel, one period. */
  function totals(c: Ch, b: 'cur' | 'prev') {
    const range = b === 'cur' ? o.cur : o.prev
    if (o.mode === 'cohort') {
      const vs = c.videos.filter(v => inCohort(v.published, range))
      const reported = vs.filter(v => v.views)
      const views = !c.analytics ? null : reported.length ? sum(reported.map(v => v.views!)) : (vs.length ? null : 0)
      const tagged = vs.filter(v => v.tagged)
      const cov = vs.map(v => coverage(c, v.published, cohortEnd(v.published, o.dataEnd)))
      const imprDays = sum(cov.map(x => x.days)), imprHave = sum(cov.map(x => x.have))
      const impressions = c.imprState === 'live' ? sum(vs.map(v => v.impressions ?? 0)) : null
      const imprClicks = c.imprState === 'live' ? sum(vs.map(v => v.imprClicks ?? 0)) : null
      return {
        videos: vs.length, pending: c.analytics ? vs.length - reported.length : 0, impressions, imprClicks, imprDays, imprHave,
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
    const cov = end >= range[0] ? coverage(c, range[0], end) : { days: 0, have: 0 }
    const imprIn = c.imprState === 'live' ? c.doc!.impressionsDaily!.filter(r => r[0] >= range[0] && r[0] <= end) : null
    const impressions = imprIn ? sum(imprIn.map(r => r[1])) : null
    const imprClicks = imprIn ? sum(imprIn.map(r => r[2])) : null
    return {
      videos: null as number | null, pending: 0, impressions, imprClicks, imprDays: cov.days, imprHave: cov.have,
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
    impressions: nsum(ts.map(t => t.impressions)), imprClicks: nsum(ts.map(t => t.imprClicks)), imprDays: sum(ts.map(t => t.imprDays)), imprHave: sum(ts.map(t => t.imprHave)),
    views: nsum(ts.map(t => t.views)), minutes: sum(ts.map(t => t.minutes)), subs: sum(ts.map(t => t.subs)), avgPct: ts.length === 1 ? ts[0].avgPct : null,
    visits: sum(ts.map(t => t.visits)), captures: sum(ts.map(t => t.captures)), newWs: sum(ts.map(t => t.newWs)),
    activated: sum(ts.map(t => t.activated)), paid: sum(ts.map(t => t.paid)), expanded: sum(ts.map(t => t.expanded)), churned: sum(ts.map(t => t.churned)),
    plans: plansOf(ts.flatMap(t => t.plans.map(p => ({ k: 'plan', b: '', key: '', d: p.plan, n: p.n, a: 0, p: p.paid, x: p.exp, c: p.churn, t: zeroT() })))),
    tiersNew: ts.reduce((acc, t) => addT(acc, t.tiersNew), zeroT()), existing: sum(ts.map(t => t.existing)),
    tiersExisting: ts.reduce((acc, t) => addT(acc, t.tiersExisting), zeroT()),
  })
  const pc = combine(inScope.map(c => totals(c, 'cur')))
  const pp = combine(inScope.map(c => totals(c, 'prev')))
  // Views tile: sum the channels YouTube Analytics reports for, and name the ones left out (e.g. Payton without a sign-in),
  // instead of showing "pending" for the whole scope. The funnel keeps nsum: its rates need views for every channel.
  const withViews = inScope.filter(c => c.analytics)
  const vc = withViews.length ? combine(withViews.map(c => totals(c, 'cur'))) : null
  const vp = withViews.length ? combine(withViews.map(c => totals(c, 'prev'))) : null
  const withImpr = inScope.filter(c => c.imprState === 'live')
  const ic = withImpr.length ? combine(withImpr.map(c => totals(c, 'cur'))) : null
  const ip = withImpr.length ? combine(withImpr.map(c => totals(c, 'prev'))) : null
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
  const trackedIds = [...new Set([...scopeVideos.filter(v => v.tagged).map(v => v.id), ...inScope.map(c => `ch:${c.ch.id}`)])]
  const cuts = { device: cutOf('dev', trackedIds), geo: cutOf('geo', trackedIds) }

  // ── Video deep dive: per-video day-by-day series for these dates and the period before (aligned by day index), plus
  // period totals for both. YouTube metrics are null on days YouTube hasn't delivered yet (after ytCurEnd / ytPrevEnd).
  type VDay = { d: ISODate; views: number | null; minutes: number | null; subs: number | null; impr: number | null; clk: number | null; visits: number; captures: number; ws: number }
  const videoDeep: Record<string, { cur: VDay[]; prev: VDay[]; totals: { cur: VTot; prev: VTot } }> = {}
  type VTot = { views: number | null; minutes: number | null; subs: number | null; impr: number | null; clk: number | null; visits: number; captures: number; newWs: number; activated: number; paid: number }
  {
    const nDays = daysBetween(o.cur[0], o.cur[1])
    for (const c of inScope) for (const v of c.videos) {
      const dv = c.doc!.videos.find(x => x.id === v.id)
      const series = (start: ISODate, ytEnd: ISODate): VDay[] => Array.from({ length: nDays }, (_, i) => {
        const d = addDays(start, i), yt = d <= ytEnd
        const dr = dv?.daily.find(r => r[0] === d), ir = dv?.impressions?.find(r => r[0] === d)
        const day = (k: string) => sum(rows.filter(r => r.k === k && r.key === v.id && r.d === d).map(r => r.n))
        return { d, views: c.analytics && yt ? (dr?.[1] ?? 0) : null, minutes: c.analytics && yt ? (dr?.[2] ?? 0) : null, subs: c.analytics && yt ? (dr?.[4] ?? 0) : null,
          impr: c.imprState === 'live' && c.imprDays.has(d) && yt ? (ir?.[1] ?? 0) : null, clk: c.imprState === 'live' && c.imprDays.has(d) && yt ? (ir?.[2] ?? 0) : null,
          visits: day('vday'), captures: 0, ws: day('wsday') }
      })
      const tot = (b: 'cur' | 'prev', xs: VDay[]): VTot => {
        const nn = (k: 'views' | 'minutes' | 'subs' | 'impr' | 'clk') => (xs.some(x => x[k] != null) ? sum(xs.map(x => x[k] ?? 0)) : null)
        const ws = one('ws', b, v.id)
        return { views: nn('views'), minutes: nn('minutes'), subs: nn('subs'), impr: nn('impr'), clk: nn('clk'), visits: one('vis', b, v.id).n, captures: one('form', b, v.id).n, newWs: ws.n, activated: ws.a, paid: ws.p }
      }
      const cur = series(o.cur[0], ytCurEnd), prev = series(o.prev[0], ytPrevEnd)
      videoDeep[v.id] = { cur, prev, totals: { cur: tot('cur', cur), prev: tot('prev', prev) } }
    }
  }

  // ── Videos table: every number for the selected dates, the same window as the tiles and the channel totals ──
  // Views run through the last day YouTube has delivered (ytCurEnd). Each channel's views from videos older than the
  // sync window go in one "older videos" row, so the rows add up to the channel's total.
  type VP = { impressions: number | null; imprClicks: number | null; minutes: number | null; views: number | null; visits: number | null; captures: number | null; newWs: number | null; activated: number | null; paid: number | null; tiersNew: number[] | null; tiersExisting: number[] | null }
  const videoPeriod: Record<string, VP> = {}
  const olderVideos: { channel: string; impressions: number | null; imprClicks: number | null; views: number | null; visits: number; newWs: number; activated: number; paid: number; tiersNew: number[] }[] = []
  for (const c of inScope) {
    const doc = c.doc!
    const inR = (d: ISODate) => d >= o.cur[0] && d <= ytCurEnd
    let listed = 0, listedImp = 0, listedClk = 0
    const listedIds = new Set(c.videos.map(v => v.id))
    for (const v of c.videos) {
      const dv = doc.videos.find(x => x.id === v.id)
      const views = c.analytics && dv ? sum(dv.daily.filter(r => inR(r[0])).map(r => r[1])) : null
      listed += views ?? 0
      const ii = dv?.impressions?.filter(r => inR(r[0])) ?? []
      listedImp += sum(ii.map(r => r[1])); listedClk += sum(ii.map(r => r[2]))
      const vis = one('vis', 'cur', v.id), ws = one('ws', 'cur', v.id), ex = one('ex', 'cur', v.id), form = one('form', 'cur', v.id)
      const imp = dv?.impressions ? dv.impressions.filter(r => inR(r[0])) : null
      videoPeriod[v.id] = { impressions: imp ? sum(imp.map(r => r[1])) : null, imprClicks: imp ? sum(imp.map(r => r[2])) : null,
        minutes: c.analytics && dv ? sum(dv.daily.filter(r => inR(r[0])).map(r => r[2])) : null, views, visits: v.tagged ? vis.n : null, captures: v.tagged && v.offerPage ? form.n : null, newWs: v.tagged ? ws.n : null, activated: v.tagged ? ws.a : null,
        paid: v.tagged ? ws.p : null, tiersNew: v.tagged ? ws.t : null, tiersExisting: v.tagged ? ex.t : null }
    }
    const chViews = c.analytics ? sum(doc.daily.filter(r => inR(r[0])).map(r => r[1])) : null
    const olderIds = doc.videos.filter(v => !listedIds.has(v.id)).map(v => v.id)
    const ows = olderIds.map(id => one('ws', 'cur', id))
    const chImp = c.imprState === 'live' ? (doc.impressionsDaily ?? []).filter(r => inR(r[0])) : null
    const older = { channel: c.ch.label, impressions: chImp ? Math.max(0, sum(chImp.map(r => r[1])) - listedImp) : null, imprClicks: chImp ? Math.max(0, sum(chImp.map(r => r[2])) - listedClk) : null,
      views: chViews != null ? chViews - listed : null, visits: sum(olderIds.map(id => one('vis', 'cur', id).n)),
      newWs: sum(ows.map(x => x.n)), activated: sum(ows.map(x => x.a)), paid: sum(ows.map(x => x.p)), tiersNew: ows.reduce((acc, x) => addT(acc, x.t), zeroT()) }
    if ((older.views ?? 0) > 0 || older.visits || older.newWs) olderVideos.push(older)
  }

  // ── Funnel: one row per count and one per rate, grouped by stage ──────────
  // Names are shared with the tiles, the trend picker and the tables, so a metric reads the same everywhere.
  const periodVideos = o.mode === 'cohort' ? scopeVideos.filter(v => inCohort(v.published, o.cur)) : scopeVideos
  const showEmailSteps = periodVideos.some(v => v.offerPage && v.tagged)
  const viewsKnown = inScope.length > 0 && inScope.every(c => c.analytics)
  const IMPR_NC = 'Needs the channel owner’s one-time sign-in (YouTube Reporting API)'
  const LIFECYCLE = 'Lifecycle email sends, opens and clicks (Inflection) aren’t in Snowflake yet'
  const NO_CAPTURE = 'No video in scope links to an email-capture page yet'
  // The period before counts only when Google has delivered every day of it (reports start ~30 days before the job).
  const prevImprOk = !!ip && ip.imprHave >= ip.imprDays
  const curImprOk = !!ic
  type FRow = { id: string; stage: string; kind: 'count' | 'rate'; label: string; def: string; cur: number | null; prev: number | null; goal?: number | null; nc?: string | null; partial?: string | null }
  const cnt = (id: string, stage: string, label: string, def: string, cur: number | null, prev: number | null, nc?: string | null, partial?: string | null): FRow =>
    ({ id, stage, kind: 'count', label, def, cur: nc ? null : cur, prev: nc ? null : prev, nc: nc ?? null, partial: partial ?? null })
  const rt = (id: string, stage: string, label: string, def: string, cur: number | null, prev: number | null, goal: number | null, nc?: string | null): FRow =>
    ({ id, stage, kind: 'rate', label, def, cur: nc ? null : cur, prev: nc ? null : prev, goal, nc: nc ?? null })
  const wsRateDef = showEmailSteps ? 'New workspaces ÷ email captures' : 'New workspaces ÷ referral visits'
  const t13 = (x: number[]) => x[0] + x[1] + x[2]
  const noViews = !withViews.length ? NO_ANALYTICS : null
  const funnel: FRow[] = [
    cnt('impressions', 'Reach', 'Impressions', 'Thumbnail impressions on YouTube', curImprOk ? ic!.impressions : null, prevImprOk ? ip!.impressions : null, !withImpr.length ? IMPR_NC : null,
      ip && !prevImprOk ? 'The period before isn’t fully delivered by YouTube yet' : null),
    rt('thumb_ctr', 'Reach', 'Thumbnail CTR', 'Thumbnail clicks ÷ impressions', rate(ic?.imprClicks ?? null, ic?.impressions ?? null), prevImprOk ? rate(ip!.imprClicks, ip!.impressions) : null, null, !withImpr.length ? IMPR_NC : null),
    cnt('views', 'Reach', 'Views', 'YouTube views', vc?.views ?? null, vp?.views ?? null, noViews),
    cnt('visits', 'Click', 'Referral visits', 'Visitors from the creators’ clay.com links', pc.visits, pp.visits),
    rt('cta_ctr', 'Click', 'CTA CTR', 'Referral visits ÷ views', rate(vc?.visits ?? null, vc?.views ?? null), rate(vp?.visits ?? null, vp?.views ?? null), STEP_GOALS.viewToVisit, noViews),
    cnt('captures', 'Capture', 'Email captures', 'Offer-page form submits', pc.captures, pp.captures, showEmailSteps ? null : NO_CAPTURE),
    rt('capture_rate', 'Capture', 'Email capture rate', 'Email captures ÷ referral visits', rate(pc.captures, pc.visits), rate(pp.captures, pp.visits), STEP_GOALS.capture, showEmailSteps ? null : NO_CAPTURE),
    cnt('mqal', 'Capture', 'Tier 1–3 signup domains', 'Captured emails at Tier 1–3 companies', null, null, 'Captured emails aren’t stored in Snowflake, so their domains can’t be tiered yet'),
    cnt('sends', 'Nurture', 'Email sends', 'Follow-up emails sent', null, null, LIFECYCLE),
    cnt('opens', 'Nurture', 'Email opens', 'Follow-up emails opened', null, null, LIFECYCLE),
    rt('open_rate', 'Nurture', 'Email open rate', 'Email opens ÷ email sends', null, null, STEP_GOALS.open, LIFECYCLE),
    cnt('clicks', 'Nurture', 'Email clicks', 'Clicks in the follow-up email', null, null, LIFECYCLE),
    rt('click_rate', 'Nurture', 'Email click-through rate', 'Email clicks ÷ email opens', null, null, STEP_GOALS.click, LIFECYCLE),
    cnt('ws', 'Workspaces', 'New workspaces', 'First-touch workspaces from the creators’ links', pc.newWs, pp.newWs),
    rt('ws_rate', 'Workspaces', 'Visit → workspace', wsRateDef, rate(pc.newWs, showEmailSteps ? pc.captures : pc.visits), rate(pp.newWs, showEmailSteps ? pp.captures : pp.visits),
      showEmailSteps ? STEP_GOALS.newWorkspaceOfCaptures : STEP_GOALS.newWorkspace),
    cnt('t13', 'Workspaces', 'Tier 1–3 workspaces', 'New workspaces at Salesforce Tier 1–3 companies', t13(pc.tiersNew), t13(pp.tiersNew)),
    cnt('activated', 'Workspaces', 'Activated workspaces', 'Built a golden table (1 basic + 2 advanced enrichments in one table) within 7 days', pc.activated, pp.activated),
    rt('activation_rate', 'Workspaces', 'Activation rate', 'Activated ÷ new workspaces', rate(pc.activated, pc.newWs), rate(pp.activated, pp.newWs), null),
    cnt('paid', 'Workspaces', 'Paying workspaces', 'New workspaces with a paid invoice', pc.paid, pp.paid),
    rt('paid_rate', 'Workspaces', 'Paid rate', 'Paying ÷ new workspaces', rate(pc.paid, pc.newWs), rate(pp.paid, pp.newWs), null),
  ]
  const byId = (id: string) => funnel.find(f => f.id === id)!
  /** Rate tiles under the chart, same order and names as the funnel's rate rows. */
  const rateTiles = ['thumb_ctr', 'cta_ctr', 'capture_rate', 'open_rate', 'click_rate', 'ws_rate', 'activation_rate', 'paid_rate'].map(byId)

  // ── All channels rows ──────────────────────────────────────────────────────
  const untagged = { visits: one('vis', 'cur', 'untagged').n, prevVisits: one('vis', 'prev', 'untagged').n, ws: one('ws', 'cur', 'untagged'), prevWs: one('ws', 'prev', 'untagged') }
  // Signups the governed attribution gives to YouTube from the "how did you hear about us" answer only: no creator or video.
  const survey = { ws: one('ws', 'cur', 'survey'), prevWs: one('ws', 'prev', 'survey') }
  const unmapped = [...new Set(rows.filter(r => r.key.startsWith('unmapped:')).map(r => r.key))].map(key => ({
    campaign: key.slice('unmapped:'.length), visits: one('vis', 'cur', key).n, prevVisits: one('vis', 'prev', key).n, ws: one('ws', 'cur', key).n,
  })).sort((a, b) => b.visits - a.visits)
  const channelRows = channels.map(c => {
    if (!c.doc) return { id: c.ch.id, label: c.ch.label, connected: false } as const
    const cc = c as Ch
    const t = totals(cc, 'cur'), tp = totals(cc, 'prev')
    return {
      id: c.ch.id, label: c.ch.label, connected: true as const, handle: c.doc.handle, analytics: cc.analytics,
      prev: { impressions: tp.impressions, views: tp.views, visits: tp.visits, newWs: tp.newWs },
      views: t.views, impressions: t.impressions, imprClicks: t.imprClicks, visits: t.visits, captures: t.captures, newWs: t.newWs, tiersNew: t.tiersNew,
      existing: t.existing, tiersExisting: t.tiersExisting,
      trackedCount: cc.videos.filter(v => v.tagged).length, videoCount: cc.videos.length,
      trackedShare: cc.videos.length ? cc.videos.filter(v => v.tagged).length / cc.videos.length : null,
      matching: c.ch.fallback ? 'channel rule' : 'per-video campaign',
    }
  })

  // ── Trend (calendar, one point per day; the previous period is aligned day by day) ──
  const days = daysBetween(o.cur[0], o.cur[1])
  const scopeKeys = new Set(inScope.flatMap(c => [...c.keys]))
  const viewKeys = new Set(withViews.flatMap(c => [...c.keys]))
  const wsMatch = (key: string) => scopeKeys.has(key) || (o.scope === 'all' && key === 'untagged')
  /** Per-day values; a day YouTube hasn't delivered yet is null (a gap), never 0. */
  const ytDay = (cs: Ch[], day: ISODate, f: (c: Ch) => number | null) =>
    !cs.length || cs.some(c => !c.through || day > c.through) ? null : sum(cs.map(c => f(c) ?? 0))
  const dayRows = (k: string, day: ISODate, m: (key: string) => boolean) => rows.filter(r => r.k === k && r.d === day && m(r.key))
  type DayVals = { impr: number | null; clk: number | null; views: number | null; visits: number; viewVisits: number; ws: number; act: number; paid: number; t13: number }
  const dayVals = (day: ISODate): DayVals => {
    const ws = dayRows('wsday', day, wsMatch)
    return {
      impr: withImpr.some(c => !c.imprDays.has(day)) ? null : ytDay(withImpr, day, c => c.doc!.impressionsDaily!.find(r => r[0] === day)?.[1] ?? 0),
      clk: withImpr.some(c => !c.imprDays.has(day)) ? null : ytDay(withImpr, day, c => c.doc!.impressionsDaily!.find(r => r[0] === day)?.[2] ?? 0),
      views: ytDay(withViews, day, c => c.doc!.daily.find(r => r[0] === day)?.[1] ?? 0),
      visits: sum(dayRows('vday', day, k => scopeKeys.has(k)).map(r => r.n)),
      viewVisits: sum(dayRows('vday', day, k => viewKeys.has(k)).map(r => r.n)),
      ws: sum(ws.map(r => r.n)), act: sum(ws.map(r => r.a)), paid: sum(ws.map(r => r.p)), t13: sum(ws.map(r => r.t[0] + r.t[1] + r.t[2])),
    }
  }
  const curDays = Array.from({ length: days }, (_, i) => addDays(o.cur[0], i))
  const prevDays = Array.from({ length: days }, (_, i) => addDays(o.prev[0], i))
  const cv = curDays.map(dayVals), pv = prevDays.map(dayVals)
  const ratio = (a: number | null, b: number | null) => (a != null && b ? a / b : null)
  type TrendDef = { metric: string; label: string; kind: 'count' | 'rate'; num: (x: DayVals) => number | null; den?: (x: DayVals) => number | null; note?: string }
  const TREND: TrendDef[] = [
    { metric: 'impressions', label: 'Impressions', kind: 'count', num: x => x.impr },
    { metric: 'views', label: 'Views', kind: 'count', num: x => x.views },
    { metric: 'thumb_ctr', label: 'Thumbnail CTR', kind: 'rate', num: x => x.clk, den: x => x.impr, note: 'Thumbnail clicks ÷ impressions (YouTube Reporting API)' },
    { metric: 'visits', label: 'Referral visits', kind: 'count', num: x => x.visits },
    { metric: 'cta_ctr', label: 'CTA CTR', kind: 'rate', num: x => (x.views == null ? null : x.viewVisits), den: x => x.views, note: 'Referral visits ÷ views, channels with views only' },
    { metric: 't13', label: 'Tier 1–3 workspaces', kind: 'count', num: x => x.t13 },
    { metric: 'ws', label: 'New workspaces', kind: 'count', num: x => x.ws },
    { metric: 'activated', label: 'Activated workspaces', kind: 'count', num: x => x.act, note: 'Built a golden table within 7 days; the last 7 days are still filling in' },
    { metric: 'paid', label: 'Paying workspaces', kind: 'count', num: x => x.paid },
  ]
  // Totals over the days both periods have (so a lagging YouTube day never counts against one side only).
  const both = (d: TrendDef, i: number) => d.num(cv[i]) != null && d.num(pv[i]) != null && (!d.den || (d.den(cv[i]) != null && d.den(pv[i]) != null))
  const trend = TREND.map(d => {
    const pt = (x: DayVals) => (d.den ? ratio(d.num(x), d.den(x)) : d.num(x))
    const idx = curDays.map((_, i) => i).filter(i => both(d, i))
    const tot = (vs: DayVals[]) => {
      if (!idx.length) return null
      const n = sum(idx.map(i => d.num(vs[i]) ?? 0))
      return d.den ? ratio(n, sum(idx.map(i => d.den!(vs[i]) ?? 0))) : n
    }
    const available = cv.some(x => d.num(x) != null)
    return { metric: d.metric, label: d.label, kind: d.kind, note: d.note ?? null, available, days: idx.length,
      cur: curDays.map((day, i) => ({ d: day, v: pt(cv[i]) })), prev: prevDays.map((day, i) => ({ d: day, v: pt(pv[i]) })),
      total: { cur: tot(cv), prev: tot(pv) } }
  }).filter(t => t.available || ['impressions', 'views', 'thumb_ctr', 'cta_ctr'].includes(t.metric))

  const withUntagged = o.scope === 'all'
  const allNew = pc.newWs + (withUntagged ? untagged.ws.n : 0)
  const allNewPrev = pp.newWs + (withUntagged ? untagged.prevWs.n : 0)
  const act = pc.activated + (withUntagged ? untagged.ws.a : 0); const actPrev = pp.activated + (withUntagged ? untagged.prevWs.a : 0)
  const paid = pc.paid + (withUntagged ? untagged.ws.p : 0); const paidPrev = pp.paid + (withUntagged ? untagged.prevWs.p : 0)
  const exp = pc.expanded + (withUntagged ? untagged.ws.x : 0); const churn = pc.churned + (withUntagged ? untagged.ws.c : 0)
  const scopeChannel = o.scope === 'all' ? null : CHANNELS.find(c => c.id === o.scope)!

  // ── What moved (lib/plg/insights.ts rules) ─────────────────────────────────
  const insight: Insight = (() => {
    const title = (id: string) => scopeVideos.find(v => v.id === id)?.title ?? null
    const chOf = (id: string) => scopeVideos.find(v => v.id === id)?.channel ?? null
    const curEnd = ytCurEnd, prevEnd = ytPrevEnd
    const inR = (d: ISODate, a: ISODate, e: ISODate) => d >= a && d <= e
    // Views per in-window video over the aligned days; the rest of each channel's views is its back catalog.
    const viewItems: Item[] = []
    for (const c of withViews) {
      const doc = c.doc!
      let vc = 0, vp = 0
      for (const v of doc.videos) {
        const cur = sum(v.daily.filter(r => inR(r[0], o.cur[0], curEnd)).map(r => r[1]))
        const prev = sum(v.daily.filter(r => inR(r[0], o.prev[0], prevEnd)).map(r => r[1]))
        if (!cur && !prev) continue
        vc += cur; vp += prev
        viewItems.push({ label: v.title, cur, prev, tags: o.scope === 'all' ? [`creator: ${c.ch.label}`] : [] })
      }
      const tc = sum(doc.daily.filter(r => inR(r[0], o.cur[0], curEnd)).map(r => r[1])), tp = sum(doc.daily.filter(r => inR(r[0], o.prev[0], prevEnd)).map(r => r[1]))
      if (tc - vc || tp - vp) viewItems.push({ label: `${c.ch.label}: older videos`, cur: tc - vc, prev: tp - vp })
    }
    // Referral visits and new workspaces per tracked key (video, channel-wide link).
    const keyLabel = (k: string) => k.startsWith('ch:') ? `${CHANNELS.find(c => `ch:${c.id}` === k)?.label ?? k}: channel link` : title(k) ?? k
    const keyed = (kind: 'vis' | 'ws') => [...scopeKeys].map(k => ({ label: keyLabel(k), cur: one(kind, 'cur', k).n, prev: one(kind, 'prev', k).n,
      tags: o.scope === 'all' && !k.startsWith('ch:') && chOf(k) ? [`creator: ${chOf(k)}`] : [] })).filter(x => x.cur || x.prev)
    const views = byId('views'), visits = byId('visits'), ws = byId('ws')
    const drivers: (Para | Block)[] = []
    if (views.cur != null && views.prev != null) { const d = driverPara('Views', 'views', { cur: views.cur, prev: views.prev }, viewItems, { minVolume: 50, noun: 'videos' }); if (d) drivers.push(d) }
    const dv = driverPara('Referral visits', 'visits', { cur: pc.visits, prev: pp.visits }, keyed('vis'), { minVolume: 3, noun: 'videos' }); if (dv) drivers.push(dv)
    if (pc.newWs || pp.newWs) { const d = driverPara('New workspaces', 'workspaces', { cur: pc.newWs, prev: pp.newWs }, keyed('ws'), { noun: 'videos' }); if (d) drivers.push(d) }
    // Emerging: in-window videos with 500+ views this period, 5× the period before (or published in the last 10 days), thumbnail CTR ≥ 2%.
    const cited = new Set(drivers.flatMap(d => (Array.isArray(d) ? d : [d.lead, ...d.bullets].flat())).filter((x): x is { k: 'code'; s: string } => typeof x !== 'string' && x.k === 'code').map(x => x.s))
    const emerging: Para[] = []
    for (const c of withViews) for (const v of c.doc!.videos) {
      if (emerging.length >= 2) break
      const cur = sum(v.daily.filter(r => inR(r[0], o.cur[0], curEnd)).map(r => r[1])), prev = sum(v.daily.filter(r => inR(r[0], o.prev[0], prevEnd)).map(r => r[1]))
      const imp = (v.impressions ?? []).filter(r => inR(r[0], o.cur[0], curEnd)); const ii = sum(imp.map(r => r[1])), ic2 = sum(imp.map(r => r[2]))
      const ctr = ii ? ic2 / ii : null
      const fresh = v.published >= addDays(o.dataEnd, -10)
      if (cur >= 500 && (fresh || cur >= prev * 5) && (ctr == null || ctr >= 0.02) && !cited.has(v.title))
        emerging.push([code(v.title), ` (${c.ch.label}${fresh ? ', new' : ''}): ${cur.toLocaleString('en-US')} views this period${fresh ? '' : ` (vs ${prev.toLocaleString('en-US')})`}${ctr != null ? `; thumbnail CTR ${pctTxt(ctr)}` : ''}.`])
    }
    // Anomalies: 10× views with an implausible thumbnail CTR (3× the channel's) or almost no watch time (≤ 10% of the channel's per view).
    const anomalies: Para[] = []
    for (const c of withViews) {
      const doc = c.doc!
      const chDays = doc.daily.filter(r => inR(r[0], o.cur[0], curEnd)); const chViews = sum(chDays.map(r => r[1])), chMin = sum(chDays.map(r => r[2]))
      const chImp = (doc.impressionsDaily ?? []).filter(r => inR(r[0], o.cur[0], curEnd)); const chCtr = sum(chImp.map(r => r[1])) ? sum(chImp.map(r => r[2])) / sum(chImp.map(r => r[1])) : null
      for (const v of doc.videos) {
        const d = v.daily.filter(r => inR(r[0], o.cur[0], curEnd)); const cur = sum(d.map(r => r[1])), mins = sum(d.map(r => r[2]))
        const prev = sum(v.daily.filter(r => inR(r[0], o.prev[0], prevEnd)).map(r => r[1]))
        if (cur < 500 || cur < Math.max(1, prev) * 10) continue
        const imp = (v.impressions ?? []).filter(r => inR(r[0], o.cur[0], curEnd)); const ctr = sum(imp.map(r => r[1])) ? sum(imp.map(r => r[2])) / sum(imp.map(r => r[1])) : null
        const watch = cur ? mins / cur : null, chWatch = chViews ? chMin / chViews : null
        const badCtr = ctr != null && chCtr != null && ctr >= chCtr * 3, badWatch = watch != null && chWatch != null && watch <= chWatch * 0.1
        if (badCtr || badWatch) anomalies.push([code(v.title), ` (${c.ch.label}): ${cur.toLocaleString('en-US')} views this period (${prev ? `${Math.round(cur / prev)}×` : 'from none'} the period before)`,
          ...(ctr != null ? [` at ${pctTxt(ctr)} thumbnail CTR (channel ${pctTxt(chCtr)})`] : []), ...(watch != null ? [`, ${(watch * 60).toFixed(0)} s watched per view (channel ${((chWatch ?? 0) * 60).toFixed(0)} s)`] : []), '. This pattern usually means embedded autoplay or bot views.'])
      }
    }
    const hl = (id: string, kind: 'count' | 'rate' = 'count') => {
      const f = byId(id); return f.nc ? null : headlineLine(f.label, f.cur, f.prev, { kind })
    }
    const headline = [hl('impressions'), hl('views'), hl('thumb_ctr', 'rate'), hl('visits'), hl('cta_ctr', 'rate'),
      showEmailSteps ? hl('capture_rate', 'rate') : null,
      hl('ws'), hl('t13')].filter((x): x is Para => !!x)
    const syncAge = inScope.length ? (Date.now() - Math.min(...inScope.map(c => Date.parse(c.doc!.fetchedAt)))) / 36e5 : null
    const notes = [ytLastDay && ytLastDay < o.cur[1] ? `YouTube numbers run through ${ytLastDay}; one or more channels report 2–3 days late, so both periods use the same ${ytDays} days.` : null,
      syncAge != null && syncAge > 48 ? `YouTube data was last synced ${Math.round(syncAge / 24)} days ago.` : null].filter(Boolean)
    return { note: notes.join(' ') || null, headline, drivers, emerging, anomalies, goals: [] }
  })()

  // Channels matched as a whole (one affiliate code or link for every video, e.g. Eric's ?via=bb305b): visits and workspaces
  // exist only for the channel, so the Videos table gets one channel row instead of a column of dashes per video.
  const channelLevel = scopeChannel?.fallback && !scopeVideos.some(v => v.tagged) ? (() => {
    const k = `ch:${scopeChannel.id}`, vis = one('vis', 'cur', k), ws = one('ws', 'cur', k), ex = one('ex', 'cur', k)
    return { visits: vis.n, newWs: ws.n, activated: ws.a, paid: ws.p, tiersNew: ws.t, existing: ex.n, tiersExisting: ex.t, views: (() => { const d = o.yt.find(x => x.channelId === scopeChannel.youtubeId); return d && d.analyticsAccess !== false ? sum(d.daily.filter(r => r[0] >= o.cur[0] && r[0] <= ytCurEnd).map(r => r[1])) : null })() }
  })() : null

  // ── Deep dive for any selection: channels (empty = every channel in scope) and/or specific videos ──
  // Videos selected → their own YouTube numbers and visits; otherwise the channels' totals (older videos included) and
  // every key the channels own (videos and channel-wide links). Visitors are summed across keys, as everywhere else.
  const deep = (sel: { channels: string[]; videos: string[] }) => {
    const chs = inScope.filter(c => !sel.channels.length || sel.channels.includes(c.ch.id))
    const vidIds = sel.videos.filter(id => chs.some(c => c.videos.some(v => v.id === id)))
    const byVideo = vidIds.length > 0
    const keys = byVideo ? vidIds : chs.flatMap(c => [...c.keys])
    const keySet = new Set(keys)
    const nDays = daysBetween(o.cur[0], o.cur[1])
    const ytVideos = (c: Ch) => (byVideo ? c.doc!.videos.filter(v => vidIds.includes(v.id)) : null)
    type Day = { d: ISODate; views: number | null; minutes: number | null; subs: number | null; impr: number | null; clk: number | null; visits: number; ws: number }
    const series = (start: ISODate, ytEnd: ISODate): Day[] => Array.from({ length: nDays }, (_, i) => {
      const d = addDays(start, i), yt = d <= ytEnd
      let views: number | null = null, minutes: number | null = null, subs: number | null = null, impr: number | null = null, clk: number | null = null
      for (const c of chs) {
        if (c.analytics && yt) {
          const vs = ytVideos(c)
          const rs = vs ? vs.map(v => v.daily.find(r => r[0] === d)) : [c.doc!.daily.find(r => r[0] === d)]
          views = (views ?? 0) + sum(rs.map(r => r?.[1] ?? 0)); minutes = (minutes ?? 0) + sum(rs.map(r => r?.[2] ?? 0))
          subs = (subs ?? 0) + sum(rs.map(r => (vs ? r?.[4] : (r as [ISODate, number, number, number, number, number] | undefined)?.[3] ?? 0) ?? 0))
        }
        if (c.imprState === 'live' && yt && c.imprDays.has(d)) {
          const vs = ytVideos(c)
          const rs = vs ? vs.map(v => v.impressions?.find(r => r[0] === d)) : [c.doc!.impressionsDaily!.find(r => r[0] === d)]
          impr = (impr ?? 0) + sum(rs.map(r => r?.[1] ?? 0)); clk = (clk ?? 0) + sum(rs.map(r => r?.[2] ?? 0))
        }
      }
      const dk = (k: string) => sum(rows.filter(r => r.k === k && r.d === d && keySet.has(r.key)).map(r => r.n))
      return { d, views, minutes, subs, impr, clk, visits: dk('vday'), ws: dk('wsday') }
    })
    const cur = series(o.cur[0], ytCurEnd), prev = series(o.prev[0], ytPrevEnd)
    const tot = (b: 'cur' | 'prev', xs: Day[]) => {
      const nn = (k: 'views' | 'minutes' | 'subs' | 'impr' | 'clk') => (xs.some(x => x[k] != null) ? sum(xs.map(x => x[k] ?? 0)) : null)
      const ws = keys.map(k => one('ws', b, k)), ex = keys.map(k => one('ex', b, k))
      return { views: nn('views'), minutes: nn('minutes'), subs: nn('subs'), impr: nn('impr'), clk: nn('clk'),
        visits: sum(keys.map(k => one('vis', b, k).n)), captures: sum(keys.map(k => one('form', b, k).n)),
        newWs: sum(ws.map(x => x.n)), activated: sum(ws.map(x => x.a)), paid: sum(ws.map(x => x.p)), expanded: sum(ws.map(x => x.x)), churned: sum(ws.map(x => x.c)),
        tiersNew: ws.reduce((a, x) => addT(a, x.t), zeroT()), existing: sum(ex.map(x => x.n)), tiersExisting: ex.reduce((a, x) => addT(a, x.t), zeroT()) }
    }
    const T0 = tot('cur', cur), T1 = tot('prev', prev)
    const pm = new Map<string, number>()
    for (const r of rows) if (r.k === 'per' && r.b === 'cur' && keySet.has(r.key)) pm.set(r.d, (pm.get(r.d) ?? 0) + r.n)
    const persona = [...pm.entries()].map(([label, n]) => ({ label, n })).sort((a, c) => (a.label === 'No answer' ? 1 : c.label === 'No answer' ? -1 : c.n - a.n))
    const plans = plansOf(rows.filter(r => r.k === 'plan' && r.b === 'cur' && keySet.has(r.key)))
    const mm = new Map<string, { month: string; n: number; act: number; paid: number; exp: number; churn: number }>()
    for (const r of rows) if (r.k === 'mon' && r.b === 'cur' && keySet.has(r.key)) {
      const e = mm.get(r.d) ?? { month: r.d, n: 0, act: 0, paid: 0, exp: 0, churn: 0 }; e.n += r.n; e.act += r.a; e.paid += r.p; e.exp += r.x; e.churn += r.c; mm.set(r.d, e)
    }
    const signupMonths = [...mm.values()].sort((a, c) => a.month.localeCompare(c.month))
    // Visitors are only tied to a video through a tracked link: a selection with none can't show traffic.
    const tracked = byVideo ? vidIds.some(id => scopeVideos.find(v => v.id === id)?.tagged) : true
    const offerPage = byVideo ? vidIds.some(id => scopeVideos.find(v => v.id === id)?.offerPage) : scopeVideos.some(v => v.offerPage && v.tagged)
    return {
      byVideo, videoIds: vidIds, channels: chs.map(c => c.ch.label), tracked, offerPage,
      cur, prev, T0, T1, persona, signupMonths,
      tiers: { labels: TIER_LABELS, fresh: T0.tiersNew, existing: T0.tiersExisting },
      afterSignup: { n: T0.newWs, free: T0.newWs - T0.paid, paidOnly: Math.max(0, T0.paid - T0.expanded - T0.churned), expanded: T0.expanded, churned: T0.churned, plans },
      cuts: { device: cutOf('dev', keys), geo: cutOf('geo', keys) },
    }
  }

  return {
    scope: o.scope, mode: o.mode,
    channel: scopeChannel ? { id: scopeChannel.id, label: scopeChannel.label, handle: scopeChannel.handle, fallbackNote: scopeChannel.fallback?.note ?? null } : null,
    yt: { lastDay: ytLastDay, lagging: !!ytLastDay && ytLastDay < o.cur[1], days: ytDays, periodDays: daysBetween(o.cur[0], o.cur[1]), viewsKnown,
      fetchedAt: inScope.map(c => c.doc!.fetchedAt).sort()[0] ?? null },
    kpis: {
      newWs: { cur: allNew, prev: allNewPrev, delta: pct(allNew, allNewPrev), tagged: pc.newWs, untagged: withUntagged ? untagged.ws.n : null,
        survey: withUntagged ? { cur: survey.ws.n, prev: survey.prevWs.n } : null },
      activated: { cur: act, prev: actPrev, delta: pct(act, actPrev), rate: rate(act, allNew) },
      paid: { cur: paid, prev: paidPrev, delta: pct(paid, paidPrev), rate: rate(paid, allNew), churned: churn },
      impressions: { cur: ic?.impressions ?? null, prev: prevImprOk ? ip!.impressions : null, delta: prevImprOk ? pct(ic?.impressions ?? null, ip!.impressions) : null,
                     prevPartial: !!ip && !prevImprOk, excluded: inScope.filter(c => c.imprState !== 'live').map(c => c.ch.label) },
      thumbCtr: { cur: rate(ic?.imprClicks ?? null, ic?.impressions ?? null), prev: prevImprOk ? rate(ip!.imprClicks, ip!.impressions) : null },
      ctaCtr: { cur: rate(vc?.visits ?? null, vc?.views ?? null), prev: rate(vp?.visits ?? null, vp?.views ?? null) },
      tier13: (() => {
        const t = (x: number[]) => x[0] + x[1] + x[2]
        const cur = t(pc.tiersNew) + (withUntagged ? t(untagged.ws.t) : 0), prev = t(pp.tiersNew) + (withUntagged ? t(untagged.prevWs.t) : 0)
        return { cur, prev, delta: pct(cur, prev), untagged: withUntagged ? t(untagged.ws.t) : null }
      })(),
      views: { cur: vc?.views ?? null, prev: vp?.views ?? null, delta: pct(vc?.views ?? null, vp?.views ?? null), avgPct: vc?.avgPct ?? null, subs: vc?.subs ?? 0, minutes: vc?.minutes ?? 0,
               known: viewsKnown, excluded: inScope.filter(c => !c.analytics).map(c => c.ch.label) },
      lifetimeViews: sum(scopeVideos.map(v => v.lifetimeViews)),
      visits: { cur: pc.visits, prev: pp.visits, delta: pct(pc.visits, pp.visits), untagged: withUntagged ? untagged.visits : null },
      captures: { cur: pc.captures, prev: pp.captures, delta: pct(pc.captures, pp.captures) },
      cohortVideos: o.mode === 'cohort' ? (pc.videos ?? 0) : null,
      pendingVideos: pc.pending,
    },
    funnel, rateTiles, showEmailSteps, insight,
    afterSignup: {
      n: allNew, free: allNew - paid, paidOnly: Math.max(0, paid - exp - churn), expanded: exp, churned: churn,
      plans: withUntagged ? plansOf([...rows.filter(r => r.k === 'plan' && r.b === 'cur' && (scopeKeys.has(r.key) || r.key === 'untagged'))]) : pc.plans,
    },
    channelRows, untagged, unmapped, channelLevel,
    affiliateVisitors: one('vis', 'cur', 'affiliate').n,
    tiers: { labels: TIER_LABELS, fresh: withUntagged ? addT(pc.tiersNew, untagged.ws.t) : pc.tiersNew, existing: pc.tiersExisting },
    videos: scopeVideos,
    persona, signupMonths, backCatalog, cuts, videoPeriod, olderVideos, videoDeep, deep,
    trend, range: { cur: o.cur, prev: o.prev },
  }
}

export type SocialViewModel = ReturnType<typeof buildSocial>
