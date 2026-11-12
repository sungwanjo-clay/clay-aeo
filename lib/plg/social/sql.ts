/**
 * One Sigma (Snowflake) query per view state for the Social video tab.
 * Returns labelled aggregate rows (column `k`), never per-person data.
 *
 *   vis/visw  distinct YouTube-referred visitors (any page / offer page) per bucket × source group
 *   vday      distinct visitors per day × group (trend)
 *   camp      distinct visitors per tagged creator campaign (utm_campaign)
 *   form      distinct offer-page form submitters per bucket × group
 *   ws        new workspaces per bucket × source: activated ≤7d, paid, expanded, churned, HQ, tiers
 *   wsday     new workspaces per day (trend)
 *   plan / persona / month   current-period breakdowns
 *   exist     (creator scope) existing workspaces re-engaged by the creator's links
 *   mention   (all scope) workspaces whose survey says YouTube but credited to another channel
 */
import { addDays, type ISODate } from '../dates'
import { ACTIVATION_DAYS, CREATOR_WINDOW_DAYS, VISIT_GROUPS, YOUTUBE_VISIT } from './config'

const T = {
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037',  // DBT.PROD.MARKETING_PAGEVIEWS
  forms: '794d9f65-d34c-4173-94d1-1b0709c1b040',      // SEGMENT.VERCEL.FORM_SUBMITTED
  blended: 'b9625c73-5094-4b94-9c0f-034c5efccbd4',    // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION
  cookies: '22e14a56-e32f-4d31-aff8-b6bc3b23190b',    // DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae',  // DBT.PROD.CUSTOMERS
  credits: '990653ed-fe9f-4d3c-a674-f4278de7049f',    // DBT.PROD.CREDIT_PACK_INVOICES
  survey: '49872add-0b3c-4321-8746-f67ec6cf5510',     // DBT.PROD.ONBOARDING_SURVEY
  accounts: 'e6443e27-6d72-4dd5-b511-94aba9cab915',   // FIVETRAN.SALESFORCE.ACCOUNT
}
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`)
  return `DATE '${x}'`
}

export type SocialScope = 'all' | 'peter'
export interface SocialRanges { cur: [ISODate, ISODate]; prev: [ISODate, ISODate] }

export function socialSql(scope: SocialScope, r: SocialRanges): string {
  const lo = r.cur[0] < r.prev[0] ? r.cur[0] : r.prev[0]
  const hi = r.cur[1] > r.prev[1] ? r.cur[1] : r.prev[1]
  const visitLo = addDays(lo, -CREATOR_WINDOW_DAYS) // creator workspaces can follow a click by up to 30 days
  const bucket = (col: string) =>
    `CASE WHEN ${col} BETWEEN ${d(r.cur[0])} AND ${d(r.cur[1])} THEN 'cur' WHEN ${col} BETWEEN ${d(r.prev[0])} AND ${d(r.prev[1])} THEN 'prev' END`
  const grp = `CASE ${VISIT_GROUPS.map(g => `WHEN ${g.rule} THEN '${g.id}'`).join(' ')} END`

  const workspaces = scope === 'all'
    ? `wsb AS (
  SELECT b."WORKSPACE_ID" AS "wid", CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) AS "day",
         CASE WHEN b."BLENDED_ATTRIBUTION_SUBCHANNEL" = 'Organic: Social: youtube' AND b."BLENDED_ATTRIBUTION_MECHANISM" = 'hdyhau' THEN 'survey'
              WHEN b."BLENDED_ATTRIBUTION_SUBCHANNEL" = 'Organic: Social: youtube' THEN 'organic_session'
              WHEN b."BLENDED_ATTRIBUTION_SUBCHANNEL" ILIKE 'Influencer: Affiliate%' THEN 'affiliate'
              WHEN b."BLENDED_ATTRIBUTION_SUBCHANNEL" ILIKE 'Marketing Content: Owned%' THEN 'owned'
              WHEN b."BLENDED_ATTRIBUTION_SUBCHANNEL" ILIKE 'Paid Ads%' THEN 'paid' ELSE 'other' END AS "src"
  FROM ${t(T.blended)} b
  WHERE b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
    AND CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND b."BLENDED_ATTRIBUTION_SUBCHANNEL" ILIKE '%: youtube'
)`
    : `pa AS (SELECT "aid", MIN("ts") AS "first_ts" FROM pv WHERE "grp" = 'peter' GROUP BY "aid"),
