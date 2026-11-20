/**
 * Content insights: the creator program's videos joined to what the warehouse says they drove.
 *
 *   placements   the program's placement list (affiliate team's Influencer Master sheet → youtube/creators):
 *                creator, video, link token, placement type, fit tier, and the team's own data-quality flags
 *   videos       public YouTube metadata per video (length, views, chapters, where the Clay link sits)
 *   channels     each creator channel's median views (recent long-form, newest 5 excluded): the baseline a sponsored
 *                video is compared against, the same way Eric's demand map scores outliers
 *   warehouse    per link token per week (lib/plg/creators/sql.ts): visitors, new workspaces, Tier 1–3, activated
 *                within 7 days (of matured workspaces), paid
 *
 * Attribution per video: a token used by one video is that video's ("direct"). A token shared by several videos, or
 * flagged by the program, can only be read at the creator level ("shared") or not at all ("excluded"). Rates per
 * 1,000 views use direct videos only, lifetime workspaces over lifetime views, both since the program's start.
 */
import type { Insight, Para } from '../insights'

export type Placement = {
  creator: string | null; fit: string | null; status: string | null; agency: string | null; title: string | null; channelUrl: string | null
  url: string | null; platform: string | null; vid: string | null; live: string | null; videoStatus: string | null; format: string | null
  placement: string | null; views: number | null; clicks: number | null; signups: number | null; conversions: number | null
  excluded: boolean; measurable: boolean; shared: boolean; token: string
}
export type VideoMeta = { title: string; channelId: string; channel: string; published: string; secs: number; views: number; likes: number; comments: number; chapters: number; clayLine: number | null; links: number; chars: number }
export type ChannelMeta = { title: string; subs: number | null; videos: number | null; median: number | null; sample: number }
export type Preview = {
  source: string; baseRate: number
  subjects: [string, number, number, number][]
  formats: [string, number, number][]
  ideas: { idea: string; title: string; verdict: string; evidence: string; why: string }[]
}
export type CreatorsDoc = {
  fetchedAt: string; sheetAsOf?: string | null; placements: Placement[]; daily: Record<string, [string, number | null, number | null, number | null, number | null][]>
  videos: Record<string, VideoMeta>; channels: Record<string, ChannelMeta>; preview: Preview | null; thumbParts?: number
}

export type Wk = { vis: number; ws: number; t13: number; act: number; mat: number; paid: number }
const zero = (): Wk => ({ vis: 0, ws: 0, t13: 0, act: 0, mat: 0, paid: 0 })
const add = (a: Wk, b: Wk) => { a.vis += b.vis; a.ws += b.ws; a.t13 += b.t13; a.act += b.act; a.mat += b.mat; a.paid += b.paid; return a }

export type Period = 'all' | '12w' | '4w'
export const PERIODS: { id: Period; label: string; weeks: number | null }[] = [
  { id: 'all', label: 'Since Apr 6', weeks: null }, { id: '12w', label: 'Last 12 weeks', weeks: 12 }, { id: '4w', label: 'Last 4 weeks', weeks: 4 },
]
export type Attribution = 'direct' | 'shared' | 'excluded' | 'unmeasured'
export const ATTRIBUTION: Record<Attribution, string> = {
  direct: 'Own link', shared: 'Shared link', excluded: 'Excluded by the program', unmeasured: 'Not measurable',
}

