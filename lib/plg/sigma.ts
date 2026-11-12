/**
 * Live data through the viewer's Sigma connector (claude.ai artifact).
 *
 * One SQL call per view state returns every range the dashboard needs as
 * labelled buckets (UNION ALL), aggregated in Snowflake, so the payload stays
 * small (~2k rows) whatever the date range. Tables are referenced by their
 * Sigma inode ids on the Snowflake connection (Sigma "connection" queries).
 *
 * Same definitions as the nightly ETL (lib/plg/snowflake.ts):
 *   DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION  (90_days, first_touch)
 *   → DBT.PROD.CUSTOMERS.DOMAIN → FIVETRAN.SALESFORCE.ACCOUNT.SALES_TIER_C
 */
import type { DailyPoint, RangeSummary } from './compute'
import type { ISODate } from './dates'
import { GOAL_SEGMENT } from './config'
import { DAILY_KEYS, SUMMARY_KEYS, type DashboardPlan, type DailyKey, type SummaryKey } from './plan'

export const SIGMA = {
  server: 'Clay Sigma',
  connectionId: '2d269863-3d4a-459d-9245-daff9e223f17',
  workspaces: 'b9625c73-5094-4b94-9c0f-034c5efccbd4', // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae',  // DBT.PROD.CUSTOMERS
  accounts: 'e6443e27-6d72-4dd5-b511-94aba9cab915',   // FIVETRAN.SALESFORCE.ACCOUNT
  metrics: 'fc12f388-0a8f-4213-9af1-e4575ddf79e6',    // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION_METRICS
} as const

const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`)
  return `DATE '${x}'`
}
const WS_FILTER = `"ATTRIBUTION_WINDOW" = '90_days' AND "ATTRIBUTION_TYPE" = 'first_touch'`

/**
 * Latest COMPLETE day, from the canonical metrics table: dbt flags the day in
 * progress at build time with CURRENT_TIME_PERIOD_FLAG = 1. (The raw max date
 * can be a partial day when the warehouse loads mid-day.)
 */
export function latestDaySql(todayUtc: ISODate): string {
  return `SELECT CAST(MAX(CAST("TIME_PERIOD_START" AS date)) AS string) AS "max_day"
FROM ${t(SIGMA.metrics)}
WHERE "TIME_PERIOD_TYPE" = 'day' AND "CHANNEL_HIERARCHY_LEVEL" = 'aggregate' AND "DIMENSION_TYPE" = 'aggregate'
  AND "ATTRIBUTION_TYPE" = 'blended' AND "ATTRIBUTION_WINDOW" = '90_days' AND "FUNNEL_GTM_SEGMENT" = 'PLG'
  AND "DATE_COHORT_ANCHOR" = 'workspace_created_date' AND "CURRENT_TIME_PERIOD_FLAG" = 0
  AND CAST("TIME_PERIOD_START" AS date) >= ${d(todayUtc)} - INTERVAL '14 day'`
}

export function dashboardSql(plan: DashboardPlan): string {
  const ranges = [...SUMMARY_KEYS.map(k => plan.summaries[k]), ...DAILY_KEYS.map(k => plan.dailies[k])]
  const lo = ranges.map(r => r[0]).sort()[0]
  const hi = ranges.map(r => r[1]).sort().at(-1)!
  const between = (r: [ISODate, ISODate]) => `"day" BETWEEN ${d(r[0])} AND ${d(r[1])}`

  const summaryParts = SUMMARY_KEYS.map(k => `
SELECT '${k}' AS "b", '' AS "d", "cat", "ch", "sub", "tier", "q", COUNT(*) AS "n"
FROM base WHERE ${between(plan.summaries[k])}
GROUP BY "cat", "ch", "sub", "tier", "q"`)

  const domainParts = (['cur', 'prev'] as const).map(k => `
SELECT 'dom:${k}' AS "b", '' AS "d", '' AS "cat", '' AS "ch", '' AS "sub", '' AS "tier", "dseg" AS "q", COUNT(*) AS "n"
FROM base WHERE ${between(plan.summaries[k])}
GROUP BY "dseg"`)

  const dailyWhere = DAILY_KEYS.map(k => `(${between(plan.dailies[k])})`).join(' OR ')
  const dailyPart = `
SELECT 'day' AS "b", CAST("day" AS string) AS "d", '' AS "cat",
       CASE WHEN "ch" = 'unattributable' THEN 'unattributable' ELSE '' END AS "ch",
       '' AS "sub", '' AS "tier", "q", COUNT(*) AS "n"
