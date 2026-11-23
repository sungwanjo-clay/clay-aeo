/**
 * Conversion section (Workspaces tab): landing pages and CTA clicks for new visitors. Read-only Sigma (Snowflake)
 * queries, aggregate rows only.
 *
 *   New visitor  a cookie's first-ever session (MARKETING_WEBSITE_SESSIONS, SESSION_ASC_RANKER = 1) with
 *                WORKSPACE_STATUS = 'no existing workspace', not a likely bot (crawler-flagged IP and no Clay user id)
 *   Page type    the entry page of a session, grouped by lib/plg/cro/pageTypes.ts (locale prefixes stripped)
 *   Workspaces   the blended attribution model as is (FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION, ATTRIBUTION_WINDOW
 *                'unbounded', first touch): workspaces created in the period, by the landing page of their attributed
 *                first-touch session (SESSION_ID). No lookback window of our own.
 *   New customer the same model's converted workspaces (BINARY_CONVERTED_CUSTOMER = 1) whose first invoice is in the
 *                period (the model's workspace_first_invoice_date anchor), by the same session's landing page
 *   CTA clicks   CONVERSION_BUTTON_CLICKED from 1 minute before the session start to 24 hours after (≈3% of clicks are
 *                stamped just before their pageview). BUTTON_TYPE 'Self-serve' | 'Contact Form' (demo)
 *   Zones        navbar, hero (%hero%), footer (%footer% or cta_section), body (other homepage_*), pricing plan cards, other
 *
 * New visitors are counted by first-visit date and workspaces by created date, so "workspaces per new visitor" compares
 * the same period's two counts, not one cohort's journey.
 *
 * croSql rows (b = range label "<start>~<end>"): k, b, d, n, a, p, x, c, y, z, q
 *   all   d = ''                      n entry sessions (bots included), a new visitors, p workspaces, q new customers,
 *   lx    d = page type|channel       x CTA clickers within 1 day, c demo clickers, z self-serve clickers, y likely bots
 *   ld    d = page type|device        (channel and device are the session's; 'No session' without one)
 *   lz    d = page type|zone          n clicks, a clickers (motion split only in cta)
 *   cta   d = zone|motion             n clicks, a clickers, all page types
 *   path  d = page type|path          like all: per range, the 40 entry paths with the most new visitors plus each page
 *                                     type's top 10 (any path with a new visitor), so a page-type filter shows its own pages; paths on
 *                                     sites other than clay.com are prefixed with the site (signup:/, university:/…)
 * croTrendSql rows (b = day): k = 'day', d = page type, same columns as all; the last 26 weeks to the data end.
 */
import { addDays, type ISODate } from '../dates'
import { rangeTable } from '../offline'
import { hostSql, pageTypeSql } from './pageTypes'

