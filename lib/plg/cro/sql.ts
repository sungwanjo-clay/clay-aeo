/**
 * Conversion section (Workspaces tab): landing pages and CTA clicks for new visitors. Read-only Sigma (Snowflake)
 * queries, aggregate rows only. Definitions from monty (Clay's data analyst agent, growth-marketing landing-page playbook):
 *
 *   New visitor  a cookie's first-ever session (MARKETING_WEBSITE_SESSIONS, SESSION_ASC_RANKER = 1) with
 *                WORKSPACE_STATUS = 'no existing workspace', not a likely bot (crawler-flagged IP and no Clay user id)
 *   Page type    the entry page of that session, grouped by lib/plg/cro/pageTypes.ts (locale prefixes stripped)
 *   1-day conv.  a CUSTOMERS workspace linked to the cookie (COOKIE_TO_WORKSPACE_RELATIONSHIP) created within 24 hours
 *   CTA clicks   CONVERSION_BUTTON_CLICKED from 1 minute before the session start to 24 hours after (≈3% of clicks are
 *                stamped just before their pageview). BUTTON_TYPE 'Self-serve' | 'Contact Form' (demo)
 *   Zones        navbar, hero (%hero%), footer (%footer% or cta_section), body (other homepage_*), pricing plan cards, other
 *
 * croSql rows (b = range label "<start>~<end>"): k, b, d, n, a, p, x, c, y, z
 *   all   d = ''                      n entry sessions (bots included), a new visitors, p converted within 1 day,
 *   lx    d = page type|channel       x CTA clickers within 1 day, c demo clickers, z self-serve clickers, y likely bots
 *   ld    d = page type|device
 *   lz    d = page type|zone          n clicks, a clickers (motion split only in cta)
 *   cta   d = zone|motion             n clicks, a clickers, all page types
 *   path  d = page type|path          like all, top 40 entry paths per range by new visitors (25 or more); paths on
 *                                     sites other than clay.com are prefixed with the site (signup:/, ploy-lp:/…)
 * croTrendSql rows (b = day): k = 'day', d = page type, same columns as all; the last 26 weeks to the data end.
 */
import { addDays, type ISODate } from '../dates'
import { rangeTable } from '../offline'
import { pageTypeSql } from './pageTypes'