export type VideoRow = {
  key: string; creator: string; fit: string | null; agency: string | null; placement: string; format: string | null
  title: string; vid: string | null; url: string | null; live: string | null; channel: string | null
  views: number | null; median: number | null; multiple: number | null; mins: number | null; chapters: number | null; clayLine: number | null
  token: string; sharedWith: number; attribution: Attribution
  rw: { clicks: number | null; signups: number | null; conv: number | null }
  /** Warehouse, in the selected period (token totals; for shared links, the whole token). */
  m: Wk
  /** Lifetime: workspaces per 1,000 views (direct only), share of workspaces in the first 14 days after go-live. */
  life: Wk; perK: number | null; early: number | null
  /** Weekly new workspaces since the go-live week (lifetime, for the sparkline). */
  spark: number[]
  young: boolean
}
export type CreatorRow = { creator: string; fit: string | null; agency: string | null; videos: number; views: number; m: Wk; life: Wk; perK: number | null; tokens: string[] }
export type Pattern = { factor: string; rows: { label: string; videos: number; views: number; ws: number; perK: number | null; median: number | null }[] }
/** of: the stage this one is a rate of (not always the one before: activation is of matured workspaces). */
export type FunnelStep = { label: string; value: number | null; note: string; owner: string; of?: { label: string; value: number } }

export type CreatorsData = {
  period: Period; weeks: string[]; dataEnd: string; fetchedAt: string
  funnel: FunnelStep[]
  program: Wk; all: Wk; programShare: number | null
  videos: VideoRow[]; creators: CreatorRow[]
  unmapped: { tok: string; m: Wk; life: Wk }[]
  reconcile: { token: string; creator: string; rewardful: number; warehouse: number }[]
  patterns: Pattern[]
  medianPerK: number | null
  preview: Preview | null
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** Week start as the warehouse buckets it (DATE_TRUNC('week') starts on Sunday in this Snowflake account). */
const weekOf = (day: string) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return iso(d) }
const plusDays = (day: string, n: number) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }

/** Warehouse rows → token → week → counts. Expects columns k, tok, wk, n1..n5 (the contract checks this first). */
export function parseCreatorRows(payload: unknown): Map<string, Map<string, Wk>> {
  const p = payload as { columns: string[]; rows: unknown[][] }
  const cols = p.columns.map(c => String(c).toLowerCase()), ix = (c: string) => cols.indexOf(c)
  const [k, tok, wk, n1, n2, n3, n4, n5] = ['k', 'tok', 'wk', 'n1', 'n2', 'n3', 'n4', 'n5'].map(ix)
  const out = new Map<string, Map<string, Wk>>()
  for (const r of p.rows) {
    const t = String(r[tok] ?? ''), w = String(r[wk] ?? '').slice(0, 10)
    if (!t || !w) continue
    const m = out.get(t) ?? out.set(t, new Map()).get(t)!
    const c = m.get(w) ?? m.set(w, zero()).get(w)!
    if (r[k] === 'v') c.vis += Number(r[n1]) || 0
    else { c.ws += Number(r[n1]) || 0; c.t13 += Number(r[n2]) || 0; c.act += Number(r[n3]) || 0; c.mat += Number(r[n4]) || 0; c.paid += Number(r[n5]) || 0 }
  }
  return out
}

const sum = (m: Map<string, Wk> | undefined, from: string | null) => {
  const s = zero()
  for (const [w, c] of m ?? []) if (!from || w >= from) add(s, c)
  return s
}

const titleTags = (t: string) => ({
  course: /\b(course|tutorial|full guide|masterclass|walkthrough|beginner)/i.test(t),
  tool: /\b(claude|chatgpt|grok|cursor|gpt|openai|anthropic|n8n|ai)\b/i.test(t),
  year: /\b20(25|26|27)\b/.test(t),
  number: /\d/.test(t),
})