export const CRO_TABLES = {
  crawler: '08b06a57-54a4-42dc-aa3c-d6222a15b09a',   // DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION
  blended: 'b9625c73-5094-4b94-9c0f-034c5efccbd4',   // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION
  clicks: '97cf52d9-8523-4af4-a02e-b8e8d8019b28',    // SEGMENT.MARKETING_WEBSITE.CONVERSION_BUTTON_CLICKED (source of DBT.PROD.CONVERSION_BUTTON_CLICKED)
  sessions: 'cf3c596b-2dde-415a-b248-efda79af9fa3',  // DBT.PROD.MARKETING_WEBSITE_SESSIONS
}
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`); return `DATE '${x}'` }

export const CRO = {
  /** Entry pages kept per date range (by new visitors), site-wide and per page type; sized so the saved copy stays
   *  under Sigma's 10,000-row limit. */
  topPaths: 40,
  topPathsPerType: 10,
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

const pathExpr = (col: string) => `CASE WHEN LOWER(${col}) IN ('/fr', '/en', '/es', '/de') THEN '/'
              WHEN LOWER(${col}) LIKE '/fr/%' OR LOWER(${col}) LIKE '/en/%' OR LOWER(${col}) LIKE '/es/%' OR LOWER(${col}) LIKE '/de/%' THEN SUBSTR(LOWER(${col}), 4)
              ELSE LOWER(${col}) END`
/** Entry-page label: clay.com paths as is, other sites prefixed with the site. */
const label = (site: string, p: string) => `CASE WHEN ${site} = 'marketing_website' THEN ${p} ELSE COALESCE(${site}, 'unknown') || ':' || COALESCE(${p}, '') END`

/**
 * sx: first-ever sessions from `from` to `to` (page type, channel, device, new-visitor and CTA flags).
 * aw: the attribution model's workspaces created, and customers first invoiced, from `from` to `to`, with the page
 *     type, channel and device of their attributed first-touch session.
 */
function sessionCtes(from: ISODate, to: ISODate): string {
  return `se AS (
  SELECT s."SESSION_ID" AS "sid", s."ANONYMOUS_ID" AS "aid", s."SESSION_START_UTC" AS "ts", CAST(s."SESSION_START_UTC" AS date) AS "day",
         s."SITE" AS "site", ${hostSql('s."URL"')} AS "host", ${pathExpr('s."PATH"')} AS "p",
         COALESCE(NULLIF(s."CHANNEL", ''), 'Unknown') AS "ch", ${deviceCase('s."PLATFORM"')} AS "dev",
         CASE WHEN s."WORKSPACE_STATUS" = 'no existing workspace' AND NOT ${bot('c."BINARY_BOT_EXCLUSION"', 's."USER_ID"')} THEN 1 ELSE 0 END AS "isnew",
         CASE WHEN ${bot('c."BINARY_BOT_EXCLUSION"', 's."USER_ID"')} THEN 1 ELSE 0 END AS "bot"
  FROM ${t(CRO_TABLES.sessions)} s LEFT JOIN ${t(CRO_TABLES.crawler)} c ON c."IP_ADDRESS" = s."IP_ADDRESS"
  WHERE CAST(s."SESSION_START_UTC" AS date) >= ${d(from)} AND CAST(s."SESSION_START_UTC" AS date) <= ${d(to)} AND s."SESSION_ASC_RANKER" = 1
),
ty AS (SELECT se.*, ${pageTypeSql('se."site"', 'se."p"', 'se."host"')} AS "lpt" FROM se),
neclk AS (
  SELECT DISTINCT ty."sid", k."ID" AS "kid", CASE k."BUTTON_TYPE" WHEN 'Self-serve' THEN 'self_serve' WHEN 'Contact Form' THEN 'demo' ELSE 'other' END AS "motion",
         ${zoneCase('k."ELEMENT_LOCATION"')} AS "zone"
  FROM ty JOIN ${t(CRO_TABLES.clicks)} k ON k."ANONYMOUS_ID" = ty."aid"
   AND k."TIMESTAMP" >= ty."ts" - INTERVAL '1 minute' AND k."TIMESTAMP" < ty."ts" + INTERVAL '1 day' AND k."TIMESTAMP" >= ${d(from)} - INTERVAL '1 day'
  WHERE ty."isnew" = 1
),
nesk AS (SELECT "sid", MAX(CASE WHEN "motion" = 'demo' THEN 1 ELSE 0 END) AS "dm", MAX(CASE WHEN "motion" = 'self_serve' THEN 1 ELSE 0 END) AS "ss" FROM neclk GROUP BY "sid"),
sx AS (
  SELECT ty."sid", ty."day", ty."lpt", ty."ch", ty."dev", ${label('ty."site"', 'ty."p"')} AS "p", ty."isnew", ty."bot",
         CASE WHEN nesk."sid" IS NULL THEN 0 ELSE 1 END AS "ck", COALESCE(nesk."dm", 0) AS "dm", COALESCE(nesk."ss", 0) AS "ss"
  FROM ty LEFT JOIN nesk ON nesk."sid" = ty."sid"
),
aw0 AS (
  SELECT b."SESSION_ID" AS "sid", CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) AS "cday",
         CASE WHEN b."BINARY_CONVERTED_CUSTOMER" = 1 THEN CAST(b."FIRST_INVOICE_UTC" AS date) END AS "iday"
  FROM ${t(CRO_TABLES.blended)} b
  WHERE b."ATTRIBUTION_WINDOW" = 'unbounded' AND b."ATTRIBUTION_TYPE" = 'first_touch'
    AND (CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(from)} AND ${d(to)}
      OR (b."BINARY_CONVERTED_CUSTOMER" = 1 AND CAST(b."FIRST_INVOICE_UTC" AS date) BETWEEN ${d(from)} AND ${d(to)}))
),
aw1 AS (
  SELECT aw0.*, s."SITE" AS "site", ${hostSql('s."URL"')} AS "host", ${pathExpr('s."PATH"')} AS "p",
         COALESCE(NULLIF(s."CHANNEL", ''), 'Unknown') AS "ch", ${deviceCase('s."PLATFORM"')} AS "dev", s."SESSION_ID" AS "found"
  FROM aw0 LEFT JOIN ${t(CRO_TABLES.sessions)} s ON s."SESSION_ID" = aw0."sid"
),
aw AS (
  SELECT "cday", "iday",
         CASE WHEN "found" IS NULL THEN 'No attributed session' ELSE ${pageTypeSql('"site"', '"p"', '"host"')} END AS "lpt",
         CASE WHEN "found" IS NULL THEN 'No session' ELSE "ch" END AS "ch", CASE WHEN "found" IS NULL THEN 'Unknown' ELSE "dev" END AS "dev",
         CASE WHEN "found" IS NULL THEN '(no session)' ELSE ${label('"site"', '"p"')} END AS "p"
  FROM aw1
)`
}
/** Both populations in one fact table per range, so every key comes out as one row. */
const unified = `u AS (
  SELECT sf."b", sf."lpt", sf."ch", sf."dev", sf."p", 1 AS "n", sf."isnew" AS "a", 0 AS "ws", sf."ck" AS "x", sf."dm" AS "c", sf."bot" AS "y", sf."ss" AS "z", 0 AS "cu" FROM sf
  UNION ALL
  SELECT rng."lbl", aw."lpt", aw."ch", aw."dev", aw."p", 0, 0,
         CASE WHEN aw."cday" BETWEEN rng."rs" AND rng."re" THEN 1 ELSE 0 END, 0, 0, 0, 0,
         CASE WHEN aw."iday" BETWEEN rng."rs" AND rng."re" THEN 1 ELSE 0 END
  FROM aw JOIN rng ON aw."cday" BETWEEN rng."rs" AND rng."re" OR aw."iday" BETWEEN rng."rs" AND rng."re"
)`
const M = `SUM("n"), SUM("a"), SUM("ws"), SUM("x"), SUM("c"), SUM("y"), SUM("z"), SUM("cu")`

export function croSql(ranges: readonly (readonly [ISODate, ISODate])[], dataEnd: ISODate): string {
  const from = [...ranges.map(r => r[0])].sort()[0]
  return `WITH rng AS (${rangeTable(ranges)}),
