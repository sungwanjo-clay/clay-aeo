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
import { tierEligible } from './tier'
import type { DailyPoint, RangeSummary } from './compute'
import type { ISODate } from './dates'
import { GOAL_SEGMENT } from './config'
import { DAILY_KEYS, SUMMARY_KEYS, type DashboardPlan, type DailyKey, type SummaryKey } from './plan'
import { rangeTable } from './offline'

export const SIGMA = {
  server: 'Clay Sigma',
  connectionId: '2d269863-3d4a-459d-9245-daff9e223f17',
  workspaces: 'b9625c73-5094-4b94-9c0f-034c5efccbd4', // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae',  // DBT.PROD.CUSTOMERS
  accounts: 'e6443e27-6d72-4dd5-b511-94aba9cab915',   // FIVETRAN.SALESFORCE.ACCOUNT
  metrics: 'fc12f388-0a8f-4213-9af1-e4575ddf79e6',    // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION_METRICS
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037',  // DBT.PROD.MARKETING_PAGEVIEWS
} as const

/**
 * MBR "PLG Headline Metrics" definitions (checked against Jul 2026: 292,509 vs 291,177 visitors,
 * 1,741 vs 1,737 paid, 16,551 vs 16,604 HQ trial users):
 *   Total unique visitors (ex. UTC & Asia) = distinct ANONYMOUS_ID on the marketing site + signup pages,
 *     browser timezone not UTC and not Asia/*
 *   High quality trial users = new workspaces with CUSTOMER_DOMAIN_QUALITY_SEGMENT 'non-personal: high quality'
 *   All new paid workspaces = CUSTOMERS.FIRST_INVOICE_UTC in the period, FIRST_GTM_MOTION = 'PLG'
 *   Visitor → HQ trial = HQ trial users ÷ visitors; Trial → paid = new paid ÷ HQ trial users (same period)
 *   Activation (not in the MBR) = workspaces created 7+ days before the data end that built a golden table (1 basic +
 *     2 advanced successful enrichments in one table) within 7 days ÷ those workspaces (the governed matured rate)
 */
const MBR_SITES = `'marketing_website', 'signup'`

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

/**
 * `saved`: saved-copy mode (lib/plg/offline.ts). The plans of every preset × comparison; summary rows are computed
 * once per distinct range (bucket "<start>~<end>", "dom:<label>", "x:<label>:<metric>") through a joined range table,
 * and the daily series covers every plan's days. The QTD tier rows (sot) don't depend on the preset.
 */
