/**
 * Weekly niche scan, step 2: score the raw pull (scripts/niche-scan.mjs) and work backwards from what did well.
 *
 * Scoring (SCAN): a channel's median is its long-form uploads (3 min+), newest 5 excluded, needing 15+ of them and a
 * median of 100+ views. A video's multiple is its views over that median; it's judged only once 21+ days old. Against
 * its own channel a video is an outlier at 3×+ (and 3×+ the 31 uploads around it, so one small channel's spike doesn't
 * dominate), a copy that worked at 2×+, a copy that failed under 0.7×.
 *
 * Working backwards, per theme: the original hit (highest multiple with 5,000+ views), how many copies worked and failed
 * and on how many channels, how recent the hits are, and what separates winners from losers (length, chapters, title
 * formats, channel size, words that show up on one side only). Per title format the same hit rates. The pulse is what's
 * new since the previous scan: videos first seen or published in the last 14 days (with an early multiple), channels
 * found this week, title terms rising against the past year, and themes gaining or losing hits.
 */
import { FORMATS, THEMES, formatsOf, themeOf, type FormatId, type ThemeId } from './themes'

export const SCAN = { longSecs: 180, minChannelVideos: 15, minMedian: 100, excludeNewest: 5, minAgeDays: 21, outlier: 3, worked: 2, failed: 0.7, under: 0.5, neighbours: 31, minOutlierViews: 5000, newDays: 14, earlyMinDays: 2 }

