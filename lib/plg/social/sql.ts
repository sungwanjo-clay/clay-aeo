/**
 * One Sigma (Snowflake, read-only) query per view state for the Social tab.
 * Returns labelled aggregate rows; never per-person data.
 *
 * Row kinds (column k), keyed by `key` = video id | 'untagged' | 'unmapped:<campaign>' | 'affiliate':
 *   vis    distinct visitors (ANONYMOUS_ID)        b = cur | prev (calendar) | coh (video's first 28 days)
 *   ws     new workspaces (first touch) + activated ≤7d, paid, expanded, churned, tier split
 *   plan   new workspaces by current plan (column d), with paid / expanded / churned
 *   ex     existing workspaces influenced (tagged visitor's user already in a workspace before the visit), tier split
 *   vday / wsday   per-day series for the trend (calendar), key = 'tagged' | 'untagged'
 *
 * Rules
 *   tagged     utm_source ILIKE youtube AND utm_campaign maps to a video (lookup built from descriptions)
 *   unmapped   utm_campaign ILIKE '<prefix>%' but in no current description: flagged, never assigned to a video
 *   untagged   YouTube referrer or utm_source, no utm_campaign, not an affiliate (Rewardful ?via=) referral
 *   tier       CUSTOMERS.DOMAIN → STG_SALESFORCE__ACCOUNT.SALES_TIER_C (best tier per domain), business
 *              domains only (CUSTOMER_DOMAIN_SEGMENT = 'other'); personal, academic or no SFDC account → Untiered
 */
import { addDays, type ISODate } from '../dates'
import { ACTIVATION_DAYS, CHANNELS } from './config'

