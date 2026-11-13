/**
 * Startup program tab: one Sigma (Snowflake, read-only) query per date range.
 * Returns labelled aggregate rows; never per-person data.
 *
 * Offer page: www.clay.com/clay-for-startups (MARKETING_PAGEVIEWS, site = marketing_website).
 * Its "Apply" CTA is a Typeform whose responses are not in Snowflake, so email captures are not
 * connected. People are identified instead when a visitor's cookie later shows up signed in to a
 * Clay workspace (COOKIE_TO_WORKSPACE_RELATIONSHIP).
 *
 * MQAL (this tab's definition, not the SLG hand-raise MQAL): a distinct business domain at a
 * Salesforce Tier 1–3 account among identified visitors. Domain = the workspace's billing domain
 * (CUSTOMERS.DOMAIN, business domains only); tier = STG_SALESFORCE__ACCOUNT.SALES_TIER_C.
 *
 * Row kinds (k), b = cur | prev:
 *   vis   distinct visitors (n), identified visitors (a)
 *   cls   identified visitors by class (d = Tier 1..4 | No Salesforce account | Personal email | Academic | Invalid or missing domain):
 *         n distinct domains (business classes), a identified visitors, p new workspaces, x activated ≤7d, c paid
 *   ws    new workspaces: n, a activated ≤7d, p paid, x paid and still active
 *   cmp   paid campaigns (d = platform|campaign): n visitors, a MQALs (Tier 1–3 domains), p new workspaces
 */
import { addDays, type ISODate } from '../dates'
import { ACTIVATION_DAYS } from '../social/config'

