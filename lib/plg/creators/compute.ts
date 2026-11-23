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
import { PLAYS, RESOURCES, THEMES, assistantLabel, assistantOf, clayFit, formatLabel, subjectOf, themeLabel, themeOf, topicLabel, type FormatId, type SubjectId, type ThemeId } from './themes'
import type { ScanDoc, ScanRec, SV, Sep, ThemeStat, Topic } from './scan'

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
/** The brief for one video idea: what to make and where to send people. */
export type Brief = { title: string; useCase: string; landing: string; landingUrl: string | null; resources: { label: string; url: string | null }[]; offer: string; cta: string; copy: string; placement: string; thumbnail: string | null; structure: string | null }
export type BriefKey = Exclude<keyof Brief, 'landingUrl' | 'resources'>
/** Where a decision came from: the weekly review, the evidence alone, or the theme's default play (lib/plg/creators/themes.ts). */
export type Reason = { k: BriefKey; label: string; why: string; src: 'review' | 'evidence' | 'default' }
export type Rec = {
  /** One topic (theme + subject); `format` is the title format the brief recommends for it, `formatLabel` its name. */
  rank: number; key: string; theme: ThemeId; subject: SubjectId; format: FormatId | null; label: string; formatLabel: string | null; status: 'new' | 'still' | 'first'
  /** The weekly review wrote this idea's brief (ScanRec); otherwise it's drafted from the evidence and the theme's play. */
  written: boolean; title: string; angle: string; brief: Brief; reasons: Reason[]
  stat: ThemeStat; topic: Topic | null; themeRow: ThemeRow | null; original: SV | null
  /** Niche copies the idea is sourced from (worked), copies that failed, and our creators' videos on the topic (or, when
   * none name its subject, on the theme: oursScope). */
  examples: SV[]; losers: SV[]; ours: VideoRow[]; oursScope: 'topic' | 'theme'; seps: Sep[]
  /** Niche: copies judged, worked (2×+), failed (<0.7×), channels with a winner, median multiple. Ours: workspaces on
   * the ours scope (each link once), best per 1K, videos judged and worked. */
  proof: { worked: number; failed: number; n: number; channels: number; rate: number; med: number | null; top: number | null; themeRate: number; nicheRate: number
    ws: number; bestPerK: number | null; judged: number; oursWorked: number }
  /** Title formats tried on the topic (3+ copies), best first; for AI-assistant topics, each assistant too. */
  formats: { f: FormatId; n: number; worked: number }[]; tools: { a: string; n: number; worked: number }[]
  /** The AI assistant the title should name (AI-assistant topics). */
  assistant: string | null
  why: string[]; measure: [string, string][]; score: number
}
/** One synthesis callout: a finding, its evidence and what to do about it. */
export type Learning = { head: string; tone: 'pos' | 'neg' | 'neutral'; bullets: string[]; so: string }
export type Factor = { factor: string; worked: string; failed: string }
export type FunnelStep = { label: string; value: number | null; note: string; owner: string; of?: { label: string; value: number } }

