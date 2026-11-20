/**
 * Creator program (affiliate links, clay.com/?via=<token>) straight from the warehouse, per token per week. This is the
 * part of the affiliate team's manual Rewardful pull that the warehouse can answer on its own:
 *
 *   k = 'v'  visitors   distinct marketing cookies with a pageview carrying the token (MARKETING_PAGEVIEWS.AFFILIATE_ID),
 *                       likely bots excluded (same rule as the Media tab)
 *   k = 'w'  workspaces new workspaces whose governed first-touch session (90-day window, the dashboard's attribution)
 *                       landed on a ?via=<token> URL; n2 Tier 1–3 (lib/plg/tier.ts), n3 activated within 7 days,
 *                       n4 matured (created 7+ days before the data end, the activation denominator), n5 paid
 *
 * Columns: k, tok, wk (week start: DATE_TRUNC('week'), a Sunday in this account), n1..n5. Tokens are normalised the same way on both sides: lower case, the
 * URL-encoded "https://clay.com?via=" wrapper some links carry removed, anything after ? or & dropped.
 * Video, creator and fee come from the program's own placement list (youtube/creators in this page's db), not from here.
 */
import { addDays, type ISODate } from '../dates'
import { TIER_ACCOUNTS, tierEligible } from '../tier'
import { bot } from '../cro/sql'

const T = {
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037', // DBT.PROD.MARKETING_PAGEVIEWS
  blended: 'b9625c73-5094-4b94-9c0f-034c5efccbd4',   // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION
  sessions: 'cf3c596b-2dde-415a-b248-efda79af9fa3',  // DBT.PROD.MARKETING_WEBSITE_SESSIONS
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
  crawler: '08b06a57-54a4-42dc-aa3c-d6222a15b09a',   // DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION
}
/** since: the program's first tracked month. windowDays caps the result (about 170 rows a week) under Sigma's 10k rows. */
export const CREATORS = { since: '2026-04-06' as ISODate, windowDays: 273, activationDays: 7 }

const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => `DATE '${x}'`
/** Token normaliser, shared by both sides so they join. */
export const tokSql = (raw: string) =>
  `SPLIT_PART(SPLIT_PART(SPLIT_PART(REPLACE(LOWER(TRIM(${raw})), 'https%3a%2f%2fclay.com%3fvia%3d', ''), '?', 1), '&', 1), '%', 1)`
const wk = (ts: string) => `CAST(CAST(DATE_TRUNC('week', ${ts}) AS date) AS string)`

export function creatorsSql(dataEnd: ISODate): string {
  const floor = addDays(dataEnd, -CREATORS.windowDays)
  const lo = floor > CREATORS.since ? floor : CREATORS.since, matured = addDays(dataEnd, -CREATORS.activationDays)
  return `WITH pv AS (
  SELECT ${tokSql('p."AFFILIATE_ID"')} AS "tok", ${wk('p."TIMESTAMP_UTC"')} AS "wk", p."ANONYMOUS_ID" AS "aid"
  FROM ${t(T.pageviews)} p
  LEFT JOIN ${t(T.crawler)} bc ON bc."IP_ADDRESS" = p."IP_ADDRESS"
  WHERE CAST(p."TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(dataEnd)}
    AND NULLIF(TRIM(p."AFFILIATE_ID"), '') IS NOT NULL
    AND NOT ${bot('bc."BINARY_BOT_EXCLUSION"', 'p."USER_ID"')}
), ws AS (
  SELECT b."WORKSPACE_ID" AS "wid", ${wk('b."WORKSPACE_CREATED_AT_UTC"')} AS "wk", CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) AS "day",
         CASE WHEN b."BINARY_ACTIVATED_WORKSPACE" = 1 AND b."DAYS_TO_ACTIVATION" <= ${CREATORS.activationDays} THEN 1 ELSE 0 END AS "act",
         COALESCE(b."BINARY_CONVERTED_CUSTOMER", 0) AS "paid",
         ${tokSql(`SPLIT_PART(s."URL", 'via=', 2)`)} AS "tok"
  FROM ${t(T.blended)} b
  JOIN ${t(T.sessions)} s ON s."SESSION_ID" = b."SESSION_ID"
  WHERE b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch'
    AND CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(dataEnd)}
    AND s."URL" ILIKE '%via=%'
), cu AS (
  SELECT "WORKSPACE_ID" AS "wid", MIN(LOWER("DOMAIN")) AS "dom", MIN("CUSTOMER_DOMAIN_SEGMENT") AS "seg"
  FROM ${t(T.customers)} GROUP BY "WORKSPACE_ID"
), a AS (
  SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier"
  FROM ${t(TIER_ACCOUNTS)}
  WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL
  GROUP BY LOWER("DOMAIN_C")
)
SELECT 'v' AS "k", "tok", "wk", COUNT(DISTINCT "aid") AS "n1", 0 AS "n2", 0 AS "n3", 0 AS "n4", 0 AS "n5"
FROM pv WHERE "tok" <> '' GROUP BY "tok", "wk"
UNION ALL
SELECT 'w', ws."tok", ws."wk", COUNT(*),
       SUM(CASE WHEN ${tierEligible('cu."seg"')} AND a."tier" IN ('Tier 1', 'Tier 2', 'Tier 3') THEN 1 ELSE 0 END),
       SUM(CASE WHEN ws."day" <= ${d(matured)} THEN ws."act" ELSE 0 END),
       SUM(CASE WHEN ws."day" <= ${d(matured)} THEN 1 ELSE 0 END),
       SUM(ws."paid")
FROM ws LEFT JOIN cu ON cu."wid" = ws."wid" LEFT JOIN a ON a."dom" = cu."dom"
WHERE ws."tok" <> '' GROUP BY ws."tok", ws."wk"`
}
