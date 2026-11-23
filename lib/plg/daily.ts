/**
 * Daily series behind the cumulative chart's metric picker (Workspaces tab), one row per day per metric. The same
 * definitions as the headline tiles (lib/plg/sigma.ts): the dashboard's base CTE for workspaces, the MBR visitor and
 * paid rules. Kept out of the main query, which is close to Sigma's 10,000-row limit.
 *
 * Rows: k = 'w' (workspaces), 'v' (visitors) or 'p' (paid); d = day; one column per metric (zero where it doesn't apply):
 *   ws     new workspaces                hq     high-quality workspaces          np     non-personal (high + low quality)
 *   t13    Tier 1–3 workspaces            t13hq  Tier 1–3 high-quality workspaces
 *   act    activated within 7 days        mat    matured (created 7+ days before the data end): activation's base
 *   vis    MBR unique visitors that day (summed over days these are visits, not unique visitors over the range)
 *   paid   new paid PLG workspaces (first invoice that day)
 */
import type { ISODate } from './dates'
import { ACTIVATION_WINDOW_DAYS, SIGMA, dashboardCtes } from './sigma'

export const DAILY_METRICS = ['ws', 'hq', 'np', 't13', 't13hq', 'act', 'mat', 'vis', 'paid'] as const
export type DailyMetric = (typeof DAILY_METRICS)[number]
const HQ = `"q" = 'non-personal: high quality'`
const NP = `"q" IN ('non-personal: high quality', 'non-personal: low quality')`
const T13 = `"tier" IN ('Tier 1', 'Tier 2', 'Tier 3')`
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`); return `DATE '${x}'` }

export function dailySql(lo: ISODate, hi: ISODate, dataEnd: ISODate): string {
  const matured = `"day" <= DATE_ADD('day', -${ACTIVATION_WINDOW_DAYS}, ${d(dataEnd)})`
  // One wide row per day, then visitors and paid. Sigma folds SUM(CASE WHEN <condition on the grouped day> THEN 1 …) into
  // the constant 1, so a per-day condition is applied outside the aggregate (matured) and constant cases are avoided.
  return `${dashboardCtes(lo, hi)}
SELECT 'w' AS "k", CAST("day" AS string) AS "d", COUNT(*) AS "ws",
       SUM(CASE WHEN ${HQ} THEN 1 ELSE 0 END) AS "hq", SUM(CASE WHEN ${NP} THEN 1 ELSE 0 END) AS "np",
       SUM(CASE WHEN ${T13} THEN 1 ELSE 0 END) AS "t13", SUM(CASE WHEN ${HQ} AND ${T13} THEN 1 ELSE 0 END) AS "t13hq",
       SUM(CASE WHEN ${matured} THEN "act" ELSE 0 END) AS "act", CASE WHEN ${matured} THEN COUNT(*) ELSE 0 END AS "mat",
       0 AS "vis", 0 AS "paid"
FROM base GROUP BY "day"
UNION ALL SELECT 'v', CAST(CAST("TIMESTAMP_UTC" AS date) AS string), 0, 0, 0, 0, 0, 0, 0, COUNT(DISTINCT "ANONYMOUS_ID"), 0 FROM ${t(SIGMA.pageviews)}
  WHERE "SITE" IN ('marketing_website', 'signup') AND CAST("TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND COALESCE("TIMEZONE", '') NOT LIKE 'Asia/%' AND COALESCE("TIMEZONE", '') NOT IN ('UTC', 'Etc/UTC')
  GROUP BY CAST("TIMESTAMP_UTC" AS date)
UNION ALL SELECT 'p', CAST(CAST("FIRST_INVOICE_UTC" AS date) AS string), 0, 0, 0, 0, 0, 0, 0, 0, COUNT(DISTINCT "WORKSPACE_ID") FROM ${t(SIGMA.customers)}
  WHERE "FIRST_GTM_MOTION" = 'PLG' AND CAST("FIRST_INVOICE_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
  GROUP BY CAST("FIRST_INVOICE_UTC" AS date)`
}

export type DailySeries = Record<DailyMetric, Map<string, number>>
export function parseDaily(payload: unknown): DailySeries {
  const p = payload as { columns: string[]; rows: unknown[][] }
  const cols = p.columns.map(x => String(x).toLowerCase()), dd = cols.indexOf('d')
  const out = Object.fromEntries(DAILY_METRICS.map(x => [x, new Map<string, number>()])) as DailySeries
  for (const r of p.rows) {
    const day = String(r[dd]).slice(0, 10)
    for (const m of DAILY_METRICS) { const i = cols.indexOf(m), n = Number(r[i]) || 0; if (n) out[m].set(day, (out[m].get(day) ?? 0) + n) }
  }
  return out
}

/** Days the saved copy must cover: every preset × comparison the page can show without Sigma (lib/plg/offline.ts). */
export function savedDailyRange(plans: { summaries: { cur: [ISODate, ISODate]; prev: [ISODate, ISODate] } }[]): [ISODate, ISODate] {
  const xs = plans.flatMap(p => [p.summaries.cur, p.summaries.prev])
  return [xs.map(r => r[0]).sort()[0], xs.map(r => r[1]).sort().at(-1)!]
}
