/**
 * The dashboard's data end: the last day that every source it reads has fully loaded, so no tile, chart or saved copy
 * runs a day ahead of another.
 *
 *   1. Per source, the last full day is the day before the newest day present (the newest day is still loading).
 *   2. That day must look whole: at least FRESH.minShare of the median of the same weekday over the four weeks before
 *      (a half-written load shows up as a cliff; a holiday like Thanksgiving stays well above it). If not, step back.
 *   3. The data end is the earliest of those days across sources, and never later than yesterday (UTC).
 *
 * Sources (DATE in UTC): blended attribution (workspaces), CUSTOMERS (paid, domains), website sessions (conversion
 * section), pageviews (visitors) and CTA clicks. freshnessSql returns rows (src, day, n) for the last FRESH.days days.
 */
import { addDays, type ISODate } from './dates'

export const FRESH = { days: 36, minShare: 0.25, maxStepBack: 3 }
const SOURCES = [
  { src: 'workspaces', label: 'Blended attribution (workspaces)', table: 'b9625c73-5094-4b94-9c0f-034c5efccbd4', col: '"WORKSPACE_CREATED_AT_UTC"', where: `"ATTRIBUTION_WINDOW" = '90_days' AND "ATTRIBUTION_TYPE" = 'first_touch'` },
  { src: 'customers', label: 'CUSTOMERS', table: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', col: '"CREATED_AT_UTC"' },
  { src: 'sessions', label: 'Website sessions', table: 'cf3c596b-2dde-415a-b248-efda79af9fa3', col: '"SESSION_START_UTC"' },
  { src: 'pageviews', label: 'Pageviews (visitors)', table: '2a126a88-fa3d-49aa-ae05-5e830a2f3037', col: '"TIMESTAMP_UTC"' },
  { src: 'clicks', label: 'CTA clicks', table: '97cf52d9-8523-4af4-a02e-b8e8d8019b28', col: '"TIMESTAMP"' },
] as const
export type FreshSource = (typeof SOURCES)[number]['src']

const d = (x: ISODate) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`); return `DATE '${x}'` }

export function freshnessSql(todayUtc: ISODate): string {
  const from = addDays(todayUtc, -FRESH.days)
  return SOURCES.map(s => `SELECT '${s.src}' AS "src", CAST(CAST(${s.col} AS date) AS string) AS "day", COUNT(*) AS "n"
FROM "connection"."${s.table}"
WHERE CAST(${s.col} AS date) >= ${d(from)}${'where' in s ? ` AND ${s.where}` : ''}
GROUP BY CAST(${s.col} AS date)`).join('\nUNION ALL\n')
}

export type SourceVerdict = { src: FreshSource; label: string; newest: ISODate | null; lastFull: ISODate | null; n: number; typical: number | null; note: string }
export type Freshness = { dataEnd: ISODate | null; sources: SourceVerdict[]; limitedBy: FreshSource[] }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }

export function pickDataEnd(payload: unknown, todayUtc: ISODate): Freshness {
  const p = payload as { columns: string[]; rows: unknown[][] }
  const cols = p.columns.map(c => String(c).toLowerCase()), [is, id, inn] = ['src', 'day', 'n'].map(c => cols.indexOf(c))
  const by = new Map<string, Map<string, number>>()
  for (const r of p.rows) { const s = String(r[is]); (by.get(s) ?? by.set(s, new Map()).get(s)!).set(String(r[id]).slice(0, 10), Number(r[inn]) || 0) }
  const yesterday = addDays(todayUtc, -1)
  const sources: SourceVerdict[] = SOURCES.map(s => {
    const m = by.get(s.src) ?? new Map<string, number>()
    const days = [...m.keys()].filter(x => x <= todayUtc).sort()
    const newest = (days.at(-1) ?? null) as ISODate | null
    if (!newest) return { src: s.src, label: s.label, newest: null, lastFull: null, n: 0, typical: null, note: 'no rows in the last 36 days' }
    let day = addDays(newest, -1)
    if (day > yesterday) day = yesterday
    let note = `newest day ${newest} still loading`
    for (let step = 0; step <= FRESH.maxStepBack; step++) {
      const typical = median([7, 14, 21, 28].map(k => m.get(addDays(day, -k)) ?? 0).filter(x => x > 0))
      const n = m.get(day) ?? 0
      if (typical == null || n >= FRESH.minShare * typical) return { src: s.src, label: s.label, newest, lastFull: day, n, typical, note }
      note = `${day} looked partial (${n.toLocaleString('en-US')} vs a typical ${Math.round(typical).toLocaleString('en-US')})`
      day = addDays(day, -1)
    }
    return { src: s.src, label: s.label, newest, lastFull: null, n: 0, typical: null, note: `no whole day in the last ${FRESH.maxStepBack + 1} days` }
  })
  const ends = sources.map(s => s.lastFull)
  const dataEnd = ends.some(x => x == null) ? null : (ends as ISODate[]).sort()[0]
  return { dataEnd, sources, limitedBy: dataEnd ? sources.filter(s => s.lastFull === dataEnd).map(s => s.src) : sources.filter(s => !s.lastFull).map(s => s.src) }
}