export function buildCreators(doc: CreatorsDoc, payload: unknown, dataEnd: string, period: Period): CreatorsData {
  const wh = parseCreatorRows(payload)
  const p = PERIODS.find(x => x.id === period)!
  const endWk = weekOf(dataEnd)
  const from = p.weeks ? plusDays(endWk, -7 * (p.weeks - 1)) : null
  const weeks = [...new Set([...wh.values()].flatMap(m => [...m.keys()]))].filter(w => !from || w >= from).sort()

  const yt = doc.placements.filter(x => x.token && (x.platform === 'YouTube' || x.platform === 'Instagram') && (x.vid || x.views))
  const tokenUse = new Map<string, number>()
  for (const x of yt) tokenUse.set(x.token, (tokenUse.get(x.token) ?? 0) + 1)

  const seen = new Set<string>()
  const videos: VideoRow[] = []
  for (const x of yt) {
    const key = x.vid ?? `${x.token}:${x.title}`
    if (seen.has(key)) continue // the sheet lists some videos twice (one per segment); keep the first row
    seen.add(key)
    const v = x.vid ? doc.videos[x.vid] : undefined
    const ch = v ? doc.channels[v.channelId] : undefined
    const views = v?.views ?? x.views ?? null
    const sharedWith = tokenUse.get(x.token) ?? 1
    const attribution: Attribution = x.excluded ? 'excluded' : !x.measurable ? 'unmeasured' : x.shared || sharedWith > 1 ? 'shared' : 'direct'
    const tm = wh.get(x.token)
    const life = sum(tm, null)
    const liveWk = x.live ? weekOf(x.live) : null
    const spark: number[] = []
    if (liveWk && tm) for (let w = liveWk; w <= endWk; w = plusDays(w, 7)) spark.push(tm.get(w)?.ws ?? 0)
    const early = liveWk && tm && life.ws ? [0, 7].reduce((s, o) => s + (tm.get(plusDays(liveWk, o))?.ws ?? 0), 0) / life.ws : null
    videos.push({
      key, creator: x.creator ?? '—', fit: x.fit, agency: x.agency, placement: x.placement ?? (x.format === 'Short' ? 'Short' : '—'), format: x.format,
      title: v?.title ?? x.title ?? '—', vid: x.vid, url: x.url, live: x.live, channel: v?.channel ?? null,
      views, median: ch?.median ?? null, multiple: views != null && ch?.median ? views / ch.median : null,
      mins: v ? v.secs / 60 : null, chapters: v?.chapters ?? null, clayLine: v?.clayLine ?? null,
      token: x.token, sharedWith, attribution,
      rw: { clicks: x.clicks, signups: x.signups, conv: x.conversions },
      m: sum(tm, from), life, perK: attribution === 'direct' && views ? (1000 * life.ws) / views : null, early, spark,
      young: !!x.live && x.live > plusDays(dataEnd, -14),
    })
  }
  videos.sort((a, b) => b.m.ws - a.m.ws || (b.views ?? 0) - (a.views ?? 0))

  // Creators: each token once.
  const byCreator = new Map<string, CreatorRow>()
  for (const v of videos) {
    const c = byCreator.get(v.creator) ?? byCreator.set(v.creator, { creator: v.creator, fit: v.fit, agency: v.agency, videos: 0, views: 0, m: zero(), life: zero(), perK: null, tokens: [] }).get(v.creator)!
    c.videos++; c.views += v.views ?? 0
    if (v.attribution === 'excluded' || c.tokens.includes(v.token)) continue
    c.tokens.push(v.token); add(c.m, v.m); add(c.life, v.life)
  }
  const creators = [...byCreator.values()].map(c => ({ ...c, perK: c.views ? (1000 * c.life.ws) / c.views : null })).sort((a, b) => b.m.ws - a.m.ws)

  const programTokens = new Set(yt.map(x => x.token))
  const program = zero(), all = zero()
  for (const [t, m] of wh) { const s = sum(m, from); add(all, s); if (programTokens.has(t)) add(program, s) }
  const unmapped = [...wh.entries()].filter(([t]) => !programTokens.has(t)).map(([tok, m]) => ({ tok, m: sum(m, from), life: sum(m, null) }))
    .filter(u => u.m.ws > 0 || u.m.vis >= 50).sort((a, b) => b.m.ws - a.m.ws || b.m.vis - a.m.vis).slice(0, 25)

  // Rewardful (sheet) vs warehouse, one row per token, lifetime.
  const reconcile: CreatorsData['reconcile'] = []
  for (const tok of programTokens) {
    const x = yt.find(y => y.token === tok)!
    const rw = x.signups ?? 0, w = sum(wh.get(tok), null).ws
    if (rw >= 5 || w >= 5) reconcile.push({ token: tok, creator: x.creator ?? '—', rewardful: rw, warehouse: w })
  }
  reconcile.sort((a, b) => b.rewardful - a.rewardful)

  // What separates the videos that drive workspaces: direct links, live at least 14 days, with views.
  const bench = videos.filter(v => v.attribution === 'direct' && !v.young && v.views && v.format !== 'Short')
  const group = (factor: string, f: (v: VideoRow) => string | null, order: string[]): Pattern => ({
    factor,
    rows: order.map(label => {
      const vs = bench.filter(v => f(v) === label)
      const views = vs.reduce((s, v) => s + (v.views ?? 0), 0), ws = vs.reduce((s, v) => s + v.life.ws, 0)
      return { label, videos: vs.length, views, ws, perK: views ? (1000 * ws) / views : null, median: median(vs.map(v => v.perK ?? 0)) }
    }).filter(r => r.videos > 0),
  })
  const patterns: Pattern[] = [
    group('Placement', v => v.placement, ['Dedicated', 'Integration', 'Mention']),
    group('Creator fit', v => v.fit, ['Niche fit', 'Adjacent', 'Broad']),
    group('Length', v => v.mins == null ? null : v.mins < 15 ? 'Under 15 min' : v.mins < 30 ? '15–30 min' : '30 min+', ['Under 15 min', '15–30 min', '30 min+']),
    group('Clay link in description', v => v.clayLine == null ? 'Not in description' : v.clayLine <= 3 ? 'First 3 lines' : 'Further down', ['First 3 lines', 'Further down', 'Not in description']),
    group('Title promise', v => { const t = titleTags(v.title); return t.course ? 'Course / tutorial' : t.tool ? 'Names an AI tool' : 'Other' }, ['Course / tutorial', 'Names an AI tool', 'Other']),
  ]
  const medianPerK = median(bench.map(v => v.perK ?? 0))

  const lifeViews = videos.filter(v => v.attribution !== 'excluded').reduce((s, v) => s + (v.views ?? 0), 0)
  const clicks = videos.filter(v => v.attribution !== 'excluded').reduce((s, v) => s + (v.rw.clicks ?? 0), 0)
  const progLife = zero()
  for (const t of programTokens) add(progLife, sum(wh.get(t), null))
  const of = (label: string, value: number) => ({ label, value })
  const funnel: FunnelStep[] = [
    { label: 'Impressions', value: null, note: 'Not available for third-party channels: only the creator sees it', owner: 'Creator' },
    { label: 'Views', value: lifeViews, note: 'YouTube, lifetime, program videos', owner: 'Creator' },
    { label: 'Link clicks', value: clicks, note: 'Rewardful, from the program sheet', owner: 'Creator', of: of('views', lifeViews) },
    { label: 'Visitors', value: progLife.vis, note: 'clay.com cookies with the token, bots excluded', owner: 'Creator', of: of('link clicks', clicks) },
    { label: 'Email capture', value: null, note: 'Affiliate links land on the homepage: no offer page yet', owner: 'Offer page owner' },
    { label: 'New workspaces', value: progLife.ws, note: 'First-touch session on the link (90-day window)', owner: 'Lifecycle', of: of('visitors', progLife.vis) },
    { label: 'Tier 1–3', value: progLife.t13, note: 'Marketing tile rule', owner: 'Lifecycle', of: of('workspaces', progLife.ws) },
    { label: 'Activated in 7 days', value: progLife.act, note: 'Out of workspaces 7+ days old', owner: 'Lifecycle', of: of('matured', progLife.mat) },
    { label: 'Paid', value: progLife.paid, note: 'Converted to a paying customer', owner: 'Lifecycle', of: of('workspaces', progLife.ws) },
  ]

  return {
    period, weeks, dataEnd, fetchedAt: doc.fetchedAt, funnel, program, all, programShare: all.ws ? program.ws / all.ws : null,
    videos, creators, unmapped, reconcile, patterns, medianPerK, preview: doc.preview,
  }
}

