/**
 * Content insights: what creator videos are working, what they share, and what to make next.
 *
 *   placements   the program's placement list (affiliate team's Influencer Master sheet → youtube/creators):
 *                creator, video, link token, placement type, fit tier, and the team's own data-quality flags
 *   videos       public YouTube metadata per video (length, views, chapters, where the Clay link sits)
 *   channels     each creator channel's median views (recent long-form, newest 5 excluded) and subscribers
 *   scan         this week's niche scan (scripts/niche-scan.mjs + niche-analyze.mjs → youtube/scan): what the niche
 *                watches, scored against each channel's median, worked back into themes (lib/plg/creators/scan.ts)
 *   tags         hand-checked theme of each program video (youtube/creators → tags), over the title rules
 *   warehouse    per link token per week (lib/plg/creators/sql.ts): visitors, new workspaces, Tier 1–3, activated
 *                within 7 days (of matured workspaces), paid
 *
 * Two kinds of evidence, never mixed up: "watch demand" is views against a channel's median (the niche scan), "signup
 * proof" is new workspaces per 1,000 views (our program). A video worked on signups when it reached
 * RESULT.workedPerK with at least RESULT.workedMinWs workspaces, and failed when it had RESULT.failedMinViews views
 * and stayed under RESULT.failedPerK. Only videos with a link of their own, long-form, live 14+ days are judged.
 * Everything is lifetime, since the program's first tracked week (Apr 6).
 */
import { THEMES, clayFit, formatLabel, themeLabel, themeOf, type FormatId, type ThemeId } from './themes'
import type { ScanDoc, ScanRec, SV, Sep, ThemeStat } from './scan'

export type Placement = {
  creator: string | null; fit: string | null; status: string | null; agency: string | null; title: string | null; channelUrl: string | null
  url: string | null; platform: string | null; vid: string | null; live: string | null; videoStatus: string | null; format: string | null
  placement: string | null; views: number | null; clicks: number | null; signups: number | null; conversions: number | null
  excluded: boolean; measurable: boolean; shared: boolean; token: string
}
export type VideoMeta = { title: string; channelId: string; channel: string; published: string; secs: number; views: number; likes: number; comments: number; chapters: number; clayLine: number | null; links: number; chars: number }
export type ChannelMeta = { title: string; subs: number | null; videos: number | null; median: number | null; sample: number }
export type CreatorsDoc = {
  fetchedAt: string; sheetAsOf?: string | null; placements: Placement[]; daily: Record<string, [string, number | null, number | null, number | null, number | null][]>
  videos: Record<string, VideoMeta>; channels: Record<string, ChannelMeta>; tags?: Record<string, string> | null; thumbParts?: number
}

export type Wk = { vis: number; ws: number; t13: number; act: number; mat: number; paid: number }
const zero = (): Wk => ({ vis: 0, ws: 0, t13: 0, act: 0, mat: 0, paid: 0 })
const add = (a: Wk, b: Wk) => { a.vis += b.vis; a.ws += b.ws; a.t13 += b.t13; a.act += b.act; a.mat += b.mat; a.paid += b.paid; return a }

export const RESULT = { workedPerK: 1, workedMinWs: 10, failedPerK: 0.25, failedMinViews: 5000, minViews: 2000, youngDays: 14 }

export type Attribution = 'direct' | 'shared' | 'excluded' | 'unmeasured'
export const ATTRIBUTION: Record<Attribution, string> = {
  direct: 'Own link', shared: 'Shared link', excluded: 'Excluded by the program', unmeasured: 'Not measurable',
}
export type Result = 'worked' | 'failed' | 'neutral' | 'unjudged'