export function dashboardSql(plan: DashboardPlan, saved?: DashboardPlan[]): string {
  const plans = saved?.length ? saved : [plan]
  const ranges = plans.flatMap(pl => [...SUMMARY_KEYS.map(k => pl.summaries[k]), ...DAILY_KEYS.map(k => pl.dailies[k])])
  const lo = ranges.map(r => r[0]).sort()[0]
  const hi = ranges.map(r => r[1]).sort().at(-1)!
  const between = (r: [ISODate, ISODate]) => `"day" BETWEEN ${d(r[0])} AND ${d(r[1])}`
  // Activation counts only workspaces old enough to have had their full window (the governed "matured" rate).
  const matured = maturedSql(plan.dataEnd)
  if (saved?.length) return savedDashboardSql(plan, plans, lo, hi)

  const summaryParts = SUMMARY_KEYS.map(k => `
SELECT '${k}' AS "b", '' AS "d", "cat", "ch", "sub", "tier", "q", COUNT(*) AS "n"
FROM base WHERE ${between(plan.summaries[k])}
GROUP BY "cat", "ch", "sub", "tier", "q"`)

  const domainParts = (['cur', 'prev'] as const).map(k => `
SELECT 'dom:${k}' AS "b", '' AS "d", '' AS "cat", '' AS "ch", '' AS "sub", '' AS "tier", "dseg" AS "q", COUNT(*) AS "n"
FROM base WHERE ${between(plan.summaries[k])}
GROUP BY "dseg"`)

  const extraParts = (['cur', 'prev'] as const).flatMap(k => [`
SELECT 'x:${k}:activated' AS "b", '' AS "d", '' AS "cat", '' AS "ch", '' AS "sub", '' AS "tier", '' AS "q", SUM(CASE WHEN ${matured} THEN "act" ELSE 0 END) AS "n"
FROM base WHERE ${between(plan.summaries[k])}`, `
SELECT 'x:${k}:matured', '', '', '', '', '', '', SUM(CASE WHEN ${matured} THEN 1 ELSE 0 END)
FROM base WHERE ${between(plan.summaries[k])}`, `
SELECT 'm:${k}', "msrc", '', '', '', '', '', COUNT(*)
FROM base WHERE ${between(plan.summaries[k])} AND "mcp" = 1 GROUP BY "msrc"`, `
SELECT 'x:${k}:visitors', '', '', '', '', '', '', COUNT(DISTINCT "ANONYMOUS_ID")
FROM ${t(SIGMA.pageviews)}
WHERE "SITE" IN (${MBR_SITES}) AND CAST("TIMESTAMP_UTC" AS date) BETWEEN ${d(plan.summaries[k][0])} AND ${d(plan.summaries[k][1])}
  AND COALESCE("TIMEZONE", '') NOT LIKE 'Asia/%' AND COALESCE("TIMEZONE", '') NOT IN ('UTC', 'Etc/UTC')`, `
SELECT 'x:${k}:paid', '', '', '', '', '', '', COUNT(DISTINCT "WORKSPACE_ID")
FROM ${t(SIGMA.customers)}
WHERE "FIRST_GTM_MOTION" = 'PLG' AND CAST("FIRST_INVOICE_UTC" AS date) BETWEEN ${d(plan.summaries[k][0])} AND ${d(plan.summaries[k][1])}`])

  /*
   * Source-of-truth Tier 1–3 (Marketing Q4 Metrics tile, Monty): WORKSPACES created in the window from
   * dbt.prod.customers whose Stripe email domain matches a live Salesforce account (is_deleted = false),
   * current sales_tier_c Tier 1–3, best tier per domain, free-mail (personal) domains excluded. No HQ filter.
   * Quarter to date through dataEnd, plus the same through dataEnd − 7 for the week-over-week add.
   */
  const sotParts = sotPartsFor(plan)

  const dailyWhere = DAILY_KEYS.map(k => `(${between(plan.dailies[k])})`).join(' OR ')
  const dailyPart = `
SELECT 'day' AS "b", CAST("day" AS string) AS "d", '' AS "cat",
       CASE WHEN "ch" = 'unattributable' THEN 'unattributable' ELSE '' END AS "ch",
       '' AS "sub", '' AS "tier", "q", COUNT(*) AS "n"
FROM base WHERE ${dailyWhere}
GROUP BY "day", CASE WHEN "ch" = 'unattributable' THEN 'unattributable' ELSE '' END, "q"`

  return `${dashboardCtes(lo, hi)}
${[...summaryParts, ...domainParts, ...extraParts, ...sotParts, dailyPart].join('\nUNION ALL')}`
}

export function dashboardCtes(lo: ISODate, hi: ISODate, extra = ''): string {
  return `WITH ws AS (
  SELECT "WORKSPACE_ID" AS "wid",
         CAST("WORKSPACE_CREATED_AT_UTC" AS date) AS "day",
         COALESCE("BLENDED_ATTRIBUTION_CHANNEL_CATEGORY", 'undefined') AS "cat",
         COALESCE("BLENDED_ATTRIBUTION_CHANNEL", 'undefined') AS "ch",
         CASE WHEN "BLENDED_ATTRIBUTION_CHANNEL" = 'OAuth: MCP' THEN "BLENDED_ATTRIBUTION_SUBCHANNEL" ELSE '' END AS "sub",
         COALESCE("CUSTOMER_DOMAIN_QUALITY_SEGMENT", 'not available') AS "q",
         CASE WHEN "BINARY_ACTIVATED_WORKSPACE" = 1 AND "DAYS_TO_ACTIVATION" <= 7 THEN 1 ELSE 0 END AS "act"
  FROM ${t(SIGMA.workspaces)}
  WHERE ${WS_FILTER}
    AND CAST("WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
), c AS (
  SELECT "WORKSPACE_ID" AS "wid", MIN(LOWER("DOMAIN")) AS "dom", MIN("CUSTOMER_DOMAIN_SEGMENT") AS "seg",
         CAST(MIN("CREATED_AT_UTC") AS date) AS "created",
         MAX(COALESCE("BINARY_SOURCED_BY_MCP", 0)) AS "mcp", COALESCE(MIN(NULLIF("MCP_SOURCE", '')), 'unknown') AS "msrc"
  FROM ${t(SIGMA.customers)}
  GROUP BY "WORKSPACE_ID"
), a AS (
  SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier"
  FROM ${t(SIGMA.accounts)}
  WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL
  GROUP BY LOWER("DOMAIN_C")
), base AS (
  SELECT ws."day", ws."cat", ws."ch", ws."sub", ws."q", ws."act", COALESCE(c."mcp", 0) AS "mcp", c."msrc",
         CASE WHEN ${tierEligible('c."seg"')} THEN COALESCE(a."tier", 'Unassigned') ELSE 'Unassigned' END AS "tier",
         CASE WHEN c."seg" IN ('personal', 'academic') THEN c."seg"
              WHEN c."seg" IS NULL THEN 'unknown' ELSE 'non_personal' END AS "dseg"
  FROM ws
  LEFT JOIN c ON c."wid" = ws."wid"
  LEFT JOIN a ON a."dom" = c."dom"
)${extra}`
}