export type Raw = {
  fetchedAt: string; partial: boolean; discover: boolean; units: number
  channels: Record<string, { t: string; h: string | null; subs: number | null; n: number | null; up: string; program: boolean; seedHits: number | null; isNew: boolean }>
  /** ch: channel id; chapters: chapter lines in the description; cl: line of the first Clay link; ln: links. */
  videos: { id: string; ch: string; t: string; p: string; s: number; v: number; l: number; c: number; live: number; chapters: number; cl: number | null; ln: number }[]
  searches: Record<string, string[]>; fresh: Record<string, string[]>; newChannels: string[]
}
/** Compact video row in the scan document. */
export type SV = { id: string; c: string; t: string; p: string; m: number; v: number; x: number | null; nb: number | null; ch: number; th: ThemeId; f: FormatId[]; early?: 1; isNew?: 1 }
export type Sep = { label: string; w: number; wn: number; f: number; fn: number }
export type ThemeStat = {
  id: ThemeId; n: number; hits: number; worked: number; failed: number; winChannels: number; x10: number; below: number
  recentHits: number; recentN: number; priorHits: number; priorN: number
  original: string | null; winners: string[]; losers: string[]; seps: Sep[]; words: { w: string[]; f: string[] }; bestFormat: FormatId | null
}
export type FormatStat = { id: FormatId; n: number; hits: number; below: number; best: string[]; worst: string[] }
export type ScanRec = { theme: ThemeId; title: string; angle: string; thumbnail: string; structure: string; offer: string; notes?: string }
export type ScanDoc = {
  version: 1; fetchedAt: string; analyzedAt: string; prevFetchedAt: string | null; partial: boolean
  pool: { channels: number; videos: number; scored: number; outliers: number; outliers10x: number; under: number; baseRate: number; workedRate: number }
  channels: Record<string, { t: string; subs: number | null; median: number | null; program?: 1; isNew?: 1 }>
  videos: SV[]
  themes: ThemeStat[]
  formats: FormatStat[]
  pulse: { newTotal: number; earlyHits: number; newVideos: string[]; newChannels: string[]; terms: { term: string; now: number; base: number; lift: number; vids: string[] }[] }
  /** Written by the weekly review (the agent that runs the scan), grounded in this document; optional. */
  recs?: ScanRec[]
  /** Themes recommended in the previous scan, to mark what's new. */
  prevRecThemes?: ThemeId[]
  seen: string[]
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const days = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 864e5
const STOP = new Set(('the and for you your with how this that what from are can why who will just get got its into about our out not all one now new more most best way ways use using used make made than then them they his her him has have had was were been to vs i my me we us an a of in on at by or if it is be do does did so no yes up down off over under again very too also only own same such each any some few ' +
  'should would could which when where here there these those still even ever never every much many really actually thing things need want know think look looks long hard easy part full guide video videos views watch day days week year years time first last next real right big little good great better worst bad free start stop work works working before after while because without inside like until people someone everyone nobody something everything anyone money you\'re don\'t can\'t won\'t it\'s i\'m').split(' '))
const words = (t: string) => [...new Set(t.toLowerCase().replace(/[^a-z0-9$+ ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))]

export function analyze(raw: Raw, prev: ScanDoc | null, now = raw.fetchedAt): ScanDoc {
  const byCh = new Map<string, Raw['videos']>()
  for (const v of raw.videos) { if (v.live) continue; (byCh.get(v.ch) ?? byCh.set(v.ch, []).get(v.ch)!).push(v) }
  // Channel medians and neighbour baselines.
  const median_ = new Map<string, number | null>()
  const nbMed = new Map<string, number | null>()
  for (const [ch, vs] of byCh) {
    const long = vs.filter(v => v.s >= SCAN.longSecs).sort((a, b) => b.p.localeCompare(a.p))
    const base = long.slice(SCAN.excludeNewest)
    const m = base.length >= SCAN.minChannelVideos ? median(base.map(v => v.v)) : null
    median_.set(ch, m != null && m >= SCAN.minMedian ? m : null)
    const half = Math.floor(SCAN.neighbours / 2)
    long.forEach((v, i) => { const around = long.slice(Math.max(0, i - half), i).concat(long.slice(i + 1, i + 1 + half)); nbMed.set(v.id, around.length >= 10 ? median(around.map(x => x.v)) : null) })
  }
  const seen = new Set(prev?.seen ?? [])
  const rows = raw.videos.filter(v => !v.live && v.s >= SCAN.longSecs).map(v => {
    const md = median_.get(v.ch) ?? null, nb = nbMed.get(v.id) ?? null
    const age = days(v.p, now)
    return { raw: v, age, md, x: md ? v.v / md : null, nb: nb ? v.v / nb : null, th: themeOf(null, v.t), f: formatsOf(v.t), isNew: (prev ? !seen.has(v.id) : true) && age <= SCAN.newDays }
  })
  const judged = rows.filter(r => r.x != null && r.age >= SCAN.minAgeDays && r.th !== 'other' && r.th !== 'off-niche')
  const isOut = (r: (typeof rows)[number]) => r.x! >= SCAN.outlier && (r.nb ?? r.x!) >= SCAN.outlier && r.raw.v >= SCAN.minOutlierViews
  const keep = new Set<string>()
  const pick = (ids: string[]) => { ids.forEach(i => keep.add(i)); return ids }

  const themes: ThemeStat[] = THEMES.filter(t => t.id !== 'other' && t.id !== 'off-niche').map(t => {
    const vs = judged.filter(r => r.th === t.id)
    const W = vs.filter(r => r.x! >= SCAN.worked), F = vs.filter(r => r.x! < SCAN.failed)
    const hits = vs.filter(r => r.x! >= SCAN.outlier)
    const recent = vs.filter(r => r.age <= SCAN.minAgeDays + 90), prior = vs.filter(r => r.age > SCAN.minAgeDays + 90 && r.age <= SCAN.minAgeDays + 365)
    const winnersAll = [...W].filter(r => r.raw.v >= SCAN.minOutlierViews).sort((a, b) => b.x! - a.x!)
    // One per channel in the examples, so one creator's series doesn't fill the list.
    const perChannel = (xs: typeof vs, n: number) => { const used = new Set<string>(); return xs.filter(r => !used.has(r.raw.ch) && used.add(r.raw.ch)).slice(0, n) }
    const winners = perChannel(winnersAll, 8), losers = perChannel([...F].sort((a, b) => a.x! - b.x!), 6)
    const seps = separators(W, F)
    // Words that show up on one side: smoothed log-odds, at least 3 videos.
    const cw = new Map<string, [number, number]>()
    for (const r of W) for (const w of words(r.raw.t)) cw.set(w, [(cw.get(w)?.[0] ?? 0) + 1, cw.get(w)?.[1] ?? 0])
    for (const r of F) for (const w of words(r.raw.t)) cw.set(w, [cw.get(w)?.[0] ?? 0, (cw.get(w)?.[1] ?? 0) + 1])
    const lo = [...cw.entries()].filter(([, [a, b]]) => a + b >= 3).map(([w, [a, b]]) => [w, Math.log((a + 0.5) / (W.length + 1)) - Math.log((b + 0.5) / (F.length + 1))] as const)
    const fmt = FORMATS.map(f => { const xs = vs.filter(r => r.f.includes(f.id)); return { id: f.id, n: xs.length, rate: xs.length ? xs.filter(r => r.x! >= SCAN.worked).length / xs.length : 0 } })
      .filter(f => f.n >= 5).sort((a, b) => b.rate - a.rate)[0]
    return {
      id: t.id, n: vs.length, hits: hits.length, worked: W.length, failed: F.length, winChannels: new Set(W.map(r => r.raw.ch)).size,
      x10: vs.filter(r => r.x! >= 10).length, below: vs.filter(r => r.x! < SCAN.under).length,
      recentHits: recent.filter(r => r.x! >= SCAN.outlier).length, recentN: recent.length, priorHits: prior.filter(r => r.x! >= SCAN.outlier).length, priorN: prior.length,
      original: pick(winnersAll.slice(0, 1).map(r => r.raw.id))[0] ?? null,
      winners: pick(winners.map(r => r.raw.id)), losers: pick(losers.map(r => r.raw.id)), seps,
      words: { w: lo.filter(([, s]) => s > 0.4).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w), f: lo.filter(([, s]) => s < -0.4).sort((a, b) => a[1] - b[1]).slice(0, 6).map(([w]) => w) },
      bestFormat: fmt?.id ?? null,
    }
  })

  const formats: FormatStat[] = FORMATS.map(f => {
    const vs = judged.filter(r => r.f.includes(f.id))
    const perCh = (xs: typeof vs) => { const used = new Set<string>(); return xs.filter(r => !used.has(r.raw.ch) && used.add(r.raw.ch)) }
    return { id: f.id, n: vs.length, hits: vs.filter(r => r.x! >= SCAN.outlier).length, below: vs.filter(r => r.x! < SCAN.under).length,
      best: pick(perCh(vs.filter(r => r.raw.v >= SCAN.minOutlierViews).sort((a, b) => b.x! - a.x!)).slice(0, 2).map(r => r.raw.id)),
      worst: pick(perCh([...vs].sort((a, b) => a.x! - b.x!)).slice(0, 2).map(r => r.raw.id)) }
  })

  // Outliers for the table: 3×+ against the channel and its neighbours, 5,000+ views, at most two per channel.
  const outl = judged.filter(isOut).sort((a, b) => b.x! - a.x!)
  const perCh2 = new Map<string, number>()
  pick(outl.filter(r => { const c = perCh2.get(r.raw.ch) ?? 0; if (c >= 2) return false; perCh2.set(r.raw.ch, c + 1); return true }).slice(0, 120).map(r => r.raw.id))

  // Pulse: new videos (first seen this scan, 14 days or younger), with an early multiple.
  const fresh = rows.filter(r => r.isNew && r.age >= SCAN.earlyMinDays && r.x != null && r.th !== 'off-niche' && r.th !== 'other').sort((a, b) => b.x! - a.x!)
  // At most 3 per channel, so one prolific channel doesn't fill the list.
  const perNew = new Map<string, number>()
  const newVideos = pick(fresh.filter(r => { const c = perNew.get(r.raw.ch) ?? 0; if (c >= 3) return false; perNew.set(r.raw.ch, c + 1); return true }).slice(0, 60).map(r => r.raw.id))
  // Rising terms: share of this fortnight's titles against the past year's.
  const niche = rows.filter(r => r.th !== 'other' && r.th !== 'off-niche')
  const recentT = niche.filter(r => r.age <= SCAN.newDays), baseT = niche.filter(r => r.age > SCAN.newDays && r.age <= 365)
  const tally = (rs: typeof rows) => { const m = new Map<string, Set<string>>(); for (const r of rs) for (const w of words(r.raw.t)) (m.get(w) ?? m.set(w, new Set()).get(w)!).add(r.raw.id); return m }
  const tn = tally(recentT), tb = tally(baseT)
  const terms = [...tn.entries()].filter(([, ids]) => ids.size >= 3 && new Set([...ids].map(i => rows.find(r => r.raw.id === i)!.raw.ch)).size >= 3)
    .map(([term, ids]) => { const now_ = ids.size / Math.max(1, recentT.length), base = (tb.get(term)?.size ?? 0) / Math.max(1, baseT.length); return { term, now: ids.size, base: tb.get(term)?.size ?? 0, lift: (now_ + 1e-3) / (base + 1e-3), vids: [...ids] } })
    .filter(t => t.lift >= 2).sort((a, b) => b.lift - a.lift).slice(0, 12)
  for (const t of terms) { t.vids = t.vids.sort((a, b) => (rows.find(r => r.raw.id === b)?.x ?? 0) - (rows.find(r => r.raw.id === a)?.x ?? 0)).slice(0, 4); pick(t.vids) }

  const sv = (r: (typeof rows)[number]): SV => ({ id: r.raw.id, c: r.raw.ch, t: r.raw.t, p: r.raw.p, m: Math.round(r.raw.s / 60), v: r.raw.v, x: r.x == null ? null : +r.x.toFixed(2), nb: r.nb == null ? null : +r.nb.toFixed(2),
    ch: r.raw.chapters ?? 0, th: r.th, f: r.f, ...(r.age < SCAN.minAgeDays ? { early: 1 as const } : {}), ...(r.isNew ? { isNew: 1 as const } : {}) })
  const byId = new Map(rows.map(r => [r.raw.id, r]))
  const usedCh = new Set<string>()
  const videos = [...keep].map(i => byId.get(i)).filter((r): r is NonNullable<typeof r> => !!r).map(r => { usedCh.add(r.raw.ch); return sv(r) })
  const channels: ScanDoc['channels'] = {}
  for (const [id, c] of Object.entries(raw.channels)) if (usedCh.has(id) || c.isNew || c.program) channels[id] = { t: c.t, subs: c.subs, median: median_.get(id) ?? null, ...(c.program ? { program: 1 as const } : {}), ...(c.isNew ? { isNew: 1 as const } : {}) }

  const scored = judged.length
  return {
    version: 1, fetchedAt: raw.fetchedAt, analyzedAt: new Date().toISOString(), prevFetchedAt: prev?.fetchedAt ?? null, partial: raw.partial,
    pool: { channels: Object.keys(raw.channels).length, videos: raw.videos.length, scored, outliers: judged.filter(r => r.x! >= SCAN.outlier).length,
      outliers10x: judged.filter(r => r.x! >= 10).length, under: judged.filter(r => r.x! < SCAN.under).length,
      baseRate: scored ? judged.filter(r => r.x! >= SCAN.outlier).length / scored : 0, workedRate: scored ? judged.filter(r => r.x! >= SCAN.worked).length / scored : 0 },
    channels, videos, themes, formats,
    pulse: { newTotal: fresh.length, earlyHits: fresh.filter(r => r.x! >= 1.5).length, newVideos, newChannels: raw.newChannels, terms },
    prevRecThemes: prev?.recs?.map(r => r.theme) ?? prev?.prevRecThemes ?? [],
    seen: [...new Set([...seen, ...raw.videos.map(v => v.id)])],
  }
}


function separators(W: { raw: Raw['videos'][number]; f: FormatId[]; md: number | null }[], F: typeof W): Sep[] {
  if (W.length < 3 || F.length < 3) return []
  const feats: [string, (r: (typeof W)[number]) => boolean][] = [
    ['20 minutes or longer', r => r.raw.s >= 1200],
    ['Under 10 minutes', r => r.raw.s < 600],
    ['Has chapters', r => (r.raw.chapters ?? 0) >= 3],
    ['Small channel (median under 1,000 views)', r => (r.md ?? 0) < 1000],
    ...FORMATS.map(f => [f.label, (r: (typeof W)[number]) => r.f.includes(f.id)] as [string, (r: (typeof W)[number]) => boolean]),
  ]
  return feats.map(([label, p]) => ({ label, w: W.filter(p).length, wn: W.length, f: F.filter(p).length, fn: F.length }))
    .filter(s => s.w + s.f >= 3)
    .map(s => ({ s, d: s.w / s.wn - s.f / s.fn }))
    .filter(x => Math.abs(x.d) >= 0.12)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6).map(x => x.s)
}