${sessionCtes(from, dataEnd)},
sf AS (SELECT rng."lbl" AS "b", sx.* FROM sx JOIN rng ON sx."day" BETWEEN rng."rs" AND rng."re"),
${unified},
pa AS (SELECT "b", "lpt", "p", SUM("n") AS "n", SUM("a") AS "a", SUM("ws") AS "pp", SUM("x") AS "x", SUM("c") AS "c", SUM("y") AS "y", SUM("z") AS "z", SUM("cu") AS "q" FROM u GROUP BY "b", "lpt", "p"),
pth AS (SELECT pa.*, ROW_NUMBER() OVER (PARTITION BY "b" ORDER BY "a" DESC, "p") AS "rk",
            ROW_NUMBER() OVER (PARTITION BY "b", "lpt" ORDER BY "a" DESC, "p") AS "rkt" FROM pa WHERE "a" >= 1)
SELECT 'all' AS "k", "b", '' AS "d", SUM("n") AS "n", SUM("a") AS "a", SUM("ws") AS "p", SUM("x") AS "x", SUM("c") AS "c", SUM("y") AS "y", SUM("z") AS "z", SUM("cu") AS "q"
FROM u GROUP BY "b"
UNION ALL
SELECT 'lx', "b", "lpt" || '|' || "ch", ${M} FROM u GROUP BY "b", "lpt", "ch"
UNION ALL
SELECT 'ld', "b", "lpt" || '|' || "dev", ${M} FROM u GROUP BY "b", "lpt", "dev"
UNION ALL
SELECT 'path', "b", "lpt" || '|' || "p", "n", "a", "pp", "x", "c", "y", "z", "q" FROM pth WHERE "rk" <= ${CRO.topPaths} OR "rkt" <= ${CRO.topPathsPerType}
UNION ALL
SELECT 'lz', rng."lbl", sx."lpt" || '|' || neclk."zone", COUNT(DISTINCT neclk."kid"), COUNT(DISTINCT neclk."sid"), 0, 0, 0, 0, 0, 0
FROM neclk JOIN sx ON sx."sid" = neclk."sid" JOIN rng ON sx."day" BETWEEN rng."rs" AND rng."re"
GROUP BY rng."lbl", sx."lpt", neclk."zone"
UNION ALL
SELECT 'cta', rng."lbl", neclk."zone" || '|' || neclk."motion", COUNT(DISTINCT neclk."kid"), COUNT(DISTINCT neclk."sid"), 0, 0, 0, 0, 0, 0
FROM neclk JOIN sx ON sx."sid" = neclk."sid" JOIN rng ON sx."day" BETWEEN rng."rs" AND rng."re"
GROUP BY rng."lbl", neclk."zone", neclk."motion"`
}

/** Daily new visitors and clicks (by visit day), workspaces (created day) and new customers (first-invoice day) by page type. */
export function croTrendSql(dataEnd: ISODate): string {
  const from = addDays(dataEnd, -(CRO.trendDays - 1))
  return `WITH ${sessionCtes(from, dataEnd)},
ud AS (
  SELECT "day", "lpt", 1 AS "n", "isnew" AS "a", 0 AS "ws", "ck" AS "x", "dm" AS "c", "bot" AS "y", "ss" AS "z", 0 AS "cu" FROM sx
  UNION ALL SELECT "cday", "lpt", 0, 0, 1, 0, 0, 0, 0, 0 FROM aw WHERE "cday" BETWEEN ${d(from)} AND ${d(dataEnd)}
  UNION ALL SELECT "iday", "lpt", 0, 0, 0, 0, 0, 0, 0, 1 FROM aw WHERE "iday" BETWEEN ${d(from)} AND ${d(dataEnd)}
)
SELECT 'day' AS "k", CAST("day" AS string) AS "b", "lpt" AS "d", SUM("n") AS "n", SUM("a") AS "a", SUM("ws") AS "p", SUM("x") AS "x", SUM("c") AS "c", SUM("y") AS "y", SUM("z") AS "z", SUM("cu") AS "q"
FROM ud GROUP BY "day", "lpt"`
}