export type VideoRow = {
  key: string; creator: string; fit: string | null; agency: string | null; placement: string; format: string | null
  title: string; vid: string | null; url: string | null; live: string | null; channel: string | null; subs: number | null
  views: number | null; median: number | null; multiple: number | null; mins: number | null; chapters: number | null; clayLine: number | null
  token: string; sharedWith: number; attribution: Attribution; theme: ThemeId; result: Result
  rw: { clicks: number | null; signups: number | null; conv: number | null }
  /** Warehouse, lifetime, token totals (for a shared link, the whole token). */
  m: Wk
  /** New workspaces per 1,000 views; null unless the link is the video's own. */
  perK: number | null
  /** Weekly new workspaces since the go-live week (for the sparkline). */
  spark: number[]
  young: boolean
  /** Shared link merged into one row: the videos on it. */
  group?: { titles: string[] }
}
export type SignupState = 'converts' | 'mixed' | 'no' | 'untested'
export type ThemeRow = {
  id: ThemeId; label: string; desc: string
  videos: VideoRow[]; judged: number; worked: number; failed: number; ws: number; views: number; median: number | null
  best: VideoRow | null; demand: ThemeStat | null
  signup: SignupState; verdict: string; tone: 'pos' | 'neg' | 'neutral'
}
export type Rec = {
  rank: number; theme: ThemeId; label: string; status: 'new' | 'still' | 'first'
  /** Written by the weekly review when there is one; otherwise generated from the evidence. */
  title: string; angle: string; thumbnail: string | null; structure: string | null; offer: string | null; notes: string | null; written: boolean
  stat: ThemeStat; themeRow: ThemeRow | null; original: SV | null; winners: SV[]; losers: SV[]; seps: Sep[]
  why: string[]; measure: [string, string][]; score: number
}
export type Factor = { factor: string; worked: string; failed: string }
export type FunnelStep = { label: string; value: number | null; note: string; owner: string; of?: { label: string; value: number } }

export type CreatorsData = {
  dataEnd: string; fetchedAt: string
  scan: ScanDoc | null
  recs: Rec[]
  /** Recommended last week and not this week. */
  dropped: ThemeId[]
  /** Table rows: videos with their own link, plus one row per shared link. */
  rows: VideoRow[]
  videos: VideoRow[]
  themes: ThemeRow[]
  factors: Factor[]
  takeaway: string | null
  worked: VideoRow[]; failed: VideoRow[]
  medianPerK: number | null
  program: Wk; all: Wk; programShare: number | null
  funnel: FunnelStep[]
  unmapped: { tok: string; m: Wk }[]
  reconcile: { token: string; creator: string; rewardful: number; warehouse: number }[]
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const iso = (d: Date) => d.toISOString().slice(0, 10)
/** Week start as the warehouse buckets it (DATE_TRUNC('week') starts on Sunday in this Snowflake account). */
const weekOf = (day: string) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return iso(d) }
const plusDays = (day: string, n: number) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
const n = (x: number) => Math.round(x).toLocaleString('en-US')
export const r1 = (x: number | null | undefined) => (x == null ? '–' : x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2))

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
const sum = (m: Map<string, Wk> | undefined) => { const s = zero(); for (const c of m?.values() ?? []) add(s, c); return s }

const judge = (v: Omit<VideoRow, 'result'>): Result => {
  if (v.attribution !== 'direct' || v.young || v.format === 'Short' || !v.views || v.views < RESULT.minViews) return 'unjudged'
  if (v.perK! >= RESULT.workedPerK && v.m.ws >= RESULT.workedMinWs) return 'worked'
  if (v.views >= RESULT.failedMinViews && v.perK! < RESULT.failedPerK) return 'failed'
  return 'neutral'
}

function themeRows(videos: VideoRow[], scan: ScanDoc | null): ThemeRow[] {
  return THEMES.filter(t => t.id !== 'other' || videos.some(v => v.theme === 'other')).map(t => {
    const vs = videos.filter(v => v.theme === t.id)
    const judged = vs.filter(v => v.result !== 'unjudged')
    const worked = judged.filter(v => v.result === 'worked').length, failed = judged.filter(v => v.result === 'failed').length
    const tokens = new Set<string>(); let ws = 0
    for (const v of vs) if (v.attribution !== 'excluded' && !tokens.has(v.token)) { tokens.add(v.token); ws += v.m.ws }
    const med = median(judged.map(v => v.perK ?? 0))
    const best = [...judged].sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0))[0] ?? null
    const demand = scan?.themes.find(x => x.id === t.id && x.n >= 10) ?? null
    const rate = demand ? demand.hits / demand.n : null
    const watched = rate != null && rate >= (scan?.pool.baseRate ?? 0.19)
    const signup: SignupState = worked && worked >= failed ? 'converts' : worked ? 'mixed' : failed ? 'no' : 'untested'
    const [verdict, tone]: [string, ThemeRow['tone']] =
      signup === 'converts' ? (watched ? ['Double down', 'pos'] : demand ? ['Converts, smaller audience', 'pos'] : ['Converts', 'pos'])
      : signup === 'mixed' ? ['Depends on the angle', 'neutral']
      : signup === 'no' ? (watched ? ['Watched, doesn’t convert', 'neg'] : ['Avoid', 'neg'])
      : watched ? ['Test it', 'neutral'] : ['No evidence yet', 'neutral']
    return { id: t.id, label: t.label, desc: t.desc, videos: vs, judged: judged.length, worked, failed, ws, views: vs.reduce((s, v) => s + (v.views ?? 0), 0), median: med, best, demand, signup, verdict, tone }
  }).filter(t => t.videos.length || t.demand)
}