const T = {
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037', // DBT.PROD.MARKETING_PAGEVIEWS
  cookies: '22e14a56-e32f-4d31-aff8-b6bc3b23190b',   // DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
  accounts: 'c5f1715b-69c1-4033-ad5c-8281a21d2cd5',  // DBT.STAGING.STG_SALESFORCE__ACCOUNT
  blended: 'b9625c73-5094-4b94-9c0f-034c5efccbd4',   // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION (activation)
}
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`)
  return `DATE '${x}'`
}

export const STARTUP = {
  pagePaths: ['/clay-for-startups', '/fr/clay-for-startups'],
  pageUrl: 'www.clay.com/clay-for-startups',
  applyUrl: 'clayhq.typeform.com/to/CD561moL',
  /** Visitors whose cookie maps to more workspaces than this (Clay staff, agencies) are not identified. */
  maxWorkspacesPerVisitor: 3,
  internalDomains: ['clay.com', 'clay.run', 'clayhq.com'],
  /** A visitor's workspace counts as new when created within this many days after their first visit in the period. */
  newWindowDays: 30,
  launch: '2026-07-01' as ISODate,
} as const

export function startupSql(q: { cur: [ISODate, ISODate]; prev: [ISODate, ISODate] }): string {
  const lo = [q.cur[0], q.prev[0]].sort()[0]
  const hi = [q.cur[1], q.prev[1]].sort()[1]
  const bucket = (col: string) =>
    `CASE WHEN ${col} BETWEEN ${d(q.cur[0])} AND ${d(q.cur[1])} THEN 'cur' WHEN ${col} BETWEEN ${d(q.prev[0])} AND ${d(q.prev[1])} THEN 'prev' END`
  const paths = STARTUP.pagePaths.map(p => `'${p}'`).join(', ')
  return `WITH pv AS (
  SELECT p."ANONYMOUS_ID" AS "aid", CAST(p."TIMESTAMP_UTC" AS date) AS "day",
         CASE WHEN p."GCLID" IS NOT NULL THEN 'Google' WHEN p."FBCLID" IS NOT NULL THEN 'Meta' WHEN p."LI_CLICK_ID" IS NOT NULL THEN 'LinkedIn'
              WHEN LOWER(COALESCE(p."UTM_MEDIUM", '')) IN ('cpc', 'ppc', 'paid', 'paid_social', 'paidsocial', 'display', 'paid-social') OR LOWER(COALESCE(p."UTM_MEDIUM", '')) LIKE '%paid%'
                THEN CASE WHEN LOWER(p."UTM_SOURCE") LIKE '%google%' THEN 'Google' WHEN LOWER(p."UTM_SOURCE") LIKE '%linkedin%' THEN 'LinkedIn'
                          WHEN LOWER(p."UTM_SOURCE") LIKE '%facebook%' OR LOWER(p."UTM_SOURCE") LIKE '%meta%' OR LOWER(p."UTM_SOURCE") LIKE '%instagram%' THEN 'Meta'
                          ELSE COALESCE(NULLIF(LOWER(p."UTM_SOURCE"), ''), 'other paid') END END AS "platform",
         COALESCE(NULLIF(LOWER(p."UTM_CAMPAIGN"), ''), '(no campaign)') AS "camp"
  FROM ${t(T.pageviews)} p
  WHERE p."SITE" = 'marketing_website' AND p."PATH" IN (${paths})
    AND CAST(p."TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
),
fv AS (SELECT "aid", ${bucket('"day"')} AS "b", MIN("day") AS "d0" FROM pv WHERE ${bucket('"day"')} IS NOT NULL GROUP BY "aid", ${bucket('"day"')}),
cu AS (
  SELECT "WORKSPACE_ID" AS "wid", MIN("CREATED_AT_UTC") AS "created", MIN(LOWER("DOMAIN")) AS "dom", MIN("CUSTOMER_DOMAIN_SEGMENT") AS "seg",
         MIN("FIRST_INVOICE_UTC") AS "first_inv", MAX("BINARY_CURRENT_CUSTOMER") AS "current"
  FROM ${t(T.customers)} GROUP BY "WORKSPACE_ID"
),
acct AS (
  SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier"
  FROM ${t(T.accounts)} WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL
  GROUP BY LOWER("DOMAIN_C")
),
ck AS (
  SELECT c."ANONYMOUS_ID" AS "aid", c."WORKSPACE_ID" AS "wid", COUNT(*) OVER (PARTITION BY c."ANONYMOUS_ID") AS "nws"
  FROM ${t(T.cookies)} c WHERE c."ANONYMOUS_ID" IN (SELECT "aid" FROM fv)
),
lw AS (
  SELECT DISTINCT fv."aid", fv."b", fv."d0", cu."wid", cu."dom",
         CASE WHEN cu."dom" IS NULL OR cu."dom" = '' OR cu."dom" NOT LIKE '%.%' THEN 'Invalid or missing domain'
              WHEN cu."seg" = 'personal' THEN 'Personal email' WHEN cu."seg" = 'academic' THEN 'Academic'
              WHEN acct."tier" IS NULL THEN 'No Salesforce account' ELSE acct."tier" END AS "cls",
         CASE WHEN CAST(cu."created" AS date) >= fv."d0" AND CAST(cu."created" AS date) <= DATE_ADD('day', ${STARTUP.newWindowDays}, fv."d0") THEN 1 ELSE 0 END AS "is_new",
         CASE WHEN b."BINARY_ACTIVATED_WORKSPACE" = 1 AND b."DAYS_TO_ACTIVATION" <= ${ACTIVATION_DAYS} THEN 1 ELSE 0 END AS "act",
         CASE WHEN cu."first_inv" IS NOT NULL THEN 1 ELSE 0 END AS "paid",
         CASE WHEN cu."first_inv" IS NOT NULL AND COALESCE(cu."current", 0) = 1 THEN 1 ELSE 0 END AS "active"
  FROM fv
  JOIN ck ON ck."aid" = fv."aid" AND ck."nws" <= ${STARTUP.maxWorkspacesPerVisitor}
  JOIN cu ON cu."wid" = ck."wid" AND COALESCE(cu."dom", '') NOT IN (${STARTUP.internalDomains.map(x => `'${x}'`).join(', ')})
  LEFT JOIN acct ON acct."dom" = cu."dom" AND cu."seg" = 'other'
  LEFT JOIN ${t(T.blended)} b ON b."WORKSPACE_ID" = cu."wid" AND b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
),
mq AS (SELECT DISTINCT "aid", "b", "dom" FROM lw WHERE "cls" IN ('Tier 1', 'Tier 2', 'Tier 3')),
pc AS (SELECT DISTINCT pv."aid", ${bucket('pv."day"')} AS "b", pv."platform", pv."camp" FROM pv WHERE pv."platform" IS NOT NULL AND ${bucket('pv."day"')} IS NOT NULL)
SELECT 'vis' AS "k", fv."b", '' AS "d", COUNT(DISTINCT fv."aid") AS "n", COUNT(DISTINCT lw."aid") AS "a", 0 AS "p", 0 AS "x", 0 AS "c"
FROM fv LEFT JOIN lw ON lw."aid" = fv."aid" AND lw."b" = fv."b" GROUP BY fv."b"
UNION ALL
SELECT 'cls', "b", "cls", COUNT(DISTINCT CASE WHEN "cls" NOT IN ('Personal email', 'Academic', 'Invalid or missing domain') THEN "dom" END), COUNT(DISTINCT "aid"),
       COUNT(DISTINCT CASE WHEN "is_new" = 1 THEN "wid" END), COUNT(DISTINCT CASE WHEN "is_new" = 1 AND "act" = 1 THEN "wid" END), COUNT(DISTINCT CASE WHEN "is_new" = 1 AND "paid" = 1 THEN "wid" END)
FROM lw GROUP BY "b", "cls"
UNION ALL
SELECT 'ws', "b", '', COUNT(DISTINCT "wid"), COUNT(DISTINCT CASE WHEN "act" = 1 THEN "wid" END), COUNT(DISTINCT CASE WHEN "paid" = 1 THEN "wid" END), COUNT(DISTINCT CASE WHEN "active" = 1 THEN "wid" END), 0
FROM lw WHERE "is_new" = 1 GROUP BY "b"
UNION ALL
SELECT 'cmp', pc."b", pc."platform" || '|' || pc."camp", COUNT(DISTINCT pc."aid"), COUNT(DISTINCT mq."dom"), COUNT(DISTINCT CASE WHEN lw."is_new" = 1 THEN lw."wid" END), 0, 0
FROM pc LEFT JOIN mq ON mq."aid" = pc."aid" AND mq."b" = pc."b" LEFT JOIN lw ON lw."aid" = pc."aid" AND lw."b" = pc."b"
GROUP BY pc."b", pc."platform", pc."camp"`
}

/** Last day new-workspace counting can be complete for (visits within the window still accrue). */
export const settledThrough = (dataEnd: ISODate) => addDays(dataEnd, -STARTUP.newWindowDays)
