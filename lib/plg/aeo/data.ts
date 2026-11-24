/**
 * AEO (AI answer visibility) tab: what scripts/sync-aeo.mjs writes into the artifact db (collection `aeo`), and the
 * math the page does on it. docs/aeo-tab.md has the metric definitions.
 *
 * Every number is stored as a weekly COUNT (never a rate), one slice per platform × prompt type, so any period and any
 * filter is computed exactly: sum the numerators over the weeks, sum the denominators, then divide. Never average
 * weekly rates.
 */

export type AeoPlatform = 'all' | 'ChatGPT' | 'Claude'
export type AeoPromptType = 'Benchmark' | 'Branded' | 'all'
export const AEO_PLATFORMS: AeoPlatform[] = ['all', 'ChatGPT', 'Claude']
export const AEO_PROMPT_TYPES: AeoPromptType[] = ['Benchmark', 'Branded', 'all']
export const sliceId = (p: AeoPlatform, t: AeoPromptType) => `${p === 'all' ? 'all' : p.toLowerCase()}-${t.toLowerCase()}`

/** Weekly totals, in this column order (W.total etc.). */
export const W = {
  total: 0,        // responses (prompt × platform runs)
  mentioned: 1,    // responses that mention Clay
  cited: 2,        // responses citing a clay.com URL
  withCit: 3,      // responses with any citation
  sumPos: 4,       // sum of Clay's mention position (1 = first tool named)
  cntPos: 5,       // responses with a position
  pos: 6, neu: 7, neg: 8,   // Clay brand sentiment, among responses that mention Clay
  claygent: 9,     // responses naming Claygent or Clay MCP
  followup: 10,    // responses recommending Clay as the next step
} as const
export type WeekRow = number[]

/** db `aeo/slice-<platform>-<type>`. Arrays run parallel to meta.weeks. */
export type AeoSlice = {
  w: WeekRow[]
  comp: Record<string, number[]>                 // competitor → responses mentioning it
  dom: Record<string, number[]>                  // cited domain → responses citing it
  pmm: Record<string, [number[], number[]]>      // PMM use case → [responses, Clay mentions]
  topic: Record<string, [number[], number[]]>    // topic → [responses, Clay mentions]
}

/** db `aeo/meta`. */
export type AeoMeta = {
  version: 1
  syncedAt: string
  sample?: boolean                 // true = generated sample data, not the AEO database
  weeks: string[]                  // Mondays (YYYY-MM-DD), oldest first
  domType: Record<string, string>  // domain → its most common citation type
  clayDomains: string[]            // domains that count as Clay's own (clay.com, university.clay.com, …)
  slices: string[]                 // slice ids present
}
export type AeoData = { meta: AeoMeta; slices: Record<string, AeoSlice> }

/** PMM use cases hidden everywhere (noise). */
export const HIDDEN_PMM = new Set(['Event Campaigns'])

// ─── range math ───────────────────────────────────────────────────────────────

export type Range = { i0: number; i1: number }  // inclusive week indexes
export const sum = (a: number[] | undefined, r: Range) => { let s = 0; if (a) for (let i = r.i0; i <= r.i1; i++) s += a[i] ?? 0; return s }
const col = (w: WeekRow[], c: number) => w.map(x => x[c] ?? 0)
const rate = (n: number, d: number) => (d > 0 ? n / d : null)

/** The last `n` weeks and the `n` before them (null when the data doesn't reach back that far). */
export function ranges(weeks: number, n: number): { cur: Range; prev: Range | null } {
  const i1 = weeks - 1, i0 = Math.max(0, weeks - n)
  return { cur: { i0, i1 }, prev: i0 - n >= 0 ? { i0: i0 - n, i1: i0 - 1 } : i0 > 0 ? { i0: 0, i1: i0 - 1 } : null }
}

export type Kpis = {
  responses: number; visibility: number | null; citation: number | null; position: number | null
  positive: number | null; claygent: number; followup: number; mentioned: number
}
export function kpis(s: AeoSlice, r: Range): Kpis {
  const g = (c: number) => sum(col(s.w, c), r)
  const mentioned = g(W.mentioned)
  return {
    responses: g(W.total), mentioned,
    visibility: rate(mentioned, g(W.total)), citation: rate(g(W.cited), g(W.withCit)),
    position: rate(g(W.sumPos), g(W.cntPos)), positive: rate(g(W.pos), g(W.pos) + g(W.neu) + g(W.neg)),
    claygent: g(W.claygent), followup: g(W.followup),
  }
}

