/**
 * Tier 4 tab: SLG hand-raisers at Tier 4 accounts. Tier 4 never counts as an MQAL, so these people don't get an SDR
 * demo. Read-only Sigma (Snowflake) queries; company-level rows only, never contacts.
 *
 * Cohort: Salesforce accounts with an SLG touchpoint (DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL) while the account was
 * Tier 4 (ACCOUNT_SALES_TIER: point-in-time tier, snapshots from Feb 2026). Aggregator accounts (gmail.com and
 * the like) are left out. Outcomes are as of today, so older cohorts have had longer to move.
 *   Workspace  a work-domain workspace on the account's domain (CUSTOMERS.DOMAIN, segment 'other')
 *   New ws     one created on or after the account's first Tier 4 touchpoint in the period
 *   Activated  a workspace on the domain has FIRST_ACTIVATION_UTC
 *   Paying     a workspace on the domain has invoiced and is a current customer
 *   Re-tiered  the account is Tier 1–3 in Salesforce today
 *   S2         a new-business opp on the account entered S2 on or after that first touchpoint
 *              (INT_OPPORTUNITY_SOURCE_TOUCHPOINT_MAP, all new-business opps, sourced or not)
 *
 * tier4Sql rows: k, b (range label or month), d, n, a, p, x, c, y, z
 *   tp  touchpoints in the period by type (d): n touchpoints, a accounts
 *   mv  the period's cohort: n accounts, a workspace, p new ws, x activated, c paying, y re-tiered, z S2
 *   mo  monthly cohorts by first Tier 4 touchpoint since Apr 2026 (b = 'mo', d = YYYY-MM): same columns as mv
 * tier4ListSql: one row per account still Tier 4 with a touchpoint in the last 180 days, top 400 by score.
 */
import { addDays, type ISODate } from '../dates'
import { rangeTable } from '../offline'
import { SLG_TABLES } from './sql'

const TB = {
  touchpoints: SLG_TABLES.touchpoints,
  opps: '9a9c17db-c29f-4516-888d-02b939ae202c',      // DBT.PROD.INT_OPPORTUNITY_SOURCE_TOUCHPOINT_MAP
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
}
export const TIER4_TABLES = TB
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`); return `DATE '${x}'` }

export const TIER4 = {
  /** Point-in-time tiers are reliable from here (snapshots start ~Feb 2026; Feb–Mar cohorts show almost no re-tiering because they fall back to today's tier). */
  cohortStart: '2026-04-01' as ISODate,
  listDays: 180,
  listLimit: 400,
  internalDomains: ['clay.com', 'clay.run', 'clayhq.com'],
}

const cu = `cu AS (
  SELECT LOWER("DOMAIN") AS "cdom", COUNT(DISTINCT "WORKSPACE_ID") AS "nws", MIN("CREATED_AT_UTC") AS "ws0", MAX("CREATED_AT_UTC") AS "ws1",
         MAX(CASE WHEN "FIRST_ACTIVATION_UTC" IS NOT NULL THEN 1 ELSE 0 END) AS "act",
         MAX(CASE WHEN "FIRST_INVOICE_UTC" IS NOT NULL AND COALESCE("BINARY_CURRENT_CUSTOMER", 0) = 1 THEN 1 ELSE 0 END) AS "paying",
         SUM(CASE WHEN COALESCE("BINARY_CURRENT_CUSTOMER", 0) = 1 THEN COALESCE("ARR", 0) ELSE 0 END) AS "arr",
         MAX("LATEST_PLAN_CLEAN") AS "plan", SUM(COALESCE("N_CREDITS_SPENT_28D", 0)) AS "cred28", MAX(COALESCE("N_DAYS_ACTIVE_28D", 0)) AS "days28",
         MAX(COALESCE("PQL_PRED_PROB_14D", 0)) AS "pql", SUM(COALESCE("N_BILLING_MODAL_OPENS_28D", 0)) AS "modal28"
  FROM ${t(TB.customers)}
  WHERE "CUSTOMER_DOMAIN_SEGMENT" = 'other' AND "DOMAIN" LIKE '%.%' AND LOWER("DOMAIN") NOT IN (${TIER4.internalDomains.map(x => `'${x}'`).join(', ')})
  GROUP BY LOWER("DOMAIN")
)`

const tpBase = (from: ISODate) => `SELECT tp."ACCOUNT_ID" AS "aid", LOWER(tp."ACCOUNT_DOMAIN") AS "dom", CAST(tp."TOUCHPOINT_TIMESTAMP_UTC" AS date) AS "day",
         tp."TOUCHPOINT_TYPE_REPORTING" AS "tt", tp."ACCOUNT_SALES_TIER_CURRENT" AS "tnow"
  FROM ${t(TB.touchpoints)} tp
  WHERE tp."ACCOUNT_SALES_TIER" = 'Tier 4' AND tp."ACCOUNT_ID" IS NOT NULL AND COALESCE(tp."ACCOUNT_IS_AGGREGATOR", false) = false
    AND CAST(tp."TOUCHPOINT_TIMESTAMP_UTC" AS date) >= ${d(from)}`

const outcomes = (src: string) => `SELECT ${src}."b", ${src}."d", COUNT(*) AS "n",
         SUM(CASE WHEN cu."cdom" IS NOT NULL THEN 1 ELSE 0 END) AS "a",
         SUM(CASE WHEN CAST(cu."ws1" AS date) >= ${src}."d0" THEN 1 ELSE 0 END) AS "p",
         SUM(COALESCE(cu."act", 0)) AS "x", SUM(COALESCE(cu."paying", 0)) AS "c",
         SUM(CASE WHEN ${src}."tnow" IN ('Tier 1', 'Tier 2', 'Tier 3') THEN 1 ELSE 0 END) AS "y",
         SUM(CASE WHEN op."s2last" >= ${src}."d0" THEN 1 ELSE 0 END) AS "z"
  FROM ${src} LEFT JOIN cu ON cu."cdom" = ${src}."dom" LEFT JOIN op ON op."oaid" = ${src}."aid"
  GROUP BY ${src}."b", ${src}."d"`

export function tier4Sql(ranges: readonly (readonly [ISODate, ISODate])[]): string {
  const lo = [...ranges.map(r => r[0]), TIER4.cohortStart].sort()[0]
  return `WITH rng AS (${rangeTable(ranges)}),