export const CRO_TABLES = {
  crawler: '08b06a57-54a4-42dc-aa3c-d6222a15b09a',   // DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION
  cookies: '22e14a56-e32f-4d31-aff8-b6bc3b23190b',   // DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
  clicks: '97cf52d9-8523-4af4-a02e-b8e8d8019b28',    // SEGMENT.MARKETING_WEBSITE.CONVERSION_BUTTON_CLICKED (source of DBT.PROD.CONVERSION_BUTTON_CLICKED)
  sessions: 'cf3c596b-2dde-415a-b248-efda79af9fa3',  // DBT.PROD.MARKETING_WEBSITE_SESSIONS
}
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`); return `DATE '${x}'` }

export const CRO = {
  /** Entry pages kept per date range (by new visitors), so the saved copy stays under Sigma's 10,000-row limit. */
  topPaths: 40,
  /** Days in the daily trend (to the data end). */
  trendDays: 182,
  /** Prior-workspace detection widened on this day, shrinking the new-visitor denominator. */
  detectionChange: '2026-09-15' as ISODate,
}

const zoneCase = (col: string) => `CASE WHEN TRIM(LOWER(${col})) = 'pricing' THEN 'pricing_cards'
              WHEN NULLIF(TRIM(${col}), '') IS NULL THEN 'unknown'
              WHEN LOWER(TRIM(${col})) = 'navbar' THEN 'navbar'
              WHEN LOWER(${col}) LIKE '%hero%' THEN 'hero'
              WHEN LOWER(${col}) LIKE '%footer%' OR LOWER(TRIM(${col})) = 'cta_section' THEN 'footer'
              WHEN LOWER(TRIM(${col})) LIKE 'homepage%' THEN 'body'
              ELSE 'other' END`
const deviceCase = (col: string) => `CASE WHEN ${col} = 'Windows' THEN 'Windows' WHEN ${col} IN ('macOS', 'Mac OS X') THEN 'macOS'
              WHEN ${col} = 'Linux' THEN 'Linux' WHEN ${col} IN ('iOS', 'Android') THEN 'Mobile' WHEN ${col} IS NULL OR ${col} = '' THEN 'Unknown' ELSE 'Other' END`

/**
 * Likely bot: crawler-flagged IP and no numeric user id (monty's rule). Sigma has no TRANSLATE / regex, so "not numeric"
 * is: missing, or contains a letter (LOWER differs from UPPER). Clay user ids are numeric.
 */
export const bot = (flag: string, uid: string) => `(COALESCE(${flag}, 0) = 1 AND (NULLIF(TRIM(${uid}), '') IS NULL OR LOWER(${uid}) <> UPPER(${uid})))`

/** First-ever sessions from `from` to `to` with page type, channel, device, and new-visitor / conversion / click flags. */
function sessionCtes(from: ISODate, to: ISODate): string {
  const path = `CASE WHEN LOWER(s."PATH") IN ('/fr', '/en', '/es', '/de') THEN '/'
              WHEN LOWER(s."PATH") LIKE '/fr/%' OR LOWER(s."PATH") LIKE '/en/%' OR LOWER(s."PATH") LIKE '/es/%' OR LOWER(s."PATH") LIKE '/de/%' THEN SUBSTR(LOWER(s."PATH"), 4)
              ELSE LOWER(s."PATH") END`
  return `se AS (
  SELECT s."SESSION_ID" AS "sid", s."ANONYMOUS_ID" AS "aid", s."SESSION_START_UTC" AS "ts", CAST(s."SESSION_START_UTC" AS date) AS "day",
         s."SITE" AS "site", ${path} AS "p",
         COALESCE(NULLIF(s."CHANNEL", ''), 'Unknown') AS "ch", ${deviceCase('s."PLATFORM"')} AS "dev",
         CASE WHEN s."WORKSPACE_STATUS" = 'no existing workspace' AND NOT ${bot('c."BINARY_BOT_EXCLUSION"', 's."USER_ID"')} THEN 1 ELSE 0 END AS "isnew",
         CASE WHEN ${bot('c."BINARY_BOT_EXCLUSION"', 's."USER_ID"')} THEN 1 ELSE 0 END AS "bot"
  FROM ${t(CRO_TABLES.sessions)} s LEFT JOIN ${t(CRO_TABLES.crawler)} c ON c."IP_ADDRESS" = s."IP_ADDRESS"
  WHERE CAST(s."SESSION_START_UTC" AS date) >= ${d(from)} AND CAST(s."SESSION_START_UTC" AS date) <= ${d(to)} AND s."SESSION_ASC_RANKER" = 1
),
ty AS (SELECT se.*, ${pageTypeSql('se."site"', 'se."p"')} AS "lpt" FROM se),
necv AS (
  SELECT DISTINCT ty."sid" FROM ty JOIN ${t(CRO_TABLES.cookies)} r ON r."ANONYMOUS_ID" = ty."aid"
  JOIN ${t(CRO_TABLES.customers)} cu ON cu."WORKSPACE_ID" = r."WORKSPACE_ID"
  WHERE ty."isnew" = 1 AND cu."CREATED_AT_UTC" >= ty."ts" AND cu."CREATED_AT_UTC" < ty."ts" + INTERVAL '1 day'
),
neclk AS (
  SELECT DISTINCT ty."sid", k."ID" AS "kid", CASE k."BUTTON_TYPE" WHEN 'Self-serve' THEN 'self_serve' WHEN 'Contact Form' THEN 'demo' ELSE 'other' END AS "motion",
         ${zoneCase('k."ELEMENT_LOCATION"')} AS "zone"
  FROM ty JOIN ${t(CRO_TABLES.clicks)} k ON k."ANONYMOUS_ID" = ty."aid"
   AND k."TIMESTAMP" >= ty."ts" - INTERVAL '1 minute' AND k."TIMESTAMP" < ty."ts" + INTERVAL '1 day' AND k."TIMESTAMP" >= ${d(from)} - INTERVAL '1 day'
  WHERE ty."isnew" = 1
),
nesk AS (SELECT "sid", MAX(CASE WHEN "motion" = 'demo' THEN 1 ELSE 0 END) AS "dm", MAX(CASE WHEN "motion" = 'self_serve' THEN 1 ELSE 0 END) AS "ss" FROM neclk GROUP BY "sid"),
sx AS (
  SELECT ty."sid", ty."day", ty."lpt", ty."ch", ty."dev",
         CASE WHEN ty."site" = 'marketing_website' THEN ty."p" ELSE COALESCE(ty."site", 'unknown') || ':' || COALESCE(ty."p", '') END AS "p", ty."isnew", ty."bot",
         CASE WHEN necv."sid" IS NULL THEN 0 ELSE 1 END AS "cv", CASE WHEN nesk."sid" IS NULL THEN 0 ELSE 1 END AS "ck",
         COALESCE(nesk."dm", 0) AS "dm", COALESCE(nesk."ss", 0) AS "ss"
  FROM ty LEFT JOIN necv ON necv."sid" = ty."sid" LEFT JOIN nesk ON nesk."sid" = ty."sid"
)`
}
const M = `COUNT(*), SUM("isnew"), SUM("cv"), SUM("ck"), SUM("dm"), SUM("bot"), SUM("ss")`

export function croSql(ranges: readonly (readonly [ISODate, ISODate])[], dataEnd: ISODate): string {
  const from = [...ranges.map(r => r[0])].sort()[0]
  return `WITH rng AS (${rangeTable(ranges)}),