const T = {
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037', // DBT.PROD.MARKETING_PAGEVIEWS
  firstTouch: '8d715619-0478-4abf-ba37-20a7a7045aa9', // DBT.PROD.FIRST_TOUCH_ATTRIBUTION
  blended: 'b9625c73-5094-4b94-9c0f-034c5efccbd4',   // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION (activation, paid)
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
  accounts: 'c5f1715b-69c1-4033-ad5c-8281a21d2cd5',  // DBT.STAGING.STG_SALESFORCE__ACCOUNT
  roles: 'a7defd23-614d-4c68-ad31-b807b7a164b0',     // FIVETRAN.AURORA_POSTGRES_CLAY_ADMIN.USER_ROLES
  credits: '990653ed-fe9f-4d3c-a674-f4278de7049f',   // DBT.PROD.CREDIT_PACK_INVOICES
}
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`)
  return `DATE '${x}'`
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

export interface TaggedVideo { videoId: string; campaign: string; cohortStart: ISODate; cohortEnd: ISODate }
export interface SocialQuery {
  cur: [ISODate, ISODate]
  prev: [ISODate, ISODate]
  /** Videos whose description link carries a utm_campaign (from the YouTube sync). */
  tagged: TaggedVideo[]
}

export function socialSql(q: SocialQuery): string {
  const dates = [q.cur[0], q.cur[1], q.prev[0], q.prev[1], ...q.tagged.flatMap(v => [v.cohortStart, v.cohortEnd])].sort()
  const lo = dates[0]; const hi = dates[dates.length - 1]
  const bucket = (col: string) =>
    `CASE WHEN ${col} BETWEEN ${d(q.cur[0])} AND ${d(q.cur[1])} THEN 'cur' WHEN ${col} BETWEEN ${d(q.prev[0])} AND ${d(q.prev[1])} THEN 'prev' END`
  const prefixes = CHANNELS.map(c => c.campaignPrefix).filter(Boolean) as string[]
  const prefixMatch = (col: string) => prefixes.length ? `(${prefixes.map(p => `${col} LIKE ${lit(`${p}%`)}`).join(' OR ')})` : 'FALSE'
  // Lookup table; a sentinel row keeps the CTE valid when no video is tagged.
  const vmap = [...q.tagged, { videoId: '__none__', campaign: '__none__', cohortStart: '1970-01-01', cohortEnd: '1970-01-01' }]
    .map(v => `SELECT ${lit(v.campaign.toLowerCase())} AS "camp", ${lit(v.videoId)} AS "vid", ${d(v.cohortStart)} AS "cs", ${d(v.cohortEnd)} AS "ce"`)
    .join(' UNION ALL ')
  const tierCols = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Untiered']
    .map((tn, i) => `SUM(CASE WHEN "tier" = '${tn}' THEN 1 ELSE 0 END) AS "t${i + 1}"`).join(', ')
  const zeroT = `0 AS "x", 0 AS "c", 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"`
  const keyExpr = (camp: string) => `CASE WHEN vm."vid" IS NOT NULL THEN vm."vid"
              WHEN ${camp} <> '' AND ${prefixMatch(camp)} THEN 'unmapped:' || ${camp}
              WHEN ${camp} = '' THEN 'untagged' ELSE 'other' END`

  return `WITH vmap AS (${vmap}),
pv AS (
  SELECT p."ANONYMOUS_ID" AS "aid", p."USER_ID" AS "uid", p."TIMESTAMP_UTC" AS "ts", CAST(p."TIMESTAMP_UTC" AS date) AS "day",
         CASE WHEN p."REFERRER" = 'affiliate' AND COALESCE(p."UTM_CAMPAIGN", '') = '' THEN 'affiliate'
              ELSE ${keyExpr(`LOWER(COALESCE(p."UTM_CAMPAIGN", ''))`)} END AS "key",
         vm."cs", vm."ce"
  FROM ${t(T.pageviews)} p
  LEFT JOIN vmap vm ON vm."camp" = LOWER(COALESCE(p."UTM_CAMPAIGN", '')) AND p."UTM_SOURCE" ILIKE '%youtube%'
  WHERE CAST(p."TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND (p."REFERRER_RAW" ILIKE '%youtu%' OR p."UTM_SOURCE" ILIKE '%youtu%')
),
cu AS (
  SELECT "WORKSPACE_ID" AS "wid", MIN(LOWER("DOMAIN")) AS "dom", MIN("CUSTOMER_DOMAIN_SEGMENT") AS "seg",
         MIN("FIRST_INVOICE_UTC") AS "first_inv", MAX("LATEST_PLAN_CLEAN") AS "plan",
         MAX("LATEST_SUBSCRIPTION_CANCELLATION_UTC") AS "cancel", MAX("BINARY_CURRENT_CUSTOMER") AS "current",
         MAX(CASE WHEN "LATEST_INFLECTION_PREVIOUS_PLAN" IS NOT NULL AND "LATEST_INFLECTION_PREVIOUS_PLAN" <> 'Free/Trial' THEN 1 ELSE 0 END) AS "upgraded"
  FROM ${t(T.customers)} GROUP BY "WORKSPACE_ID"
),
cp AS (SELECT "WORKSPACE_ID" AS "wid", MIN("CREATED_AT_UTC") AS "first_pack" FROM ${t(T.credits)} WHERE "AMOUNT_PAID" > 0 GROUP BY "WORKSPACE_ID"),
acct AS (
  SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier"
  FROM ${t(T.accounts)} WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL
  GROUP BY LOWER("DOMAIN_C")
),
wtier AS (
  SELECT cu."wid", CASE WHEN cu."seg" = 'other' AND acct."tier" IS NOT NULL THEN acct."tier" ELSE 'Untiered' END AS "tier"
  FROM cu LEFT JOIN acct ON acct."dom" = cu."dom"
),
ft AS (
  SELECT f."WORKSPACE_ID" AS "wid", CAST(f."CREATED_AT_UTC" AS date) AS "day",
         ${keyExpr(`LOWER(COALESCE(f."UTM_CAMPAIGN", ''))`)} AS "key", vm."cs", vm."ce"
  FROM ${t(T.firstTouch)} f
  LEFT JOIN vmap vm ON vm."camp" = LOWER(COALESCE(f."UTM_CAMPAIGN", '')) AND f."UTM_SOURCE" ILIKE '%youtube%'
  WHERE CAST(f."CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND (f."UTM_SOURCE" ILIKE '%youtu%' OR f."RAW_REFERRER" ILIKE '%youtu%' OR f."REFERRER" ILIKE '%youtu%')
    AND COALESCE(f."CHANNEL", '') <> 'Affiliate'
),
fx AS (
  SELECT ft.*, COALESCE(wt."tier", 'Untiered') AS "tier",
         CASE WHEN b."BINARY_ACTIVATED_WORKSPACE" = 1 AND b."DAYS_TO_ACTIVATION" <= ${ACTIVATION_DAYS} THEN 1 ELSE 0 END AS "act",
         CASE WHEN cu."first_inv" IS NOT NULL THEN 1 ELSE 0 END AS "paid",
         CASE WHEN cu."first_inv" IS NOT NULL AND (cu."upgraded" = 1 OR cp."first_pack" > cu."first_inv") THEN 1 ELSE 0 END AS "exp",
         CASE WHEN cu."first_inv" IS NOT NULL AND cu."cancel" IS NOT NULL AND COALESCE(cu."current", 0) = 0 THEN 1 ELSE 0 END AS "churn",
         COALESCE(cu."plan", 'Free') AS "plan"
  FROM ft
  LEFT JOIN wtier wt ON wt."wid" = ft."wid"
  LEFT JOIN cu ON cu."wid" = ft."wid"
  LEFT JOIN cp ON cp."wid" = ft."wid"
  LEFT JOIN ${t(T.blended)} b ON b."WORKSPACE_ID" = ft."wid" AND b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
),
tv AS (
  SELECT "uid", "key", "cs", "ce", "day", "ts" FROM pv WHERE "uid" IS NOT NULL AND "cs" IS NOT NULL
),
exw AS (
  SELECT DISTINCT tv."key", tv."day", tv."cs", tv."ce", CAST(r."RESOURCEID" AS integer) AS "wid"
  FROM tv JOIN ${t(T.roles)} r
    ON CAST(r."USERID" AS string) = tv."uid" AND r."RESOURCETYPE" = 'workspace' AND r."DELETEDAT" IS NULL AND r."CREATEDAT" < tv."ts"
),
exx AS (SELECT exw.*, COALESCE(wt."tier", 'Untiered') AS "tier" FROM exw LEFT JOIN wtier wt ON wt."wid" = exw."wid")
SELECT 'vis' AS "k", ${bucket('"day"')} AS "b", "key", '' AS "d", COUNT(DISTINCT "aid") AS "n", 0 AS "a", 0 AS "p", ${zeroT}
FROM pv WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'vis', 'coh', "key", '', COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM pv WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key"
UNION ALL
SELECT 'vday', '', CASE WHEN "cs" IS NOT NULL THEN 'tagged' ELSE "key" END, CAST("day" AS string), COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM pv WHERE ${bucket('"day"')} IS NOT NULL AND ("cs" IS NOT NULL OR "key" = 'untagged')
GROUP BY CASE WHEN "cs" IS NOT NULL THEN 'tagged' ELSE "key" END, "day"
UNION ALL
SELECT 'ws', ${bucket('"day"')}, "key", '', COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM fx WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'ws', 'coh', "key", '', COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM fx WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key"
UNION ALL
SELECT 'plan', ${bucket('"day"')}, "key", "plan", COUNT(DISTINCT "wid"), 0, SUM("paid"), SUM("exp"), SUM("churn"), 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"
FROM fx WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key", "plan"
UNION ALL
SELECT 'plan', 'coh', "key", "plan", COUNT(DISTINCT "wid"), 0, SUM("paid"), SUM("exp"), SUM("churn"), 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"
FROM fx WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key", "plan"
UNION ALL
SELECT 'wsday', '', CASE WHEN "cs" IS NOT NULL THEN 'tagged' ELSE "key" END, CAST("day" AS string), COUNT(DISTINCT "wid"), 0, 0, ${zeroT}
FROM fx WHERE ${bucket('"day"')} IS NOT NULL AND ("cs" IS NOT NULL OR "key" = 'untagged')
GROUP BY CASE WHEN "cs" IS NOT NULL THEN 'tagged' ELSE "key" END, "day"
UNION ALL
SELECT 'ex', ${bucket('"day"')}, "key", '', COUNT(DISTINCT "wid"), 0, 0, 0, 0, ${tierCols}
FROM exx WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'ex', 'coh', "key", '', COUNT(DISTINCT "wid"), 0, 0, 0, 0, ${tierCols}
FROM exx WHERE "day" BETWEEN "cs" AND "ce" GROUP BY "key"`
}

/** Window helper: a video's first COHORT_DAYS days, capped at the last complete data day. */
export function cohortWindow(published: ISODate, days: number, dataEnd: ISODate): [ISODate, ISODate] {
  const end = addDays(published, days - 1)
  return [published, end < dataEnd ? end : dataEnd]
}