const SIGNUP_RANK: Record<SignupState, number> = { converts: 3, mixed: 2, untested: 1, no: 0 }

/** Smoothed share of copies that worked, so a theme with 3 of 3 doesn't beat one with 37 of 50. */
const winRate = (t: ThemeStat) => (t.worked + 1) / (t.worked + t.failed + 2)
/** Recent hit rate against the year before, clipped to [0.5, 2]: rising themes move up week to week. */
const momentum = (t: ThemeStat) => {
  const r = t.recentN >= 5 ? t.recentHits / t.recentN : null, p = t.priorN >= 5 ? t.priorHits / t.priorN : null
  return r == null || p == null ? 1 : Math.min(2, Math.max(0.5, (r + 0.02) / (p + 0.02)))
}
/** Signup proof multiplies watch demand: a theme our creators proved converts outranks an equally watched untested one. */
export const REC = { minCopies: 8, minWinChannels: 3, count: 5, signup: { converts: 1.5, mixed: 1.1, untested: 1, no: 0.6 } as Record<SignupState, number> }

function recommend(scan: ScanDoc | null, themes: ThemeRow[]): { recs: Rec[]; dropped: ThemeId[] } {
  if (!scan) return { recs: [], dropped: [] }
  const vid = new Map(scan.videos.map(v => [v.id, v]))
  const written = new Map((scan.recs ?? []).map(r => [r.theme, r] as [ThemeId, ScanRec]))
  // Candidates: watched more than the niche's base rate, with enough copies on enough channels, and somewhere Clay fits.
  const cand = scan.themes.filter(t => t.worked + t.failed >= REC.minCopies && t.winChannels >= REC.minWinChannels && clayFit(t.id) > 0 && t.n > 0 && t.hits / t.n >= scan.pool.baseRate)
  const scored = cand.map(stat => {
    const row = themes.find(x => x.id === stat.id) ?? null
    const score = winRate(stat) * Math.log2(1 + stat.winChannels) * clayFit(stat.id) * momentum(stat) * REC.signup[row?.signup ?? 'untested']
    return { stat, row, score }
  }).sort((a, b) => b.score - a.score).slice(0, REC.count)
  const prev = new Set(scan.prevRecThemes ?? [])
  const recs: Rec[] = scored.map(({ stat, row, score }, i) => {
    const w = written.get(stat.id)
    const original = stat.original ? vid.get(stat.original) ?? null : null
    const winners = stat.winners.map(x => vid.get(x)).filter((x): x is SV => !!x)
    const losers = stat.losers.map(x => vid.get(x)).filter((x): x is SV => !!x)
    const fmt = stat.bestFormat as FormatId | null
    const ch = (v: SV | null) => (v ? scan.channels[v.c]?.t ?? 'a channel' : '')
    const why: string[] = []
    why.push(`Watch demand: ${stat.worked} copies worked and ${stat.failed} failed on ${stat.winChannels} channels with a winner${original ? `; the original hit is ${ch(original)}’s “${original.t}” at ${r1(original.x)}× its channel` : ''}.`)
    const mo = momentum(stat)
    if (mo >= 1.25) why.push(`Rising: ${stat.recentHits} of ${stat.recentN} videos in the last 90 days hit 3×+, against ${stat.priorHits} of ${stat.priorN} in the year before.`)
    else if (mo <= 0.8) why.push(`Cooling: ${stat.recentHits} of ${stat.recentN} recent videos hit 3×+, against ${stat.priorHits} of ${stat.priorN} in the year before. Pick a fresh angle.`)
    if (row?.signup === 'converts' || row?.signup === 'mixed') {
      const b = row.best!
      why.push(`Signup proof: ${row.worked} of ${row.judged} of our creators’ videos on this theme worked, ${n(row.ws)} workspaces in all. Best: ${b.creator}’s “${b.title}”, ${r1(b.perK)} per 1K views.`)
    } else if (row?.signup === 'no') {
      const b = row.videos.filter(v => v.result === 'failed').sort((a, c) => (c.views ?? 0) - (a.views ?? 0))[0]
      why.push(`Signup proof is weak so far${b ? `: ${b.creator}’s “${b.title}” got ${r1(b.perK)} workspaces per 1K views` : ''}. Make it a dedicated video, not an integration.`)
    } else why.push('None of our creators has made this yet: a measured test (its own link, dedicated) would settle the signup question.')
    return {
      rank: i + 1, theme: stat.id, label: themeLabel(stat.id), status: !scan.prevFetchedAt ? 'first' : prev.has(stat.id) ? 'still' : 'new',
      title: w?.title ?? `${themeLabel(stat.id)}${fmt ? `, as a ${formatLabel(fmt).toLowerCase()}` : ''}`,
      angle: w?.angle ?? (original ? `Model it on ${ch(original)}’s “${original.t}”${fmt ? `; lead with the ${formatLabel(fmt).toLowerCase()} angle` : ''}.` : ''),
      thumbnail: w?.thumbnail ?? null, structure: w?.structure ?? null, offer: w?.offer ?? null, notes: w?.notes ?? null, written: !!w,
      stat, themeRow: row, original, winners, losers, seps: stat.seps, why, score,
      measure: [
        ['Link', 'Its own ?via= token, used by this video only (shared links can’t be measured)'],
        ['Clay link', 'In the first 3 lines of the description, with the offer'],
        ['Placement', 'A dedicated video: integrations rarely convert'],
        ['Landing page', 'Today: clay.com homepage. To test: the template page'],
        ['Nurture', 'To define with lifecycle'],
      ],
    }
  })
  const now = new Set(recs.map(r => r.theme))
  return { recs, dropped: [...prev].filter(t => !now.has(t)) }
}