export type CreatorsData = {
  dataEnd: string; fetchedAt: string
  scan: ScanDoc | null
  recs: Rec[]
  /** Ideas recommended last week and not this week (labels). */
  dropped: string[]
  learnings: Learning[]
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
const winRate = (t: { worked: number; failed: number }) => (t.worked + 1) / (t.worked + t.failed + 2)
/** Recent hit rate against the year before, clipped to [0.5, 2]: rising themes move up week to week. */
const momentum = (t: ThemeStat) => {
  const r = t.recentN >= 5 ? t.recentHits / t.recentN : null, p = t.priorN >= 5 ? t.priorHits / t.priorN : null
  return r == null || p == null ? 1 : Math.min(2, Math.max(0.5, (r + 0.02) / (p + 0.02)))
}
/** Signup proof multiplies watch demand: a theme our creators proved converts outranks an equally watched untested one. */
export const REC = { minCopies: 8, minWinChannels: 3, count: 15, perTheme: 3, perSubject: 2, topicMinCopies: 8, topicMinChannels: 3, topicMinEdge: 0.1, minFit: 0.4, signup: { converts: 1.5, mixed: 1.1, untested: 1, no: 0.6 } as Record<SignupState, number> }
const pct = (x: number) => `${Math.round(x * 100)}%`
/** A label mid-sentence: lower-case the first letter unless it starts with a name or acronym. */
const midLabel = (x: string) => (/^(AI|GTM|LinkedIn|Clay|I\b|“I)/.test(x) ? x : x[0].toLowerCase() + x.slice(1))
const FIT = (x: number) => (x >= 1 ? 'high' : x >= 0.6 ? 'medium' : 'low')

/** Program facts the briefs' reasons cite: placement and link position among our winners and losers. */
type ProgramFacts = { W: number; F: number; wDedicated: number; fIntegration: number; wLink3: number; fLink3: number; wMins: number | null; fMins: number | null; wChapters: number; fChapters: number }
function programFacts(w: VideoRow[], f: VideoRow[]): ProgramFacts {
  const c = (vs: VideoRow[], p: (v: VideoRow) => boolean) => vs.filter(p).length
  const med = (vs: VideoRow[]) => median(vs.map(v => v.mins).filter((x): x is number => x != null))
  return { W: w.length, F: f.length, wDedicated: c(w, v => v.placement === 'Dedicated'), fIntegration: c(f, v => v.placement === 'Integration'),
    wLink3: c(w, v => v.clayLine != null && v.clayLine <= 3), fLink3: c(f, v => v.clayLine != null && v.clayLine <= 3), wMins: med(w), fMins: med(f),
    wChapters: c(w, v => (v.chapters ?? 0) > 2), fChapters: c(f, v => (v.chapters ?? 0) > 2) }
}

/**
 * The ideas to make next: one per topic (a theme narrowed to the tool or platform its titles name), ranked by how often
 * the topic's copies beat their channel, on how many channels, how naturally Clay fits, whether the theme is rising and
 * what our creators' signups say. A topic's title formats are ways to sell it, not separate ideas: the brief picks one.
 * At most REC.perTheme per theme and REC.perSubject per subject; an idea whose lead copy, or half its copies, already
 * source a picked idea is the same video and is skipped. Scans without topics (before Nov 23) give one idea per theme.
 */
function recommend(scan: ScanDoc | null, themes: ThemeRow[], facts: ProgramFacts): { recs: Rec[]; dropped: string[] } {
  if (!scan) return { recs: [], dropped: [] }
  const vid = new Map(scan.videos.map(v => [v.id, v]))
  const reviewed = scan.recs ?? []
  const base = scan.pool.baseRate
  type Cand = { stat: ThemeStat; row: ThemeRow | null; topic: Topic | null; score: number }
  const cands: Cand[] = []
  for (const stat of scan.themes) {
    // Themes where Clay would be a detour (deliverability, cold calling: fit 0.3) don't make the list.
    if (!(clayFit(stat.id) >= REC.minFit && stat.n > 0)) continue
    const row = themes.find(x => x.id === stat.id) ?? null
    const k = clayFit(stat.id) * momentum(stat) * REC.signup[row?.signup ?? 'untested']
    if (stat.topics) {
      for (const t of stat.topics) if (topicOk(t, scan.pool.workedRate)) cands.push({ stat, row, topic: t, score: winRate(t) * Math.log2(1 + t.winChannels) * k })
    } else if (stat.worked + stat.failed >= REC.minCopies && stat.winChannels >= REC.minWinChannels && (stat.hits / stat.n >= base || row?.signup === 'converts'))
      cands.push({ stat, row, topic: null, score: winRate(stat) * Math.log2(1 + stat.winChannels) * k })
  }
  cands.sort((a, b) => b.score - a.score)
  const perTheme = new Map<string, number>(), perSubject = new Map<string, number>(), usedEx = new Set<string>(), picked: Cand[] = []
  for (const c of cands) {
    if (picked.length >= REC.count) break
    const sj = c.topic?.s ?? 'general'
    const t = perTheme.get(c.stat.id) ?? 0, j = sj === 'general' ? 0 : perSubject.get(sj) ?? 0
    if (t >= REC.perTheme || j >= REC.perSubject) continue
    const ex = c.topic?.ex ?? c.stat.winners
    if (ex.length && (usedEx.has(ex[0]) || ex.filter(x => usedEx.has(x)).length * 2 >= ex.length)) continue
    ex.forEach(x => usedEx.add(x))
    perTheme.set(c.stat.id, t + 1); if (sj !== 'general') perSubject.set(sj, j + 1)
    picked.push(c)
  }
  // Scans before topics recommended themes (keys 'theme:' or 'theme:general'): compare those by theme.
  const prevKeys = new Set(scan.prevRecKeys ?? [])
  const byTheme = !prevKeys.size || [...prevKeys].every(k => k.endsWith(':') || k.endsWith(':general'))
  const prevThemes = new Set<string>(scan.prevRecThemes ?? [])
  const ch = (v: SV | null) => (v ? scan.channels[v.c]?.t ?? 'a channel' : '')
  const recs: Rec[] = picked.map(({ stat, row, topic, score }, i) => {
    const subject: SubjectId = topic?.s ?? 'general'
    const key = `${stat.id}:${subject}`
    const w = reviewed.find(r => r.theme === stat.id && (r.subject ?? 'general') === subject)
    const nTopic = topic?.n ?? stat.n
    // Formats ranked by smoothed hit rate, so 10 of 12 beats 3 of 3; the brief's pick must beat the topic as a whole.
    const formats = [...(topic?.formats ?? [])].sort((a, b) => winRate({ worked: b.worked, failed: b.n - b.worked }) - winRate({ worked: a.worked, failed: a.n - a.worked }) || b.n - a.n)
    const tRate = (topic?.worked ?? stat.worked) / Math.max(1, nTopic)
    const fmt: FormatId | null = w?.format ?? formats.find(f => f.n >= 4 && f.worked / f.n > tRate)?.f ?? null
    const fStat = fmt ? formats.find(f => f.f === fmt) ?? null : null
    // Assistants with 8+ copies only, so 2 of 3 Grok videos don't outrank 43 of 79 Claude ones.
    const tools = [...(topic?.tools ?? [])].filter(a => a.n >= 8).sort((a, b) => winRate({ worked: b.worked, failed: b.n - b.worked }) - winRate({ worked: a.worked, failed: a.n - a.worked }))
    // The review's title wins: if it names an assistant, that's the pick.
    const named = w ? assistantOf(w.title) : null
    const tool = (named ? { a: named, n: 0, worked: 0, ...tools.find(a => a.a === named) } : tools[0]) ?? null
    const examples = (topic?.ex ?? stat.winners).map(x => vid.get(x)).filter((x): x is SV => !!x)
    const losers = (topic ? topic.bad : stat.losers).map(x => vid.get(x)).filter((x): x is SV => !!x)
    const original = stat.original ? vid.get(stat.original) ?? null : null
    const linked = (v: VideoRow) => v.attribution === 'direct' || v.attribution === 'shared'
    const onTopic = (row?.videos ?? []).filter(v => linked(v) && subjectOf(stat.id, v.title) === subject)
    const oursScope: Rec['oursScope'] = onTopic.length ? 'topic' : 'theme'
    const oursAll = onTopic.length ? onTopic : (row?.videos ?? []).filter(linked)
    const ours = [...oursAll].sort((a, b) => b.m.ws - a.m.ws).slice(0, 6)
    const toks = new Set<string>(); let ws = 0
    for (const v of oursAll) if (!toks.has(v.token)) { toks.add(v.token); ws += v.m.ws }
    const judgedOurs = oursAll.filter(v => v.result !== 'unjudged')
    const bestPerK = judgedOurs.length ? Math.max(...judgedOurs.map(v => v.perK ?? 0)) : null
    const proof: Rec['proof'] = { worked: topic?.worked ?? stat.worked, failed: topic?.failed ?? stat.failed, n: nTopic, channels: topic?.winChannels ?? stat.winChannels,
      rate: tRate, med: topic?.med ?? null, top: examples[0]?.x ?? null, themeRate: stat.n ? stat.worked / stat.n : 0, nicheRate: scan.pool.workedRate,
      ws, bestPerK, judged: judgedOurs.length, oursWorked: judgedOurs.filter(v => v.result === 'worked').length }
    const play = PLAYS[stat.id]
    const label = topicLabel(stat.id, subject)
    const fmtLabel = fmt ? formatLabel(fmt) : null
    const top = examples[0] ?? original
    const brief: Brief = {
      title: w?.title ?? (top ? top.t : label),
      useCase: w?.useCase ?? play?.useCase ?? themeLabel(stat.id),
      landing: w?.landing ?? play?.landing ?? 'clay.com homepage', landingUrl: w?.landingUrl ?? (w?.landing ? null : play?.landingUrl ?? null),
      offer: w?.offer ?? play?.offer ?? 'To define',
      cta: w?.cta ?? play?.cta ?? 'Start free',
      copy: w?.copy ?? `First line of the description: “${play?.cta ?? 'Start free'}: <your ?via= link>”, then ${play?.offer ? play.offer[0].toLowerCase() + play.offer.slice(1) : 'the offer'}.`,
      placement: w?.placement ?? 'Dedicated video, its own ?via= link',
      thumbnail: w?.thumbnail ?? null, structure: w?.structure ?? null, resources: [],
    }
    // Related resources: the review's landing page first, then the theme's (lib/plg/creators/themes.ts), at most 3.
    for (const x of [...(w?.landing ? [{ label: w.landing, url: w.landingUrl ?? null }] : []), ...(RESOURCES[stat.id] ?? [])])
      if (brief.resources.length < 3 && !brief.resources.some(y => y.label === x.label || (x.url && y.url === x.url))) brief.resources.push(x)
    const src = (k: keyof NonNullable<ScanRec['why']>, has: boolean): Reason['src'] => (w?.why?.[k] || (w && has) ? 'review' : 'evidence')
    const words = stat.words.w.length ? ` Words that show up in winning titles on the theme: ${stat.words.w.slice(0, 4).join(', ')}.` : ''
    // The topic's own traits when it has them (scans from Nov 23), else the theme's separators.
    const traits = topic?.traits?.length ? topic.traits : stat.seps
    const sepLine = traits.filter(x => x.w / x.wn > x.f / x.fn).slice(0, 2).map(x => `${midLabel(x.label)} (${pct(x.w / x.wn)} of copies that worked, ${pct(x.f / x.fn)} of ones that failed)`).join('; ')
    const avoid = traits.filter(x => x.f / x.fn > x.w / x.wn).slice(0, 1).map(x => `${midLabel(x.label)} (${pct(x.f / x.fn)} of failures, ${pct(x.w / x.wn)} of winners)`)[0]
    const best = [...judgedOurs].sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0))[0]
    const fmtLine = (fStat ? ` Sold as “${midLabel(fmtLabel!)}”, ${fStat.worked} of ${fStat.n} worked (${pct(fStat.worked / fStat.n)}).` : '')
      + (tools.length > 1 && tool ? ` By assistant: ${tools.map(a => `${assistantLabel(a.a)} ${a.worked} of ${a.n}`).join(', ')}; name ${assistantLabel(tool.a)} in the title.` : '')
    const reasons: Reason[] = [
      { k: 'title', label: 'Title', src: src('title', true), why: w?.why?.title ?? `${proof.worked} of ${proof.n} copies on this topic worked (2×+ their channel) on ${proof.channels} channels, ${pct(proof.rate)} against ${pct(proof.nicheRate)} across the niche.${fmtLine}${words}`
        + (w ? '' : ' Draft: the top copy’s title, to rewrite in the weekly review.') },
      { k: 'useCase', label: 'Use case', src: w?.useCase ? 'review' : 'default', why: w?.why?.useCase ?? `Clay fit is ${FIT(clayFit(stat.id))} for ${midLabel(themeLabel(stat.id))}: the video can show ${play?.useCase ? play.useCase[0].toLowerCase() + play.useCase.slice(1) : 'Clay doing the work'} on screen.${best ? ` Our best video on the ${oursScope}: ${best.creator}’s “${best.title}”, ${n(best.m.ws)} workspaces (${r1(best.perK)} per 1K views).` : ' None of our creators has a judged video on it yet.'}` },
      { k: 'landing', label: 'Related resources and offer', src: w?.landing ? 'review' : 'default', why: w?.why?.landing ?? `Program links land on the clay.com homepage today and nothing captures an email before signup. A page that matches the use case (${brief.landing}) keeps the video’s promise; ${brief.offer[0].toLowerCase() + brief.offer.slice(1)} is the reason to click.` },
      { k: 'cta', label: 'CTA and copy', src: w?.cta ? 'review' : 'evidence', why: w?.why?.cta ?? (facts.W
        ? `${facts.wLink3} of our ${facts.W} videos that worked had the Clay link in the first 3 lines of the description, against ${facts.fLink3} of ${facts.F} that failed. Say the offer next to the link, and once on screen when Clay first appears.`
        : 'Put the link and the offer in the first 3 lines of the description.') },
      { k: 'placement', label: 'Placement', src: w?.placement ? 'review' : 'evidence', why: w?.why?.placement ?? (facts.W
        ? `${facts.wDedicated} of ${facts.W} winners were dedicated videos; ${facts.fIntegration} of ${facts.F} failures were integrations. Its own link is the only way to measure it.`
        : 'A dedicated video with its own link is the only way to measure it.') },
      { k: 'structure', label: 'Length and structure', src: w?.structure ? 'review' : 'evidence', why: w?.why?.structure ?? (sepLine
        ? `What separates copies that worked from ones that failed on the ${topic?.traits?.length ? 'topic' : 'theme'}: ${sepLine}.${avoid ? ` Avoid ${avoid}.` : ''}${facts.wMins != null ? ` Our winners run a median ${Math.round(facts.wMins)} min, ${facts.wChapters} of ${facts.W} with chapters.` : ''}`
        : facts.wMins != null ? `Our winners run a median ${Math.round(facts.wMins)} min, ${facts.wChapters} of ${facts.W} with chapters.` : 'No clear length or structure separator on this theme.') },
    ]
    const why: string[] = []
    why.push(`${proof.worked} copies worked and ${proof.failed} failed on ${proof.channels} channels with a winner${proof.med != null ? `; the median copy got ${r1(proof.med)}× its channel’s usual views` : ''}${top ? `; the top one is ${ch(top)}’s “${top.t}” at ${r1(top.x)}×` : ''}.`)
    const mo = momentum(stat)
    if (mo >= 1.25) why.push(`Rising: ${stat.recentHits} of ${stat.recentN} videos on the theme in the last 90 days hit 3×+, against ${stat.priorHits} of ${stat.priorN} in the year before.`)
    else if (mo <= 0.8) why.push(`Cooling: ${stat.recentHits} of ${stat.recentN} recent videos on the theme hit 3×+, against ${stat.priorHits} of ${stat.priorN} in the year before. Pick a fresh angle.`)
    if (proof.judged) why.push(`Signups: ${proof.oursWorked} of ${proof.judged} of our judged videos on the ${oursScope} worked, ${n(proof.ws)} workspaces in all.`)
    else if (oursAll.length) why.push(`Signups: our ${oursAll.length} video${oursAll.length === 1 ? '' : 's'} on the ${oursScope} drove ${n(proof.ws)} workspaces, none judged yet.`)
    else why.push('No signup data: none of our creators has made this, and the niche’s videos carry no Clay link. A measured test (dedicated, its own link) settles it.')
    return {
      rank: i + 1, key, theme: stat.id, subject, format: fmt, label, formatLabel: fmtLabel,
      status: !scan.prevFetchedAt ? 'first' : (byTheme ? prevThemes.has(stat.id) : prevKeys.has(key)) ? 'still' : 'new',
      written: !!w, title: brief.title, angle: w?.angle ?? (top ? `Model it on ${ch(top)}’s “${top.t}”.` : ''), brief, reasons,
      stat, topic, themeRow: row, original, examples, losers, ours, oursScope, seps: traits, proof, formats, tools, assistant: tool?.a ?? null, why, score,
      measure: [
        ['Link', 'Its own ?via= token, used by this video only (shared links can’t be measured)'],
        ['Landing page', brief.landing],
        ['Read it', 'Workspaces per 1K views after 14 days: 1+ with 10+ workspaces worked, under 0.25 failed'],
        ['Nurture', 'To define with lifecycle'],
      ],
    }
  })
  const now = new Set(recs.map(r => r.key))
  const labelOf = (k: string) => { const [t, sj] = k.split(':'); return topicLabel(t as ThemeId, (sj || 'general') as SubjectId) }
  const themesNow = new Set<string>(recs.map(r => r.theme))
  return { recs, dropped: byTheme ? [...prevThemes].filter(t => !themesNow.has(t)).map(t => themeLabel(t as ThemeId)) : [...prevKeys].filter(k => !now.has(k)).map(labelOf) }
}
/** A topic worth an idea: enough copies, on several channels, and a hit rate REC.topicMinEdge above the niche's. */
const topicOk = (t: Topic, nicheWorked: number) => t.n >= REC.topicMinCopies && t.worked >= 4 && t.winChannels >= REC.topicMinChannels && t.ex.length > 0 && t.worked / t.n >= nicheWorked + REC.topicMinEdge

