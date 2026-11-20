/**
 * Saved copies for viewers without a Clay Sigma connection.
 *
 * The daily job (scripts/refresh-cache.mjs) runs one query per tab covering every preset × comparison (5 × 2 = 10
 * views). Each query joins a small table of the distinct date ranges (rangeTable) and labels every row's bucket with
 * its range ("<start>~<end>"), so the SQL stays about the size of a single view. Unique visitors don't add up across
 * days, so each range is counted exactly rather than summed from daily totals. Grain (daily / weekly / monthly) is
 * applied in the page, so it needs no extra query.
 *
 * The page relabels the rows for the viewer's ranges (relabel) and feeds them to the same parsers as a live result.
 * Custom dates still need Sigma.
 */
import type { CompareMode } from './compute'
import type { ISODate } from './dates'
import { PRESETS, type PresetId } from './range'

export const OFFLINE_COMPARES: CompareMode[] = ['previous_period', 'previous_year']
export const OFFLINE_COMBOS = PRESETS.flatMap(p => OFFLINE_COMPARES.map(c => ({ preset: p.id as PresetId, compare: c, label: `${p.id}|${c}` })))

/** Query string that selects one combo (same params the filter bar writes). */
export function comboQs(preset: PresetId, compare: CompareMode): string {
  const sp = new URLSearchParams({ preset })
  if (compare !== 'previous_period') sp.set('compare', compare)
  return sp.toString()
}

type Table = { columns: string[]; rows: unknown[][] }
const isTable = (x: unknown): x is Table => !!x && Array.isArray((x as Table).columns) && Array.isArray((x as Table).rows)

/** Label of a date range in saved-copy queries. */
export const rangeLabel = (r: readonly [ISODate, ISODate]) => `${r[0]}~${r[1]}`

/** The ranges table every saved-copy query joins to: one row per distinct range ("lbl", "rs", "re"). */
export function rangeTable(ranges: readonly (readonly [ISODate, ISODate])[]): string {
  const uniq = [...new Map(ranges.map(r => [rangeLabel(r), r])).values()]
  for (const r of uniq) for (const x of r) if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`)
  return uniq.map(r => `SELECT '${rangeLabel(r)}' AS "lbl", DATE '${r[0]}' AS "rs", DATE '${r[1]}' AS "re"`).join(' UNION ALL ')
}

/**
 * A saved multi-range result → the rows of one view, shaped exactly like a live result for `keys`
 * (e.g. {cur: [s, e], prev: [s, e]}). In the bucket column `col`:
 *   "<label>"       → each key whose range has that label (a row can serve several keys)
 *   "dom:<label>"   → "dom:<key>",  "m:<label>" → "m:<key>",  "x:<label>:<m>" → "x:<key>:<m>"
 *   "bc@<label>"    → "bc" when it's the label of `cur`
 *   any other value holding "~" is another view's row and is dropped; everything else passes through.
 * Check coverage first with covers() (the saved copy's header lists its ranges): a range with no activity has no rows.
 */
export function relabel(payload: unknown, keys: Record<string, readonly [ISODate, ISODate]>, col = 'b'): Table | null {
  if (!isTable(payload)) return null
  const ix = payload.columns.findIndex(c => String(c).toLowerCase() === col)
  if (ix < 0) return null
  const byLabel = new Map<string, string[]>()
  for (const [k, r] of Object.entries(keys)) byLabel.set(rangeLabel(r), [...(byLabel.get(rangeLabel(r)) ?? []), k])
  const out: unknown[][] = []
  const emit = (row: unknown[], v: string) => { const x = row.slice(); x[ix] = v; out.push(x) }
  for (const row of payload.rows) {
    const v = String(row[ix] ?? '')
    if (!v.includes('~')) { out.push(row); continue }
    let m: RegExpMatchArray | null
    if ((m = v.match(/^bc@(.+)$/))) { if (byLabel.get(m[1])?.includes('cur')) emit(row, 'bc'); continue }
    if ((m = v.match(/^dom:(.+)$/))) { for (const k of byLabel.get(m[1]) ?? []) emit(row, `dom:${k}`); continue }
    if ((m = v.match(/^m:(.+)$/))) { for (const k of byLabel.get(m[1]) ?? []) emit(row, `m:${k}`); continue }
    if ((m = v.match(/^x:(.+):([a-z]+)$/))) { for (const k of byLabel.get(m[1]) ?? []) emit(row, `x:${k}:${m[2]}`); continue }
    const ks = byLabel.get(v)
    if (ks) for (const k of ks) emit(row, k)
  }
  return { columns: payload.columns, rows: out }
}

/** Every range the saved copy covers, for each tab (cur and prev of each preset × comparison). */
export function savedRanges(plans: { summaries: { cur: [ISODate, ISODate]; prev: [ISODate, ISODate] } }[]): [ISODate, ISODate][] {
  return plans.flatMap(p => [p.summaries.cur, p.summaries.prev])
}

/** True when every range in `keys` is one the saved copy computed (its header's `ranges`). */
export function covers(ranges: readonly string[] | undefined, keys: Record<string, readonly [ISODate, ISODate]>): boolean {
  return !!ranges && Object.values(keys).every(r => ranges.includes(rangeLabel(r)))
}