${sessionCtes(from, dataEnd)},
sf AS (SELECT rng."lbl" AS "b", sx.* FROM sx JOIN rng ON sx."day" BETWEEN rng."rs" AND rng."re"),
pa AS (SELECT "b", "lpt", "p", COUNT(*) AS "n", SUM("isnew") AS "a", SUM("cv") AS "pp", SUM("ck") AS "x", SUM("dm") AS "c", SUM("bot") AS "y", SUM("ss") AS "z" FROM sf GROUP BY "b", "lpt", "p"),
pth AS (SELECT pa.*, ROW_NUMBER() OVER (PARTITION BY "b" ORDER BY "a" DESC, "p") AS "rk" FROM pa WHERE "a" >= 25)
SELECT 'all' AS "k", "b", '' AS "d", COUNT(*) AS "n", SUM("isnew") AS "a", SUM("cv") AS "p", SUM("ck") AS "x", SUM("dm") AS "c", SUM("bot") AS "y", SUM("ss") AS "z"
FROM sf GROUP BY "b"
UNION ALL
SELECT 'lx', "b", "lpt" || '|' || "ch", ${M} FROM sf GROUP BY "b", "lpt", "ch"
UNION ALL
SELECT 'ld', "b", "lpt" || '|' || "dev", ${M} FROM sf GROUP BY "b", "lpt", "dev"
UNION ALL
SELECT 'path', "b", "lpt" || '|' || "p", "n", "a", "pp", "x", "c", "y", "z" FROM pth WHERE "rk" <= ${CRO.topPaths}
UNION ALL
SELECT 'lz', rng."lbl", sx."lpt" || '|' || neclk."zone", COUNT(DISTINCT neclk."kid"), COUNT(DISTINCT neclk."sid"), 0, 0, 0, 0, 0
FROM neclk JOIN sx ON sx."sid" = neclk."sid" JOIN rng ON sx."day" BETWEEN rng."rs" AND rng."re"
GROUP BY rng."lbl", sx."lpt", neclk."zone"
UNION ALL
SELECT 'cta', rng."lbl", neclk."zone" || '|' || neclk."motion", COUNT(DISTINCT neclk."kid"), COUNT(DISTINCT neclk."sid"), 0, 0, 0, 0, 0
FROM neclk JOIN sx ON sx."sid" = neclk."sid" JOIN rng ON sx."day" BETWEEN rng."rs" AND rng."re"
GROUP BY rng."lbl", neclk."zone", neclk."motion"`
}

/** Daily new visitors, conversions and clicks by page type, for the deep-dive trend (not tied to the date filter). */
export function croTrendSql(dataEnd: ISODate): string {
  return `WITH ${sessionCtes(addDays(dataEnd, -(CRO.trendDays - 1)), dataEnd)}
SELECT 'day' AS "k", CAST("day" AS string) AS "b", "lpt" AS "d", COUNT(*) AS "n", SUM("isnew") AS "a", SUM("cv") AS "p", SUM("ck") AS "x", SUM("dm") AS "c", SUM("bot") AS "y", SUM("ss") AS "z"
FROM sx GROUP BY "day", "lpt"`
}