tp AS (${tpBase(lo)}),
${cu},
op AS (SELECT "ACCOUNT_ID" AS "oaid", CAST(MAX("OPP_STAGE_TWO_ENTER_TIMESTAMP") AS date) AS "s2last" FROM ${t(TB.opps)}
       WHERE "IS_NEW_BUSINESS_OPPORTUNITY" = 'yes' AND "IS_S2_OPP" = 1 GROUP BY "ACCOUNT_ID"),
coh AS (SELECT rng."lbl" AS "b", '' AS "d", tp."aid", MIN(tp."dom") AS "dom", MIN(tp."day") AS "d0", MAX(tp."tnow") AS "tnow"
        FROM tp JOIN rng ON tp."day" BETWEEN rng."rs" AND rng."re" GROUP BY rng."lbl", tp."aid"),
fst AS (SELECT tp."aid", MIN(tp."dom") AS "dom", MIN(tp."day") AS "d0", MAX(tp."tnow") AS "tnow" FROM tp WHERE tp."day" >= ${d(TIER4.cohortStart)} GROUP BY tp."aid"),
mo AS (SELECT 'mo' AS "b", SUBSTR(CAST("d0" AS string), 1, 7) AS "d", "aid", "dom", "d0", "tnow" FROM fst)
SELECT 'tp' AS "k", rng."lbl" AS "b", COALESCE(tp."tt", 'Other') AS "d", COUNT(*) AS "n", COUNT(DISTINCT tp."aid") AS "a", 0 AS "p", 0 AS "x", 0 AS "c", 0 AS "y", 0 AS "z"
FROM tp JOIN rng ON tp."day" BETWEEN rng."rs" AND rng."re" GROUP BY rng."lbl", COALESCE(tp."tt", 'Other')
UNION ALL
SELECT 'mv', o.* FROM (${outcomes('coh')}) o
UNION ALL
SELECT 'mo', o.* FROM (${outcomes('mo')}) o`
}

/**
 * Score (0–100), shown with its parts on the page:
 *   Size     employees ≥200: 30 · 50–199: 22 · 20–49: 14 · 10–19: 8 · else 3
 *   Intent   demo or contact-sales form in the window: 20; 3+ touchpoints: 10, 2: 5
 *   Product  activated workspace: 15; active 5+ of the last 28 days: 10; paying: 10
 */
export function tier4ListSql(dataEnd: ISODate): string {
  const from = addDays(dataEnd, -TIER4.listDays)
  return `WITH tp AS (
  SELECT tp."ACCOUNT_ID" AS "aid", tp."ACCOUNT_NAME" AS "name", LOWER(tp."ACCOUNT_DOMAIN") AS "dom", tp."ACCOUNT_EMPLOYEE_SIZE" AS "emp",
         tp."ACCOUNT_INDUSTRY" AS "ind", tp."ACCOUNT_REGION" AS "reg", tp."ACCOUNT_SALES_TIER_CURRENT" AS "tnow",
         CAST(tp."TOUCHPOINT_TIMESTAMP_UTC" AS date) AS "day", tp."TOUCHPOINT_TYPE_REPORTING" AS "tt", tp."TOUCHPOINT_TYPE" AS "ty",
         ROW_NUMBER() OVER (PARTITION BY tp."ACCOUNT_ID" ORDER BY tp."TOUCHPOINT_TIMESTAMP_UTC" DESC) AS "rn"
  FROM ${t(TB.touchpoints)} tp
  WHERE tp."ACCOUNT_SALES_TIER" = 'Tier 4' AND tp."ACCOUNT_ID" IS NOT NULL AND COALESCE(tp."ACCOUNT_IS_AGGREGATOR", false) = false
    AND CAST(tp."TOUCHPOINT_TIMESTAMP_UTC" AS date) BETWEEN ${d(from)} AND ${d(dataEnd)}
),
ac AS (
  SELECT "aid", MAX(CASE WHEN "rn" = 1 THEN "name" END) AS "name", MAX(CASE WHEN "rn" = 1 THEN "dom" END) AS "dom", MAX("emp") AS "emp",
         MAX(CASE WHEN "rn" = 1 THEN "ind" END) AS "ind", MAX(CASE WHEN "rn" = 1 THEN "reg" END) AS "reg", MAX(CASE WHEN "rn" = 1 THEN "tnow" END) AS "tnow",
         COUNT(*) AS "ntp", MAX("day") AS "last", MAX(CASE WHEN "rn" = 1 THEN "tt" END) AS "lastType",
         MAX(CASE WHEN "ty" IN ('Demo Form Fill', 'Contact Us Form Fill', 'Paid Ads Demo Form Fill') THEN 1 ELSE 0 END) AS "demo"
  FROM tp GROUP BY "aid"
),
${cu},
sc AS (
  SELECT ac.*, COALESCE(cu."nws", 0) AS "nws", CAST(cu."ws1" AS date) AS "wsLast", COALESCE(cu."act", 0) AS "act", COALESCE(cu."paying", 0) AS "paying",
         COALESCE(cu."arr", 0) AS "arr", cu."plan", COALESCE(cu."cred28", 0) AS "cred28", COALESCE(cu."days28", 0) AS "days28",
         COALESCE(cu."pql", 0) AS "pql", COALESCE(cu."modal28", 0) AS "modal28",
         CASE WHEN COALESCE(ac."emp", 0) >= 200 THEN 30 WHEN ac."emp" >= 50 THEN 22 WHEN ac."emp" >= 20 THEN 14 WHEN ac."emp" >= 10 THEN 8 ELSE 3 END AS "sSize",
         ac."demo" * 20 + CASE WHEN ac."ntp" >= 3 THEN 10 WHEN ac."ntp" = 2 THEN 5 ELSE 0 END AS "sIntent",
         COALESCE(cu."act", 0) * 15 + CASE WHEN COALESCE(cu."days28", 0) >= 5 THEN 10 ELSE 0 END + COALESCE(cu."paying", 0) * 10 AS "sProduct"
  FROM ac LEFT JOIN cu ON cu."cdom" = ac."dom"
  WHERE ac."tnow" = 'Tier 4'
)
SELECT "aid", "name", "dom", "emp", "ind", "reg", "ntp", CAST("last" AS string) AS "last", "lastType", "demo", "nws", CAST("wsLast" AS string) AS "wsLast",
       "act", "paying", "arr", "plan", "cred28", "days28", "pql", "modal28", "sSize", "sIntent", "sProduct", "sSize" + "sIntent" + "sProduct" AS "score"
FROM sc ORDER BY "score" DESC, "emp" DESC NULLS LAST, "last" DESC LIMIT ${TIER4.listLimit}`
}