/** Per-week series for one measure over a range. */
export function weekly(meta: AeoMeta, s: AeoSlice, r: Range, f: (row: WeekRow) => number | null) {
  const out: { week: string; v: number | null }[] = []
  for (let i = r.i0; i <= r.i1; i++) out.push({ week: meta.weeks[i], v: s.w[i] ? f(s.w[i]) : null })
  return out
}

export type Ranked = { name: string; value: number | null; prev: number | null; n: number; isClay?: boolean; type?: string }

/** Competitors by share of responses mentioning them; Clay included as a row. */
export function competitorBoard(s: AeoSlice, cur: Range, prev: Range | null): Ranked[] {
  const tc = sum(col(s.w, W.total), cur), tp = prev ? sum(col(s.w, W.total), prev) : 0
  const rows: Ranked[] = Object.entries(s.comp).map(([name, a]) => ({
    name, n: sum(a, cur), value: rate(sum(a, cur), tc), prev: prev ? rate(sum(a, prev), tp) : null,
  }))
  rows.push({ name: 'Clay', isClay: true, n: sum(col(s.w, W.mentioned), cur), value: rate(sum(col(s.w, W.mentioned), cur), tc),
    prev: prev ? rate(sum(col(s.w, W.mentioned), prev), tp) : null })
  return rows.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
}

/** Cited domains by share of responses-with-citations citing them. */
export function domainBoard(meta: AeoMeta, s: AeoSlice, cur: Range, prev: Range | null): Ranked[] {
  const dc = sum(col(s.w, W.withCit), cur), dp = prev ? sum(col(s.w, W.withCit), prev) : 0
  const clay = new Set(meta.clayDomains)
  return Object.entries(s.dom).map(([name, a]) => ({
    name, n: sum(a, cur), value: rate(sum(a, cur), dc), prev: prev ? rate(sum(a, prev), dp) : null,
    isClay: clay.has(name), type: meta.domType[name],
  })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
}

export type GroupRow = { name: string; responses: number; value: number | null; prev: number | null; spark: (number | null)[] }
/** PMM use cases or topics: Clay's visibility within each, with its weekly line. */
export function groupTable(g: Record<string, [number[], number[]]>, cur: Range, prev: Range | null, hidden?: Set<string>): GroupRow[] {
  return Object.entries(g).filter(([k]) => !hidden?.has(k)).map(([name, [tot, men]]) => {
    const spark: (number | null)[] = []
    for (let i = cur.i0; i <= cur.i1; i++) spark.push(rate(men[i] ?? 0, tot[i] ?? 0))
    return { name, responses: sum(tot, cur), value: rate(sum(men, cur), sum(tot, cur)), prev: prev ? rate(sum(men, prev), sum(tot, prev)) : null, spark }
  }).filter(r => r.responses > 0).sort((a, b) => b.responses - a.responses)
}

/** Weekly share series for a few named entities (competitor visibility or domain citation share). */
export function shareSeries(meta: AeoMeta, s: AeoSlice, r: Range, names: string[], kind: 'comp' | 'dom') {
  const den = col(s.w, kind === 'comp' ? W.total : W.withCit)
  const clayNum = col(s.w, kind === 'comp' ? W.mentioned : W.cited)
  const rows: Record<string, string | number | null>[] = []
  for (let i = r.i0; i <= r.i1; i++) {
    const row: Record<string, string | number | null> = { week: meta.weeks[i], Clay: rate(clayNum[i], den[i]) }
    for (const n of names) row[n] = rate((kind === 'comp' ? s.comp[n] : s.dom[n])?.[i] ?? 0, den[i])
    rows.push(row)
  }
  return rows
}

/** Shape check before the page trusts a synced copy. Returns a problem or null. */
export function checkAeo(d: AeoData): string | null {
  const n = d.meta.weeks?.length ?? 0
  if (!n) return 'no weeks'
  for (const id of d.meta.slices) {
    const s = d.slices[id]
    if (!s) return `slice ${id} missing`
    if (s.w.length !== n) return `slice ${id} has ${s.w.length} weeks, expected ${n}`
    const bad = s.w.findIndex(r => r[W.mentioned] > r[W.total] || r[W.cited] > r[W.withCit] || r[W.withCit] > r[W.total])
    if (bad >= 0) return `slice ${id} week ${d.meta.weeks[bad]}: a count exceeds its denominator`
  }
  return null
}
