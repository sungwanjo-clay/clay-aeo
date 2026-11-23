/**
 * Daily series behind the cumulative chart's metric picker (Workspaces tab), one row per day per metric. The same
 * definitions as the headline tiles (lib/plg/sigma.ts): the dashboard's base CTE for workspaces, the MBR visitor and
 * paid rules. Kept out of the main query, which is close to Sigma's 10,000-row limit.
 *
 * Rows (k = 'dx', d = day, m = metric, n = count):
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
  const ws = (m: string, cond: string) => `SELECT 'dx' AS "k", CAST("day" AS string) AS "d", '${m}' AS "m", SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS "n" FROM base GROUP BY "day"`
  return `${dashboardCtes(lo, hi)}
${ws('ws', 'TRUE')}
UNION ALL ${ws('hq', HQ)}
UNION ALL ${ws('np', NP)}
UNION ALL ${ws('t13', T13)}
UNION ALL ${ws('t13hq', `${HQ} AND ${T13}`)}
UNION ALL SELECT 'dx', CAST("day" AS string), 'act', SUM(CASE WHEN ${matured} THEN "act" ELSE 0 END) FROM base GROUP BY "day"
UNION ALL ${ws('mat', matured)}
UNION ALL SELECT 'dx', CAST(CAST("TIMESTAMP_UTC" AS date) AS string), 'vis', COUNT(DISTINCT "ANONYMOUS_ID") FROM ${t(SIGMA.pageviews)}
  WHERE "SITE" IN ('marketing_website', 'signup') AND CAST("TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND COALESCE("TIMEZONE", '') NOT LIKE 'Asia/%' AND COALESCE("TIMEZONE", '') NOT IN ('UTC', 'Etc/UTC')
  GROUP BY CAST("TIMESTAMP_UTC" AS date)
UNION ALL SELECT 'dx', CAST(CAST("FIRST_INVOICE_UTC" AS date) AS string), 'paid', COUNT(DISTINCT "WORKSPACE_ID") FROM ${t(SIGMA.customers)}
  WHERE "FIRST_GTM_MOTION" = 'PLG' AND CAST("FIRST_INVOICE_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
  GROUP BY CAST("FIRST_INVOICE_UTC" AS date)`
}

export type DailySeries = Record<DailyMetric, Map<string, number>>
export function parseDaily(payload: unknown): DailySeries {
  const p = payload as { columns: string[]; rows: unknown[][] }
  const ix = (c: string) => p.columns.map(x => String(x).toLowerCase()).indexOf(c)
  const [k, dd, m, n] = ['k', 'd', 'm', 'n'].map(ix)
  const out = Object.fromEntries(DAILY_METRICS.map(x => [x, new Map<string, number>()])) as DailySeries
  for (const r of p.rows) if (r[k] === 'dx' && out[r[m] as DailyMetric]) out[r[m] as DailyMetric].set(String(r[dd]).slice(0, 10), Number(r[n]) || 0)
  return out
}

/** Days the saved copy must cover: every preset × comparison the page can show without Sigma (lib/plg/offline.ts). */
export function savedDailyRange(plans: { summaries: { cur: [ISODate, ISODate]; prev: [ISODate, ISODate] } }[]): [ISODate, ISODate] {
  const xs = plans.flatMap(p => [p.summaries.cur, p.summaries.prev])
  return [xs.map(r => r[0]).sort()[0], xs.map(r => r[1]).sort().at(-1)!]
}
