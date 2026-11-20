/**
 * Social tab view model. Pure: Sigma rows (sql.ts) + YouTube documents
 * (scripts/sync-youtube.mjs) in, render-ready numbers out.
 *
 * Anything blocked on access is null and renders "Not connected": the email
 * steps (no lifecycle data in Snowflake yet), and views / watch time for channels without
 * Analytics access. Nothing downstream substitutes a value.
 */
import { addDays, daysBetween, minDate, type ISODate } from '../dates'
import { CHANNELS, COHORT_DAYS, NO_ANALYTICS, OFFER_PAGE_PATTERNS, STEP_GOALS, TIER_LABELS, type CreatorChannel } from './config'
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
  const trackedIds = scopeVideos.filter(v => v.tagged).map(v => v.id)
  const cuts = { device: cutOf('dev', trackedIds), geo: cutOf('geo', trackedIds) }

  // ── Funnel (email steps only when an in-scope video links to the offer page) ──
  const periodVideos = o.mode === 'cohort' ? scopeVideos.filter(v => inCohort(v.published, o.cur)) : scopeVideos
  const showEmailSteps = periodVideos.some(v => v.offerPage && v.tagged)
  const wsBase = showEmailSteps ? pc.captures : pc.visits
  const wsRate = rate(pc.newWs, wsBase)
  type Step = { id: string; stage: string; label: string; lever: string; source: string; cur: number | null; prev: number | null; rate: number | null; prevRate: number | null; goal: number | null; notConnected?: boolean; ncLabel?: string; why?: string; impact: number | null; goalNote?: string }
  const nc = (id: string, stage: string, label: string, lever: string, source: string, goal: number | null, why: string): Step =>
    ({ id, stage, label, lever, source, cur: null, prev: null, rate: null, prevRate: null, goal, notConnected: true, impact: null, why })
  const viewsKnown = inScope.length > 0 && inScope.every(c => c.analytics)
  const imprLive = inScope.length > 0 && inScope.every(c => c.imprState === 'live')
  const imprPartial = imprLive && pc.imprHave < pc.imprDays
  // Shown even while Google is still backfilling (partial periods are flagged on the row, not hidden).
  const imprKnown = imprLive
  const firstReport = inScope.flatMap(c => [...c.imprDays]).sort()[0]
  const imprWhy = inScope.some(c => c.imprState === 'none')
    ? 'Needs the channel owner’s one-time sign-in (YouTube Reporting API, channel_reach_basic_a1)'
    : imprPartial
      ? `Google has delivered impressions for ${pc.imprHave} of ${pc.imprDays} days in this period so far (reports start ${firstReport}, about 30 days before the report job was set up). Impressions and view rate show once every day is in, so they're never compared with views from other days.`
      : 'Report job is set up; Google delivers the first daily files about 48 hours after setup'
  const steps: Step[] = [
    { id: 'impr', stage: 'Reach', label: 'Impressions', lever: 'Thumbnail, title, topic, cadence',
      source: imprPartial ? `YouTube Reporting API · partial: ${pc.imprHave} of ${pc.imprDays} days delivered so far` : 'YouTube Reporting API', cur: pc.impressions, prev: pp.impressions, rate: null, prevRate: null, goal: null,
      notConnected: !imprKnown, why: imprWhy, impact: null },
    { id: 'views', stage: 'Reach', label: 'Views', lever: 'Thumbnail & title', source: 'YouTube Analytics API', cur: pc.views, prev: pp.views,
      rate: imprKnown ? rate(pc.views, pc.impressions) : null, prevRate: imprKnown ? rate(pp.views, pp.impressions) : null, goal: null,
      notConnected: !viewsKnown, why: NO_ANALYTICS, impact: null },
    { id: 'visits', stage: 'Click', label: showEmailSteps ? 'Offer page visits' : 'Site visits (tagged links)', lever: 'CTA: pinned comment, description, end screen', source: 'Snowflake · MARKETING_PAGEVIEWS', cur: pc.visits, prev: pp.visits,
      rate: rate(pc.visits, pc.views), prevRate: rate(pp.visits, pp.views), goal: STEP_GOALS.viewToVisit,
      // Extra new workspaces if this step hit goal, holding every later step at today's rate.
      impact: pc.views ? Math.max(0, (pc.views * STEP_GOALS.viewToVisit - pc.visits) * (rate(pc.newWs, pc.visits) ?? 0)) : null },
  ]
  // Email steps always show; placeholders until the data exists. Captures are real only for offer-page links.
  const LIFECYCLE = 'Lifecycle email sends, opens and clicks (Inflection) aren’t in Snowflake yet'
  steps.push(
    showEmailSteps
      ? { id: 'captures', stage: 'Capture', label: 'Email captures', lever: 'Offer page headline & form', source: 'Snowflake · SEGMENT.VERCEL.FORM_SUBMITTED', cur: pc.captures, prev: pp.captures,
          rate: rate(pc.captures, pc.visits), prevRate: rate(pp.captures, pp.visits), goal: STEP_GOALS.capture,
          impact: pc.visits ? Math.max(0, (pc.visits * STEP_GOALS.capture - pc.captures) * (rate(pc.newWs, pc.captures) ?? 0)) : 0 }
      : nc('captures', 'Capture', 'Email captures', 'Offer page headline & form', 'Snowflake · SEGMENT.VERCEL.FORM_SUBMITTED', STEP_GOALS.capture,
          'No video in scope links to an email-capture page yet, so there is nothing to capture'),
    nc('qualified', 'Capture', 'MQALs (Tier 1–3 domains)', 'Who the video attracts', 'Captured email domain → Salesforce tier', STEP_GOALS.qualified,
      'Captured emails aren’t stored in Snowflake, so their domains can’t be tiered yet'),
    nc('sends', 'Nurture', 'Email sends', 'Every MQAL gets the follow-up email', 'Lifecycle (Inflection)', null, LIFECYCLE),
    nc('opens', 'Nurture', 'Email opens', 'Subject line & send time', 'Lifecycle (Inflection)', STEP_GOALS.open, LIFECYCLE),
    nc('clicks', 'Nurture', 'Email clicks', 'Email body & CTA', 'Lifecycle (Inflection)', STEP_GOALS.click, LIFECYCLE),
  )
  steps.push({ id: 'ws', stage: 'Workspaces', label: 'New workspaces (first touch)', lever: 'Signup flow', source: 'Snowflake · FIRST_TOUCH_ATTRIBUTION', cur: pc.newWs, prev: pp.newWs,
    rate: wsRate, prevRate: rate(pp.newWs, showEmailSteps ? pp.captures : pp.visits),
    goal: showEmailSteps ? STEP_GOALS.newWorkspaceOfCaptures : STEP_GOALS.newWorkspace,
    goalNote: showEmailSteps ? 'of captures (placeholder while opens/clicks aren’t connected)' : 'of site visits',
    impact: wsBase ? Math.max(0, wsBase * (showEmailSteps ? STEP_GOALS.newWorkspaceOfCaptures : STEP_GOALS.newWorkspace) - pc.newWs) : 0 })
  // Downstream of signup (as in the mockup): rates are ÷ new workspaces.
  steps.push(
    { id: 'activated', stage: 'Workspaces', label: 'Activated workspaces', lever: 'First table run within 7 days', source: 'Snowflake · FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION',
      cur: pc.activated, prev: pp.activated, rate: rate(pc.activated, pc.newWs), prevRate: rate(pp.activated, pp.newWs), goal: null, impact: null },
    { id: 'paid', stage: 'Workspaces', label: 'Paid workspaces', lever: 'First invoice paid', source: 'Snowflake · CUSTOMERS',
      cur: pc.paid, prev: pp.paid, rate: rate(pc.paid, pc.newWs), prevRate: rate(pp.paid, pp.newWs), goal: null, impact: null },
  )
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
      views: t.views, impressions: t.impressions, visits: t.visits, captures: t.captures, newWs: t.newWs, tiersNew: t.tiersNew,
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
      impr: ytDay(withImpr, day, c => c.doc!.impressionsDaily!.find(r => r[0] === day)?.[1] ?? 0),
      clk: ytDay(withImpr, day, c => c.doc!.impressionsDaily!.find(r => r[0] === day)?.[2] ?? 0),
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
    { metric: 'ws', label: 'All workspaces', kind: 'count', num: x => x.ws },
    { metric: 'activated', label: 'Activated', kind: 'count', num: x => x.act, note: 'Ran a first table within 7 days; the last 7 days are still filling in' },
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
  // Channels matched as a whole (one affiliate code or link for every video, e.g. Eric's ?via=bb305b): visits and workspaces
  // exist only for the channel, so the Videos table gets one channel row instead of a column of dashes per video.
  const channelLevel = scopeChannel?.fallback && !scopeVideos.some(v => v.tagged) ? (() => {
    const k = `ch:${scopeChannel.id}`, vis = one('vis', 'cur', k), ws = one('ws', 'cur', k), ex = one('ex', 'cur', k)
    return { visits: vis.n, newWs: ws.n, activated: ws.a, paid: ws.p, tiersNew: ws.t, existing: ex.n, tiersExisting: ex.t, views: (() => { const d = o.yt.find(x => x.channelId === scopeChannel.youtubeId); return d && d.analyticsAccess !== false ? sum(d.daily.filter(r => r[0] >= o.cur[0] && r[0] <= ytCurEnd).map(r => r[1])) : null })() }
  })() : null

  return {
    scope: o.scope, mode: o.mode,
    channel: scopeChannel ? { id: scopeChannel.id, label: scopeChannel.label, handle: scopeChannel.handle, fallbackNote: scopeChannel.fallback?.note ?? null } : null,
    yt: { lastDay: ytLastDay, lagging: !!ytLastDay && ytLastDay < o.cur[1], days: ytDays, periodDays: daysBetween(o.cur[0], o.cur[1]), viewsKnown,
      fetchedAt: inScope.map(c => c.doc!.fetchedAt).sort()[0] ?? null },
    kpis: {
      newWs: { cur: allNew, prev: allNewPrev, delta: pct(allNew, allNewPrev), tagged: pc.newWs, untagged: withUntagged ? untagged.ws.n : null },
      activated: { cur: act, prev: actPrev, delta: pct(act, actPrev), rate: rate(act, allNew) },
      paid: { cur: paid, prev: paidPrev, delta: pct(paid, paidPrev), rate: rate(paid, allNew), churned: churn },
      impressions: { cur: ic?.impressions ?? null, prev: ip?.impressions ?? null, delta: pct(ic?.impressions ?? null, ip?.impressions ?? null),
                     excluded: inScope.filter(c => c.imprState !== 'live').map(c => c.ch.label) },
      thumbCtr: { cur: rate(ic?.imprClicks ?? null, ic?.impressions ?? null), prev: rate(ip?.imprClicks ?? null, ip?.impressions ?? null) },
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
    steps, leak, showEmailSteps,
    afterSignup: {
      n: allNew, free: allNew - paid, paidOnly: Math.max(0, paid - exp - churn), expanded: exp, churned: churn,
      plans: withUntagged ? plansOf([...rows.filter(r => r.k === 'plan' && r.b === 'cur' && (scopeKeys.has(r.key) || r.key === 'untagged'))]) : pc.plans,
    },
    channelRows, untagged, unmapped, channelLevel,
    affiliateVisitors: one('vis', 'cur', 'affiliate').n,
    tiers: { labels: TIER_LABELS, fresh: withUntagged ? addT(pc.tiersNew, untagged.ws.t) : pc.tiersNew, existing: pc.tiersExisting },
    videos: scopeVideos,
    persona, signupMonths, backCatalog, cuts,
    trend, range: { cur: o.cur, prev: o.prev },
  }
}

export type SocialViewModel = ReturnType<typeof buildSocial>