FROM base WHERE ${dailyWhere}
GROUP BY "day", CASE WHEN "ch" = 'unattributable' THEN 'unattributable' ELSE '' END, "q"`

  return `WITH ws AS (
  SELECT "WORKSPACE_ID" AS "wid",
         CAST("WORKSPACE_CREATED_AT_UTC" AS date) AS "day",
         COALESCE("BLENDED_ATTRIBUTION_CHANNEL_CATEGORY", 'undefined') AS "cat",
         COALESCE("BLENDED_ATTRIBUTION_CHANNEL", 'undefined') AS "ch",
         CASE WHEN "BLENDED_ATTRIBUTION_CHANNEL" = 'OAuth: MCP' THEN "BLENDED_ATTRIBUTION_SUBCHANNEL" ELSE '' END AS "sub",
         COALESCE("CUSTOMER_DOMAIN_QUALITY_SEGMENT", 'not available') AS "q"
  FROM ${t(SIGMA.workspaces)}
  WHERE ${WS_FILTER}
    AND CAST("WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
), c AS (
  SELECT "WORKSPACE_ID" AS "wid", MIN(LOWER("DOMAIN")) AS "dom", MIN("CUSTOMER_DOMAIN_SEGMENT") AS "seg"
  FROM ${t(SIGMA.customers)}
  GROUP BY "WORKSPACE_ID"
), a AS (
  SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier"
  FROM ${t(SIGMA.accounts)}
  WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL
  GROUP BY LOWER("DOMAIN_C")
), base AS (
  SELECT ws."day", ws."cat", ws."ch", ws."sub", ws."q",
         COALESCE(a."tier", 'Unassigned') AS "tier",
         CASE WHEN c."seg" IN ('personal', 'academic') THEN c."seg"
              WHEN c."seg" IS NULL THEN 'unknown' ELSE 'non_personal' END AS "dseg"
  FROM ws
  LEFT JOIN c ON c."wid" = ws."wid"
  LEFT JOIN a ON a."dom" = c."dom"
)
${[...summaryParts, ...domainParts, dailyPart].join('\nUNION ALL')}`
}

type SigmaTable = { columns: string[]; rows: unknown[][] }

/** Sigma query payload → the same shapes the Supabase RPCs return. */
export function parseDashboardRows(payload: unknown, plan: DashboardPlan) {
  const tbl = payload as SigmaTable
  if (!tbl || !Array.isArray(tbl.columns) || !Array.isArray(tbl.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(tbl.columns.map((c, i) => [c, i]))
  const col = (r: unknown[], c: string) => String(r[ix[c]] ?? '')

  const summaries = Object.fromEntries(SUMMARY_KEYS.map(k => [k, { channels: [], hqTiers: [], mcp: [], quality: [], domain: [] } as RangeSummary])) as Record<SummaryKey, RangeSummary>
  const add = <T extends { n: number }>(arr: T[], match: (x: T) => boolean, mk: () => T, n: number) => {
    const hit = arr.find(match)
    if (hit) hit.n += n
    else { const x = mk(); x.n = n; arr.push(x) }
  }
  const byDay = new Map<ISODate, DailyPoint>()

  for (const r of tbl.rows) {
    const b = col(r, 'b'); const n = Number(r[ix.n] ?? 0)
    if (b === 'day') {
      const day = col(r, 'd').slice(0, 10)
      const p = byDay.get(day) ?? { d: day, n: 0, unattr: 0, hq: 0, lowq: 0 }
      p.n += n
      if (col(r, 'ch') === 'unattributable') p.unattr! += n
      const q = col(r, 'q')
      if (q === 'non-personal: high quality') p.hq! += n
      if (q === 'non-personal: low quality') p.lowq! += n
      byDay.set(day, p)
    } else if (b.startsWith('dom:')) {
      const s = summaries[b.slice(4) as SummaryKey]
      if (s) s.domain.push({ s: col(r, 'q'), n })
    } else {
      const s = summaries[b as SummaryKey]
      if (!s) continue
      const c = col(r, 'cat'); const ch = col(r, 'ch'); const tier = col(r, 'tier'); const q = col(r, 'q'); const sub = col(r, 'sub')
      add(s.channels, x => x.c === c && x.ch === ch && x.t === tier, () => ({ c, ch, t: tier, n: 0 }), n)
      add(s.quality, x => x.q === q, () => ({ q, n: 0 }), n)
      if (q === GOAL_SEGMENT) add(s.hqTiers, x => x.t === tier, () => ({ t: tier, n: 0 }), n)
      if (ch === 'OAuth: MCP') add(s.mcp, x => x.s === (sub || 'OAuth: MCP: undefined'), () => ({ s: sub || 'OAuth: MCP: undefined', n: 0 }), n)
    }
  }
  const days = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d))
  const dailies = Object.fromEntries(DAILY_KEYS.map(k => {
    const [s, e] = plan.dailies[k]
    return [k, days.filter(p => p.d >= s && p.d <= e)]
  })) as Record<DailyKey, DailyPoint[]>
  return { summaries, dailies }
}