/** Source-of-truth Tier 1–3 rows for the plan's quarter to date (see dashboardSql). */
function sotPartsFor(plan: DashboardPlan): string[] {
  const [qs, qe] = plan.summaries.qtd
  const weekAgo = [qe].map(x => { const dt = new Date(`${x}T00:00:00Z`); dt.setUTCDate(dt.getUTCDate() - 7); return dt.toISOString().slice(0, 10) })[0]
  return ([['now', qe], ['wk', weekAgo]] as const).map(([k, end]) => `
SELECT 'sot:${k}' AS "b", '' AS "d", '' AS "cat", '' AS "ch", '' AS "sub", a."tier", '' AS "q", COUNT(*) AS "n"
FROM c JOIN a ON a."dom" = c."dom"
WHERE c."created" BETWEEN ${d(qs)} AND ${d(end)} AND COALESCE(c."seg", '') <> 'personal' AND a."tier" IN ('Tier 1', 'Tier 2', 'Tier 3')
GROUP BY a."tier"`).concat(`
SELECT 'sot:day' AS "b", CAST(c."created" AS string) AS "d", '' AS "cat", '' AS "ch", '' AS "sub", '' AS "tier", '' AS "q", COUNT(*) AS "n"
FROM c JOIN a ON a."dom" = c."dom"
WHERE c."created" BETWEEN ${d(qs)} AND ${d(qe)} AND COALESCE(c."seg", '') <> 'personal' AND a."tier" IN ('Tier 1', 'Tier 2', 'Tier 3')
GROUP BY c."created"`)

}

/** A workspace has had its full activation window when it was created at least that many days before the data end. */
const maturedSql = (dataEnd: ISODate) => `"day" <= DATE_ADD('day', -${ACTIVATION_WINDOW_DAYS}, ${d(dataEnd)})`
export const ACTIVATION_WINDOW_DAYS = 7