/**
 * Videos any idea could show (sources and failures of every eligible topic, or of the theme when it has none), whatever
 * our signups say: scripts/niche-thumbs.mjs downloads thumbnails for these. Mirrors recommend()'s filters.
 */
export function ideaVideoIds(scan: ScanDoc): string[] {
  const ids = new Set<string>()
  for (const stat of scan.themes) {
    if (!(clayFit(stat.id) >= REC.minFit && stat.n > 0)) continue
    if (stat.topics) { for (const t of stat.topics) if (topicOk(t, scan.pool.workedRate)) [...t.ex, ...t.bad].forEach(x => ids.add(x)) }
    else [...stat.winners, ...stat.losers].forEach(x => ids.add(x))
  }
  return [...ids]
}

/** The synthesis: what converts, what's watched but doesn't convert, open lanes, title formats, our winners vs losers, momentum. */
function learn(scan: ScanDoc | null, themes: ThemeRow[], facts: ProgramFacts, recs: Rec[]): Learning[] {
  const out: Learning[] = []
  const ideaRef = (id: ThemeId) => { const r = recs.filter(x => x.theme === id).map(x => `#${x.rank}`); return r.length ? ` (ideas ${r.join(', ')})` : '' }
  const base = scan?.pool.baseRate ?? 0
  const rate = (t: ThemeRow) => (t.demand ? t.demand.hits / t.demand.n : null)
  const conv = themes.filter(t => t.signup === 'converts' || t.signup === 'mixed').sort((a, b) => b.ws - a.ws).slice(0, 3)
  if (conv.length) out.push({ head: `${conv.length === 1 ? 'One theme converts' : `${conv.length} themes convert`} for our creators`, tone: 'pos',
    bullets: conv.map(t => `${t.label}: ${t.worked} of ${t.judged} judged videos worked, ${n(t.ws)} workspaces${t.best ? `; best ${t.best.creator}’s “${t.best.title}” at ${r1(t.best.perK)} per 1K views` : ''}${ideaRef(t.id)}.`),
    so: 'Keep these funded first: proven signups beat views.' })
  // Two failures at least: one video isn't a pattern.
  const leaky = themes.filter(t => t.signup === 'no' && t.failed >= 2 && (rate(t) ?? 0) >= base).slice(0, 3)
  if (leaky.length) out.push({ head: 'Watched, but our videos on it don’t convert', tone: 'neg',
    bullets: leaky.map(t => `${t.label}: the niche hits 3×+ on ${pct(rate(t)!)} of videos (base ${pct(base)}), but ${t.failed} of our ${t.judged} judged videos failed on signups.`),
    so: facts.F ? `Change the format, not the topic: ${facts.fIntegration} of our ${facts.F} failures were integrations. Make it dedicated, with a landing page that matches.` : 'Change the format, not the topic: dedicated, with a landing page that matches.' })
  if (scan) {
    const open = scan.themes.filter(t => t.n >= 10 && clayFit(t.id) >= 0.6 && t.hits / t.n >= base && !(themes.find(x => x.id === t.id)?.judged))
      .sort((a, b) => b.hits / b.n - a.hits / a.n).slice(0, 3)
    if (open.length) out.push({ head: 'Open lanes: watched, untested by us', tone: 'neutral',
      bullets: open.map(t => `${themeLabel(t.id)}: ${pct(t.hits / t.n)} of ${n(t.n)} videos at 3×+ on ${t.winChannels} channels with a winner${ideaRef(t.id)}.`),
      so: 'Test one with a dedicated video and its own link; that’s the only way to learn whether it converts.' })
    const fm = scan.formats.filter(f => f.n >= 20).map(f => ({ f, r: f.hits / f.n })).sort((a, b) => b.r - a.r)
    if (fm.length >= 4) {
      const hi = fm.slice(0, 3), lo = fm.slice(-2).filter(x => x.r < base)
      out.push({ head: 'Title formats that travel, and ones that don’t', tone: 'neutral',
        bullets: [...hi.map(x => `${formatLabel(x.f.id)}: ${pct(x.r)} of ${n(x.f.n)} at 3×+ (base ${pct(base)}).`), ...lo.map(x => `Avoid ${midLabel(formatLabel(x.f.id))}: ${pct(x.r)} of ${n(x.f.n)}.`)],
        so: `Lead titles with ${hi.map(x => midLabel(formatLabel(x.f.id))).slice(0, 2).join(' or ')}; the ideas above use them where the theme’s own copies prove it.` })
    }
  }
  if (facts.W && facts.F) out.push({ head: 'What our winners do that our losers don’t', tone: 'neutral',
    bullets: [
      `Placement: ${facts.wDedicated} of ${facts.W} winners were dedicated videos; ${facts.fIntegration} of ${facts.F} failures were integrations.`,
      `Link: ${facts.wLink3} of ${facts.W} winners had the Clay link in the first 3 description lines, against ${facts.fLink3} of ${facts.F} failures.`,
      ...(facts.wMins != null && facts.fMins != null && Math.abs(facts.wMins - facts.fMins) >= 0.2 * Math.max(facts.wMins, facts.fMins) ? [`Length: winners run a median ${Math.round(facts.wMins)} min, failures ${Math.round(facts.fMins)} min.`] : []),
    ],
    so: 'Brief every creator on the same three: dedicated video, link and offer in the first 3 lines, its own link.' })
  if (scan) {
    const mv = scan.themes.filter(t => t.recentN >= 10 && t.priorN >= 10).map(t => ({ t, d: t.recentHits / t.recentN - t.priorHits / t.priorN })).sort((a, b) => b.d - a.d)
    const up = mv.filter(x => x.d > 0.03).slice(0, 2), down = mv.filter(x => x.d < -0.03).slice(-2).reverse()
    const terms = scan.pulse.terms.slice(0, 3)
    if (up.length || down.length || terms.length) out.push({ head: 'What’s moving this week', tone: 'neutral',
      bullets: [
        ...up.map(x => `Rising: ${themeLabel(x.t.id)}, ${pct(x.t.priorHits / x.t.priorN)} → ${pct(x.t.recentHits / x.t.recentN)} of videos at 3×+ (last 90 days vs the year before).`),
        ...down.map(x => `Cooling: ${themeLabel(x.t.id)}, ${pct(x.t.priorHits / x.t.priorN)} → ${pct(x.t.recentHits / x.t.recentN)}.`),
        ...(terms.length ? [`Rising title terms: ${terms.map(t => `“${t.term}” (${t.now} new, ${r1(t.lift)}× last year’s share)`).join(', ')}.`] : []),
      ],
      so: up.length ? `Rising themes move up the list on their own; ${midLabel(themeLabel(up[0].t.id))} is where a new video has the tailwind.` : 'No theme is gaining fast: the list leans on proven themes this week.' })
  }
  return out
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
  const facts = programFacts(worked, failed)

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

  const rd = recommend(scan, themes, facts)
  return {
    dataEnd, fetchedAt: doc.fetchedAt, scan, ...rd, learnings: learn(scan, themes, facts, rd.recs), rows, videos: live, themes, factors, takeaway,
    worked, failed, medianPerK, program, all, programShare: all.ws ? program.ws / all.ws : null, funnel, unmapped, reconcile,
  }
}