const n = (x: number) => x.toLocaleString('en-US')
const r1 = (x: number | null) => (x == null ? '–' : x >= 10 ? x.toFixed(0) : x.toFixed(1))

/** "What moved" for the tab: where workspaces came from, which videos stand out, what they share, what to look at. */
export function creatorsInsight(d: CreatorsData): Insight {
  const label = d.period === 'all' ? 'since Apr 6' : PERIODS.find(p => p.id === d.period)!.label.toLowerCase()
  const lead: Para[] = []
  lead.push([{ k: 'b', s: `${n(d.program.ws)} new workspaces` }, ` came from creator program links ${label}`,
    d.programShare != null ? `, ${Math.round(d.programShare * 100)}% of all ${n(d.all.ws)} affiliate-link workspaces` : '', `. ${n(d.program.t13)} are Tier 1–3 and ${n(d.program.paid)} paid.`])
  const seenTok = new Set<string>()
  const top = d.videos.filter(v => v.m.ws > 0 && v.attribution !== 'excluded' && !seenTok.has(v.token) && seenTok.add(v.token)).slice(0, 3)
  const drivers: Para[] = [...lead]
  if (top.length) drivers.push(['Most came from ', ...top.flatMap((v, i) => [i ? (i === top.length - 1 ? ' and ' : ', ') : '', { k: 'b' as const, s: v.creator }, ` (${n(v.m.ws)}${v.attribution === 'shared' ? `, link shared by ${v.sharedWith} videos` : ''})`]), '.'])
  const best = d.videos.filter(v => v.perK != null && !v.young).sort((a, b) => b.perK! - a.perK!)[0]
  if (best && d.medianPerK) drivers.push(['Best yield: ', { k: 'b', s: best.creator }, `’s “${best.title}”, ${r1(best.perK)} workspaces per 1,000 views against a program median of ${r1(d.medianPerK)}.`])
  const big = d.videos.filter(v => v.perK != null && (v.views ?? 0) >= 100_000).sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  if (big.length) drivers.push(['Reach doesn’t carry it: the ', { k: 'b', s: `${big.length} videos over 100K views` }, ` average ${r1(big.reduce((s, v) => s + v.perK!, 0) / big.length)} workspaces per 1,000 views.`])
  const pl = d.patterns.find(p => p.factor === 'Placement')?.rows
  const ded = pl?.find(r => r.label === 'Dedicated'), integ = pl?.find(r => r.label === 'Integration')
  if (ded?.median != null && integ?.median != null) drivers.push([{ k: 'b', s: 'Dedicated videos' }, ` median ${r1(ded.median)} workspaces per 1,000 views vs ${r1(integ.median)} for integrations (${ded.videos} and ${integ.videos} videos).`])
  const anomalies: Para[] = []
  const u = d.unmapped[0]
  if (u && u.m.ws >= 50) anomalies.push(['The link token ', { k: 'code', s: u.tok }, ` drove ${n(u.m.ws)} workspaces and isn’t in the program sheet: worth naming.`])
  const drift = d.reconcile.filter(r => r.rewardful >= 20 && (r.warehouse < r.rewardful * 0.6 || r.warehouse > r.rewardful * 1.6))
  if (drift.length) anomalies.push([`Rewardful and the warehouse disagree on ${drift.length} token${drift.length > 1 ? 's' : ''} (`, ...drift.slice(0, 3).flatMap((r, i) => [i ? ', ' : '', { k: 'code' as const, s: r.token }]), '): usually a link reused outside its video.'])
  return { title: 'What moved', headline: [], drivers, emerging: [], anomalies, goals: [] }
}