/** Saved-copy variant of dashboardSql (see its `saved` parameter). */
function savedDashboardSql(plan: DashboardPlan, plans: DashboardPlan[], lo: ISODate, hi: ISODate): string {
  const sum = plans.flatMap(pl => SUMMARY_KEYS.map(k => pl.summaries[k]))
  const extra = `,
rng AS (${rangeTable(sum)}),
br AS (SELECT base.*, rng."lbl" FROM base JOIN rng ON base."day" BETWEEN rng."rs" AND rng."re"),
pvd AS (
  SELECT DISTINCT CAST("TIMESTAMP_UTC" AS date) AS "day", "ANONYMOUS_ID" AS "aid" FROM ${t(SIGMA.pageviews)}
  WHERE "SITE" IN (${MBR_SITES}) AND CAST("TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND COALESCE("TIMEZONE", '') NOT LIKE 'Asia/%' AND COALESCE("TIMEZONE", '') NOT IN ('UTC', 'Etc/UTC')
),
pdw AS (
  SELECT DISTINCT CAST("FIRST_INVOICE_UTC" AS date) AS "day", "WORKSPACE_ID" AS "wid" FROM ${t(SIGMA.customers)}
  WHERE "FIRST_GTM_MOTION" = 'PLG' AND CAST("FIRST_INVOICE_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
)`
  const parts = [`
SELECT "lbl" AS "b", '' AS "d", "cat", "ch", "sub", "tier", "q", COUNT(*) AS "n" FROM br GROUP BY "lbl", "cat", "ch", "sub", "tier", "q"`, `
SELECT 'dom:' || "lbl", '', '', '', '', '', "dseg", COUNT(*) FROM br GROUP BY "lbl", "dseg"`, `
SELECT 'x:' || "lbl" || ':activated', '', '', '', '', '', '', SUM(CASE WHEN ${maturedSql(plan.dataEnd)} THEN "act" ELSE 0 END) FROM br GROUP BY "lbl"`, `
SELECT 'x:' || "lbl" || ':matured', '', '', '', '', '', '', SUM(CASE WHEN ${maturedSql(plan.dataEnd)} THEN 1 ELSE 0 END) FROM br GROUP BY "lbl"`, `
SELECT 'm:' || "lbl", "msrc", '', '', '', '', '', COUNT(*) FROM br WHERE "mcp" = 1 GROUP BY "lbl", "msrc"`, `
SELECT 'x:' || rng."lbl" || ':visitors', '', '', '', '', '', '', COUNT(DISTINCT pvd."aid") FROM pvd JOIN rng ON pvd."day" BETWEEN rng."rs" AND rng."re" GROUP BY rng."lbl"`, `
SELECT 'x:' || rng."lbl" || ':paid', '', '', '', '', '', '', COUNT(DISTINCT pdw."wid") FROM pdw JOIN rng ON pdw."day" BETWEEN rng."rs" AND rng."re" GROUP BY rng."lbl"`,
    ...sotPartsFor(plan), `
SELECT 'day' AS "b", CAST("day" AS string) AS "d", '' AS "cat",
       CASE WHEN "ch" = 'unattributable' THEN 'unattributable' ELSE '' END AS "ch",
       '' AS "sub", '' AS "tier", "q", COUNT(*) AS "n"
FROM base
GROUP BY "day", CASE WHEN "ch" = 'unattributable' THEN 'unattributable' ELSE '' END, "q"`]
  return `${dashboardCtes(lo, hi, extra)}
${parts.join('\nUNION ALL')}`
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
  const mcpFlag = new Set<RangeSummary>(), subMcp = new Map<RangeSummary, RangeSummary['mcp']>()

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
    } else if (b.startsWith('sot:')) {
      const s = summaries.qtd
      s.sot ??= { now: [0, 0, 0], weekAgo: [0, 0, 0], daily: [] }
      if (b === 'sot:day') { s.sot.daily.push({ d: col(r, 'd').slice(0, 10), n }); continue }
      const i = ['Tier 1', 'Tier 2', 'Tier 3'].indexOf(col(r, 'tier'))
      if (i >= 0) (b === 'sot:now' ? s.sot.now : s.sot.weekAgo)[i] = n
    } else if (b.startsWith('x:')) {
      const [, key, metric] = b.split(':')
      const s = summaries[key as SummaryKey]
      if (s) { s.extras ??= { visitors: 0, paid: 0, activated: 0 }; s.extras[metric as 'visitors' | 'paid' | 'activated' | 'matured'] = n }
    } else if (b.startsWith('m:')) {
      // MCP-sourced workspaces (CUSTOMERS.BINARY_SOURCED_BY_MCP) by MCP_SOURCE: the governed MCP metric.
      const s = summaries[b.slice(2) as SummaryKey]
      if (s) { mcpFlag.add(s); add(s.mcp, x => x.s === col(r, 'd'), () => ({ s: col(r, 'd'), n: 0 }), n) }
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
      // Older saved copies have no MCP flag rows: fall back to the OAuth: MCP sub-channels.
      if (ch === 'OAuth: MCP') add(subMcp.get(s) ?? (subMcp.set(s, []), subMcp.get(s)!), x => x.s === (sub || 'OAuth: MCP: undefined'), () => ({ s: sub || 'OAuth: MCP: undefined', n: 0 }), n)
    }
  }
  for (const [s, rows] of subMcp) if (!mcpFlag.has(s)) s.mcp = rows
  const days = [...byDay.values()].sort((a, b) => a.d.localeCompare(b.d))
  const dailies = Object.fromEntries(DAILY_KEYS.map(k => {
    const [s, e] = plan.dailies[k]
    return [k, days.filter(p => p.d >= s && p.d <= e)]
  })) as Record<DailyKey, DailyPoint[]>
  return { summaries, dailies }
}