/** Winners vs losers on signups, factor by factor, in words. */
function compare(w: VideoRow[], f: VideoRow[]): { factors: Factor[]; takeaway: string | null } {
  if (!w.length || !f.length) return { factors: [], takeaway: null }
  const count = (vs: VideoRow[], p: (v: VideoRow) => boolean) => vs.filter(p).length
  const top = (vs: VideoRow[], key: (v: VideoRow) => string | null) => {
    const m = new Map<string, number>()
    for (const v of vs) { const k = key(v); if (k) m.set(k, (m.get(k) ?? 0) + 1) }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const list = (vs: VideoRow[], key: (v: VideoRow) => string | null) => top(vs, key).slice(0, 3).map(([k, c]) => `${k} ${c}`).join(', ')
  const med = (vs: VideoRow[], g: (v: VideoRow) => number | null) => median(vs.map(g).filter((x): x is number => x != null))
  const tool = (v: VideoRow) => /claude|grok|chatgpt|gpt|\bai\b/i.test(v.title)
  const outcome = (v: VideoRow) => /lead|customer|client|\$|outbound|cold email/i.test(v.title)
  const W = w.length, F = f.length
  const factors: Factor[] = [
    { factor: 'Theme', worked: list(w, v => themeLabel(v.theme)), failed: list(f, v => themeLabel(v.theme)) },
    { factor: 'Placement', worked: `${count(w, v => v.placement === 'Dedicated')} of ${W} dedicated videos`, failed: `${count(f, v => v.placement === 'Dedicated')} of ${F} dedicated; ${count(f, v => v.placement === 'Integration')} integrations` },
    { factor: 'Creator fit', worked: list(w, v => v.fit), failed: list(f, v => v.fit) },
    { factor: 'Title', worked: `${count(w, tool)} of ${W} name an AI tool; ${count(w, outcome)} promise leads, customers or money`, failed: `${count(f, tool)} of ${F} name an AI tool; ${count(f, outcome)} promise leads, customers or money` },
    { factor: 'Views vs the channel’s usual', worked: `median ${r1(med(w, v => v.multiple))}× the channel median`, failed: `median ${r1(med(f, v => v.multiple))}× the channel median` },
    { factor: 'Channel size', worked: `median ${n(med(w, v => v.subs) ?? 0)} subscribers`, failed: `median ${n(med(f, v => v.subs) ?? 0)} subscribers` },
    { factor: 'Length', worked: `median ${Math.round(med(w, v => v.mins) ?? 0)} min`, failed: `median ${Math.round(med(f, v => v.mins) ?? 0)} min` },
    { factor: 'Chapters', worked: `${count(w, v => (v.chapters ?? 0) > 2)} of ${W} have chapters`, failed: `${count(f, v => (v.chapters ?? 0) > 2)} of ${F} have chapters` },
    { factor: 'Clay link in the description', worked: `${count(w, v => v.clayLine != null && v.clayLine <= 3)} of ${W} in the first 3 lines; ${count(w, v => v.clayLine == null)} missing`, failed: `${count(f, v => v.clayLine != null && v.clayLine <= 3)} of ${F} in the first 3 lines; ${count(f, v => v.clayLine == null)} missing` },
  ]
  // Theme names mid-sentence: lower-case the first letter unless it starts with a name (AI, GTM, LinkedIn, Clay).
  const mid = (x: string) => (/^(AI|GTM|LinkedIn|Clay)\b/.test(x) ? x : x[0].toLowerCase() + x.slice(1))
  const wt = top(w, v => mid(themeLabel(v.theme)))[0], ft = top(f, v => mid(themeLabel(v.theme)))[0]
  const wd = count(w, v => v.placement === 'Dedicated'), fi = count(f, v => v.placement === 'Integration')
  const takeaway = `Winners are mostly ${wd * 2 >= W ? 'dedicated videos' : 'integrations'}${wt ? ` on ${wt[0]}` : ''} that name the tool and promise an outcome; losers are mostly ${fi * 2 >= F ? 'integrations' : 'dedicated videos'}${ft ? ` on ${ft[0]}` : ''}, where Clay is a segment in someone else’s story. Big views don’t rescue a loose fit.`
  return { factors, takeaway }
}

export function buildCreators(doc: CreatorsDoc, payload: unknown, dataEnd: string, scan: ScanDoc | null = null): CreatorsData {
  const wh = parseCreatorRows(payload)
  const endWk = weekOf(dataEnd)
  const yt = doc.placements.filter(x => x.token && (x.platform === 'YouTube' || x.platform === 'Instagram') && (x.vid || x.views))
  const tokenUse = new Map<string, number>()
  for (const x of yt) tokenUse.set(x.token, (tokenUse.get(x.token) ?? 0) + 1)

  const seen = new Set<string>()
  const videos: VideoRow[] = []
  for (const x of yt) {
    const key = x.vid ?? `${x.token}:${x.title}`
    if (seen.has(key)) continue // the sheet lists some videos twice (one row per segment); keep the first
    seen.add(key)
    const v = x.vid ? doc.videos[x.vid] : undefined
    const ch = v ? doc.channels[v.channelId] : undefined
    const views = v?.views ?? x.views ?? null
    const sharedWith = tokenUse.get(x.token) ?? 1
    const attribution: Attribution = x.excluded ? 'excluded' : !x.measurable ? 'unmeasured' : x.shared || sharedWith > 1 ? 'shared' : 'direct'
    const tm = wh.get(x.token)
    const m = sum(tm)
    const liveWk = x.live ? weekOf(x.live) : null
    const spark: number[] = []
    if (liveWk && tm) for (let w = liveWk; w <= endWk; w = plusDays(w, 7)) spark.push(tm.get(w)?.ws ?? 0)
    const title = v?.title ?? x.title ?? '—'
    const row = {
      key, creator: x.creator ?? '—', fit: x.fit, agency: x.agency, placement: x.placement ?? (x.format === 'Short' ? 'Short' : '—'), format: x.format,
      title, vid: x.vid, url: x.url, live: x.live, channel: v?.channel ?? null, subs: ch?.subs ?? null,
      views, median: ch?.median ?? null, multiple: views != null && ch?.median ? views / ch.median : null,
      mins: v ? v.secs / 60 : null, chapters: v?.chapters ?? null, clayLine: v?.clayLine ?? null,
      token: x.token, sharedWith, attribution, theme: themeOf(x.vid, title, doc.tags),
      rw: { clicks: x.clicks, signups: x.signups, conv: x.conversions },
      m, perK: attribution === 'direct' && views ? (1000 * m.ws) / views : null, spark,
      young: !!x.live && x.live > plusDays(dataEnd, -RESULT.youngDays),
    }
    videos.push({ ...row, result: judge(row) })
  }
  const live = videos.filter(v => (v.views ?? 0) > 0 || v.m.vis > 0 || v.m.ws > 0)

  // Table rows: each shared link once, with its videos listed.
  const rows: VideoRow[] = []
  const sharedDone = new Set<string>()
  for (const v of live) {
    if (v.attribution !== 'shared') { rows.push(v); continue }
    if (sharedDone.has(v.token)) continue
    sharedDone.add(v.token)
    const grp = live.filter(x => x.attribution === 'shared' && x.token === v.token)
    const views = grp.reduce((s, x) => s + (x.views ?? 0), 0)
    rows.push({ ...v, key: `shared:${v.token}`, title: `${grp.length} videos on one link`, group: { titles: grp.map(x => x.title) }, views, multiple: null, mins: null, perK: null, vid: grp[0].vid })
  }
  rows.sort((a, b) => b.m.ws - a.m.ws || (b.views ?? 0) - (a.views ?? 0))

  const judged = live.filter(v => v.result !== 'unjudged')
  const medianPerK = median(judged.map(v => v.perK ?? 0))
  const themes = themeRows(live, scan).sort((a, b) => SIGNUP_RANK[b.signup] - SIGNUP_RANK[a.signup] || b.ws - a.ws)
  const worked = judged.filter(v => v.result === 'worked').sort((a, b) => b.perK! - a.perK!)
  const failed = judged.filter(v => v.result === 'failed').sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  const { factors, takeaway } = compare(worked, failed)

  const programTokens = new Set(yt.map(x => x.token))
  const program = zero(), all = zero()
  for (const [t, m] of wh) { const s = sum(m); add(all, s); if (programTokens.has(t)) add(program, s) }
  const unmapped = [...wh.entries()].filter(([t]) => !programTokens.has(t)).map(([tok, m]) => ({ tok, m: sum(m) }))
    .filter(u => u.m.ws > 0 || u.m.vis >= 50).sort((a, b) => b.m.ws - a.m.ws || b.m.vis - a.m.vis).slice(0, 25)
  const reconcile: CreatorsData['reconcile'] = []
  for (const tok of programTokens) {
    const x = yt.find(y => y.token === tok)!
    const rw = x.signups ?? 0, w = sum(wh.get(tok)).ws
    if (rw >= 5 || w >= 5) reconcile.push({ token: tok, creator: x.creator ?? '—', rewardful: rw, warehouse: w })
  }
  reconcile.sort((a, b) => b.rewardful - a.rewardful)

  const counted = live.filter(v => v.attribution !== 'excluded')
  const lifeViews = counted.reduce((s, v) => s + (v.views ?? 0), 0), clicks = counted.reduce((s, v) => s + (v.rw.clicks ?? 0), 0)
  const of = (label: string, value: number) => ({ label, value })
  const funnel: FunnelStep[] = [
    { label: 'Impressions', value: null, note: 'Only the creator sees it', owner: 'Creator' },
    { label: 'Views', value: lifeViews, note: 'YouTube, program videos', owner: 'Creator' },
    { label: 'Link clicks', value: clicks, note: 'Rewardful, program sheet', owner: 'Creator', of: of('views', lifeViews) },
    { label: 'Visitors', value: program.vis, note: 'clay.com, bots excluded', owner: 'Creator', of: of('link clicks', clicks) },
    { label: 'Email capture', value: null, note: 'Links land on the homepage: no offer page yet', owner: 'Offer page owner' },
    { label: 'New workspaces', value: program.ws, note: 'First touch on the link', owner: 'Lifecycle', of: of('visitors', program.vis) },
    { label: 'Tier 1–3', value: program.t13, note: 'Marketing tile rule', owner: 'Lifecycle', of: of('workspaces', program.ws) },
    { label: 'Activated in 7 days', value: program.act, note: 'Of workspaces 7+ days old', owner: 'Lifecycle', of: of('matured', program.mat) },
    { label: 'Paid', value: program.paid, note: 'Paying customer', owner: 'Lifecycle', of: of('workspaces', program.ws) },
  ]

  return {
    dataEnd, fetchedAt: doc.fetchedAt, scan, ...recommend(scan, themes), rows, videos: live, themes, factors, takeaway,
    worked, failed, medianPerK, program, all, programShare: all.ws ? program.ws / all.ws : null, funnel, unmapped, reconcile,
  }
}