pw AS (
  SELECT r."WORKSPACE_ID" AS "wid", MIN(pa."first_ts") AS "first_ts"
  FROM pa JOIN ${t(T.cookies)} r ON r."ANONYMOUS_ID" = pa."aid"
  GROUP BY r."WORKSPACE_ID"
),
wsb AS (
  SELECT b."WORKSPACE_ID" AS "wid", CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) AS "day", 'peter' AS "src"
  FROM pw JOIN ${t(T.blended)} b ON b."WORKSPACE_ID" = pw."wid"
  WHERE b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
    AND b."WORKSPACE_CREATED_AT_UTC" >= pw."first_ts"
    AND b."WORKSPACE_CREATED_AT_UTC" <= pw."first_ts" + INTERVAL '${CREATOR_WINDOW_DAYS} day'
    AND CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
),
ex AS (
  SELECT b."WORKSPACE_ID" AS "wid", CAST(pw."first_ts" AS date) AS "day"
  FROM pw JOIN ${t(T.blended)} b ON b."WORKSPACE_ID" = pw."wid"
  WHERE b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
    AND b."WORKSPACE_CREATED_AT_UTC" < pw."first_ts"
)`

  const tierExpr = `COALESCE(a."tier", 'Unassigned')`
  const tierCols = (expr = '"tier"') => ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Unassigned']
    .map((tn, i) => `SUM(CASE WHEN ${expr} = '${tn}' THEN 1 ELSE 0 END) AS "t${i + 1}"`).join(', ')
  const zeroTiers = `0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"`
  const zeroMetrics = `0 AS "a", 0 AS "p", 0 AS "x", 0 AS "c", 0 AS "h"`

  return `WITH pv AS (
  SELECT "ANONYMOUS_ID" AS "aid", "TIMESTAMP_UTC" AS "ts", CAST("TIMESTAMP_UTC" AS date) AS "day", "PATH" AS "path", ${grp} AS "grp",
         LOWER(COALESCE("UTM_CAMPAIGN", '')) AS "camp"
  FROM ${t(T.pageviews)}
  WHERE CAST("TIMESTAMP_UTC" AS date) BETWEEN ${d(visitLo)} AND ${d(hi)} AND ${YOUTUBE_VISIT}
),
va AS (SELECT "aid", MAX(CASE WHEN "grp" = 'peter' THEN 1 ELSE 0 END) AS "is_peter" FROM pv GROUP BY "aid"),
fs AS (
  SELECT f."ANONYMOUS_ID" AS "aid", CAST(f."TIMESTAMP" AS date) AS "day", CASE WHEN va."is_peter" = 1 THEN 'peter' ELSE 'other' END AS "grp"
  FROM ${t(T.forms)} f JOIN va ON va."aid" = f."ANONYMOUS_ID"
  WHERE f."CONTEXT_PAGE_PATH" ILIKE '/wedge%' AND CAST(f."TIMESTAMP" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
),
${workspaces},
cu AS (
  SELECT "WORKSPACE_ID" AS "wid", MIN(LOWER("DOMAIN")) AS "dom", MIN("FIRST_INVOICE_UTC") AS "first_inv",
         MAX("LATEST_PLAN_CLEAN") AS "plan", MAX("LATEST_SUBSCRIPTION_CANCELLATION_UTC") AS "cancel",
         MAX("BINARY_CURRENT_CUSTOMER") AS "current",
         MAX(CASE WHEN "LATEST_INFLECTION_PREVIOUS_PLAN" IS NOT NULL AND "LATEST_INFLECTION_PREVIOUS_PLAN" <> 'Free/Trial' THEN 1 ELSE 0 END) AS "upgraded"
  FROM ${t(T.customers)} GROUP BY "WORKSPACE_ID"
),
cp AS (SELECT "WORKSPACE_ID" AS "wid", MIN("CREATED_AT_UTC") AS "first_pack" FROM ${t(T.credits)} WHERE "AMOUNT_PAID" > 0 GROUP BY "WORKSPACE_ID"),
sv AS (SELECT "WORKSPACE_ID" AS "wid", MAX("TEAMS") AS "teams" FROM ${t(T.survey)} WHERE "SURVEY_RANKER" = 1 GROUP BY "WORKSPACE_ID"),
a AS (
  SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier" FROM ${t(T.accounts)}
  WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL GROUP BY LOWER("DOMAIN_C")
),
x AS (
  SELECT w."wid", w."day", w."src", ${bucket('w."day"')} AS "b",
         CASE WHEN b."BINARY_ACTIVATED_WORKSPACE" = 1 AND b."DAYS_TO_ACTIVATION" <= ${ACTIVATION_DAYS} THEN 1 ELSE 0 END AS "act",
         CASE WHEN cu."first_inv" IS NOT NULL THEN 1 ELSE 0 END AS "paid",
         CASE WHEN cu."first_inv" IS NOT NULL AND (cu."upgraded" = 1 OR cp."first_pack" > cu."first_inv") THEN 1 ELSE 0 END AS "exp",
         CASE WHEN cu."first_inv" IS NOT NULL AND cu."cancel" IS NOT NULL AND COALESCE(cu."current", 0) = 0 THEN 1 ELSE 0 END AS "churn",
         CASE WHEN b."CUSTOMER_DOMAIN_QUALITY_SEGMENT" = 'non-personal: high quality' THEN 1 ELSE 0 END AS "hq",
         ${tierExpr} AS "tier", COALESCE(cu."plan", 'Free') AS "plan", COALESCE(sv."teams", 'Not answered') AS "teams",
         SUBSTR(CAST(w."day" AS string), 1, 7) AS "month"
  FROM wsb w
  JOIN ${t(T.blended)} b ON b."WORKSPACE_ID" = w."wid" AND b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
  LEFT JOIN cu ON cu."wid" = w."wid"
  LEFT JOIN cp ON cp."wid" = w."wid"
  LEFT JOIN sv ON sv."wid" = w."wid"
  LEFT JOIN a ON a."dom" = cu."dom"
)
SELECT 'vis' AS "k", ${bucket('"day"')} AS "b", '' AS "d", "grp" AS "g", COUNT(DISTINCT "aid") AS "n", ${zeroMetrics}, ${zeroTiers}
FROM pv WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "grp"
UNION ALL
SELECT 'visw', ${bucket('"day"')}, '', "grp", COUNT(DISTINCT "aid"), ${zeroMetrics}, ${zeroTiers}
FROM pv WHERE "path" = '/wedge' AND ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "grp"
UNION ALL
SELECT 'vday', '', CAST("day" AS string), "grp", COUNT(DISTINCT "aid"), ${zeroMetrics}, ${zeroTiers}
FROM pv WHERE ${bucket('"day"')} IS NOT NULL GROUP BY "day", "grp"
UNION ALL
SELECT 'camp', ${bucket('"day"')}, '', "camp", COUNT(DISTINCT "aid"), ${zeroMetrics}, ${zeroTiers}
FROM pv WHERE "grp" = 'peter' AND "camp" <> '' AND ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "camp"
UNION ALL
SELECT 'form', ${bucket('"day"')}, '', "grp", COUNT(DISTINCT "aid"), ${zeroMetrics}, ${zeroTiers}
FROM fs WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "grp"
UNION ALL
SELECT 'ws', "b", '', "src", COUNT(*), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), SUM("hq"), ${tierCols()}
FROM x WHERE "b" IS NOT NULL GROUP BY "b", "src"
UNION ALL
SELECT 'wsday', '', CAST("day" AS string), '', COUNT(*), ${zeroMetrics}, ${zeroTiers}
FROM x WHERE "b" IS NOT NULL GROUP BY "day"
UNION ALL
SELECT 'plan', 'cur', '', "plan", COUNT(*), 0, SUM("paid"), SUM("exp"), SUM("churn"), 0, ${zeroTiers}
FROM x WHERE "b" = 'cur' GROUP BY "plan"
UNION ALL
SELECT 'persona', 'cur', '', "teams", COUNT(*), ${zeroMetrics}, ${zeroTiers}
FROM x WHERE "b" = 'cur' GROUP BY "teams"
UNION ALL
SELECT 'month', 'cur', '', "month", COUNT(*), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), SUM("hq"), ${zeroTiers}
FROM x WHERE "b" = 'cur' GROUP BY "month"
${scope === 'peter' ? `UNION ALL
SELECT 'exist', ${bucket('ex."day"')}, '', '', COUNT(DISTINCT ex."wid"), ${zeroMetrics}, ${tierCols(tierExpr)}
FROM ex
LEFT JOIN cu ON cu."wid" = ex."wid"
LEFT JOIN a ON a."dom" = cu."dom"
WHERE ${bucket('ex."day"')} IS NOT NULL GROUP BY ${bucket('ex."day"')}` : `UNION ALL
SELECT 'mention', ${bucket('CAST(m."WORKSPACE_CREATED_AT_UTC" AS date)')}, '', '', COUNT(*), ${zeroMetrics}, ${zeroTiers}
FROM ${t(T.blended)} m
WHERE m."ATTRIBUTION_WINDOW" = '90_days' AND m."ATTRIBUTION_TYPE" = 'first_touch' AND m."HDYHAU_SUB_CHANNEL" = 'youtube'
  AND m."BLENDED_ATTRIBUTION_SUBCHANNEL" NOT ILIKE '%: youtube'
  AND ${bucket('CAST(m."WORKSPACE_CREATED_AT_UTC" AS date)')} IS NOT NULL
GROUP BY ${bucket('CAST(m."WORKSPACE_CREATED_AT_UTC" AS date)')}`}`
}
