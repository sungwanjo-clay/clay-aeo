/**
 * CRO section (Workspaces tab): landing pages and the clay.com homepage launch. Read-only Sigma (Snowflake) query,
 * aggregate rows only. Definitions from monty (Clay's data analyst agent, growth-marketing landing-page playbook):
 *
 *   Scope        SITE = 'marketing_website' (path '/' also exists on the university and guides sites)
 *   New visitor  the cookie's first-ever view of the page falls on day D; not a likely bot (crawler IP flag and no
 *                numeric user id on that first view); not seen in any workspace before that view
 *                (COOKIE_TO_WORKSPACE_RELATIONSHIP.FIRST_SEEN < first view)
 *   1-day conv.  a CUSTOMERS workspace linked to the cookie was created within 24 hours after the first view
 *   CTA clicks   CONVERSION_BUTTON_CLICKED on the same page from 1 minute before the first view to 24 hours after
 *                (≈3% of clicks are stamped just before their pageview). BUTTON_TYPE 'Self-serve' | 'Contact Form' (demo)
 *   Zones        navbar, hero (%hero%), footer (%footer% or cta_section), body (other homepage_*), unknown, other
 *   Landing type entry page of a cookie's first-ever session (MARKETING_WEBSITE_SESSIONS, SESSION_ASC_RANKER = 1,
 *                WORKSPACE_STATUS = 'no existing workspace'), locale prefixes stripped
 *
 * Rows: k, b, d, n, a, p, x, c, y, z
 *   Breakdowns for each range (b = "<start>~<end>"), from first-ever sessions:
 *     all  d = '' · lp d = landing page type · ch d = channel · dev d = device · path d = entry path (25+ new entries)
 *     n entry sessions (bots included), a new-visitor entries, p converted within 1 day, x CTA clickers within 1 day,
 *     c demo clickers, z self-serve clickers, y likely-bot entries
 *   cta  site-wide CTA clicks by new visitors within 1 day of their entry: b = range, d = zone|motion: n clicks, a clickers
 *   pg   key pages by day (b = day, d = homepage | pricing), first view of the page: n new visitors, a converted within
 *        1 day, p CTA clickers on the page, x self-serve clickers, c demo clickers, y pageviews
 *   hz   homepage clicks by new visitors by day: b = day, d = motion|zone: n clicks, a unique clickers
 */
import type { ISODate } from '../dates'
import { rangeTable } from '../offline'

export const CRO_TABLES = {
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037', // DBT.PROD.MARKETING_PAGEVIEWS
  crawler: '08b06a57-54a4-42dc-aa3c-d6222a15b09a',   // DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION
  cookies: '22e14a56-e32f-4d31-aff8-b6bc3b23190b',   // DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
  clicks: '97cf52d9-8523-4af4-a02e-b8e8d8019b28',    // SEGMENT.MARKETING_WEBSITE.CONVERSION_BUTTON_CLICKED (source of DBT.PROD.CONVERSION_BUTTON_CLICKED)
  sessions: 'cf3c596b-2dde-415a-b248-efda79af9fa3',  // DBT.PROD.MARKETING_WEBSITE_SESSIONS
}
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`); return `DATE '${x}'` }

export const CRO = {
  /** New homepage went live 2026-06-23 ~15:00 UTC (button ids in CONVERSION_BUTTON_CLICKED switch over); 06-24 is the first full day. */
  launch: '2026-06-24' as ISODate,
  launchNote: 'New homepage live 2026-06-23 about 15:00 UTC (hero button ids switch in the click data); 2026-06-24 is the first full day.',
  /** Daily series start: four weeks before launch. */
  seriesStart: '2026-05-27' as ISODate,
  /** Prior-workspace detection widened on this day, shrinking the new-visitor denominator. */
  detectionChange: '2026-09-15' as ISODate,
  pages: [{ id: 'homepage', path: '/', label: 'Homepage' }, { id: 'pricing', path: '/pricing', label: 'Pricing' }] as const,
}

const zoneCase = (col: string) => `CASE WHEN NULLIF(TRIM(${col}), '') IS NULL THEN 'unknown'
              WHEN LOWER(TRIM(${col})) = 'navbar' THEN 'navbar'
              WHEN LOWER(${col}) LIKE '%hero%' THEN 'hero'
              WHEN LOWER(${col}) LIKE '%footer%' OR LOWER(TRIM(${col})) = 'cta_section' THEN 'footer'
              WHEN LOWER(TRIM(${col})) LIKE 'homepage%' THEN 'body'
              ELSE 'other' END`
/**
 * Likely bot: crawler-flagged IP and no numeric user id (monty's rule). Sigma has no TRANSLATE / regex, so "not numeric"
 * is: missing, or contains a letter (LOWER differs from UPPER). Clay user ids are numeric.
 */
const bot = (flag: string, uid: string) => `(COALESCE(${flag}, 0) = 1 AND (NULLIF(TRIM(${uid}), '') IS NULL OR LOWER(${uid}) <> UPPER(${uid})))`

export function croSql(ranges: readonly (readonly [ISODate, ISODate])[], dataEnd: ISODate): string {
  const lo = CRO.seriesStart
  const rlo = [...ranges.map(r => r[0])].sort()[0]
  return `WITH rng AS (${rangeTable(ranges)}),
pv AS (
  SELECT p."ANONYMOUS_ID" AS "aid", p."TIMESTAMP_UTC" AS "ts", p."IP_ADDRESS" AS "ip", p."USER_ID" AS "uid",
         CASE WHEN p."PATH" = '/' THEN 'homepage' ELSE 'pricing' END AS "pg"
  FROM ${t(CRO_TABLES.pageviews)} p
  WHERE p."SITE" = 'marketing_website' AND p."PATH" IN ('/', '/pricing') AND p."TIMESTAMP_UTC" >= '2023-01-01'
),
fv AS (SELECT "pg", "aid", "ts", "ip", "uid", ROW_NUMBER() OVER (PARTITION BY "pg", "aid" ORDER BY "ts") AS "rn" FROM pv),
prior AS (SELECT "ANONYMOUS_ID" AS "aid", MIN("FIRST_SEEN") AS "fs" FROM ${t(CRO_TABLES.cookies)} GROUP BY "ANONYMOUS_ID"),
nv AS (
  SELECT fv."pg", fv."aid", fv."ts" AS "f0", CAST(fv."ts" AS date) AS "day"
  FROM fv
  LEFT JOIN ${t(CRO_TABLES.crawler)} c ON c."IP_ADDRESS" = fv."ip"
  LEFT JOIN prior ON prior."aid" = fv."aid"
  WHERE fv."rn" = 1 AND fv."ts" >= ${d(lo)} AND CAST(fv."ts" AS date) <= ${d(dataEnd)}
    AND NOT ${bot('c."BINARY_BOT_EXCLUSION"', 'fv."uid"')}
    AND (prior."fs" IS NULL OR prior."fs" >= fv."ts")
),
cv AS (
  SELECT DISTINCT nv."pg", nv."aid"
  FROM nv JOIN ${t(CRO_TABLES.cookies)} r ON r."ANONYMOUS_ID" = nv."aid"
  JOIN ${t(CRO_TABLES.customers)} cu ON cu."WORKSPACE_ID" = r."WORKSPACE_ID"
  WHERE cu."CREATED_AT_UTC" >= nv."f0" AND cu."CREATED_AT_UTC" < nv."f0" + INTERVAL '1 day'
),
ck AS (
  SELECT DISTINCT nv."pg", nv."day", nv."aid", k."ID" AS "kid",
         CASE k."BUTTON_TYPE" WHEN 'Self-serve' THEN 'self_serve' WHEN 'Contact Form' THEN 'demo' ELSE 'other' END AS "motion",
         ${zoneCase('k."ELEMENT_LOCATION"')} AS "zone"
  FROM nv JOIN ${t(CRO_TABLES.clicks)} k ON k."ANONYMOUS_ID" = nv."aid" AND k."PATH" = CASE nv."pg" WHEN 'homepage' THEN '/' ELSE '/pricing' END
   AND k."TIMESTAMP" >= nv."f0" - INTERVAL '1 minute' AND k."TIMESTAMP" < nv."f0" + INTERVAL '1 day' AND k."TIMESTAMP" >= ${d(lo)} - INTERVAL '1 day'
),
cka AS (SELECT "pg", "aid", MAX(CASE WHEN "motion" = 'self_serve' THEN 1 ELSE 0 END) AS "ss", MAX(CASE WHEN "motion" = 'demo' THEN 1 ELSE 0 END) AS "dm" FROM ck GROUP BY "pg", "aid"),
traffic AS (SELECT "pg", CAST("ts" AS date) AS "day", COUNT(*) AS "views" FROM pv WHERE "ts" >= ${d(lo)} GROUP BY "pg", CAST("ts" AS date)),
pgd AS (
  SELECT nv."pg", nv."day", COUNT(*) AS "n", COUNT(cv."aid") AS "a", COUNT(cka."aid") AS "p", SUM(COALESCE(cka."ss", 0)) AS "x", SUM(COALESCE(cka."dm", 0)) AS "c"
  FROM nv LEFT JOIN cv ON cv."pg" = nv."pg" AND cv."aid" = nv."aid" LEFT JOIN cka ON cka."pg" = nv."pg" AND cka."aid" = nv."aid"
  GROUP BY nv."pg", nv."day"
),
se AS (
  SELECT s."SESSION_ID" AS "sid", s."ANONYMOUS_ID" AS "aid", s."SESSION_START_UTC" AS "ts", CAST(s."SESSION_START_UTC" AS date) AS "day", s."SITE" AS "site",
         CASE WHEN LOWER(s."PATH") IN ('/fr', '/en', '/es', '/de') THEN '/'
              WHEN LOWER(s."PATH") LIKE '/fr/%' OR LOWER(s."PATH") LIKE '/en/%' OR LOWER(s."PATH") LIKE '/es/%' OR LOWER(s."PATH") LIKE '/de/%' THEN SUBSTR(LOWER(s."PATH"), 4)
              ELSE LOWER(s."PATH") END AS "p",
         COALESCE(NULLIF(s."CHANNEL", ''), 'Unknown') AS "ch", COALESCE(NULLIF(s."PLATFORM", ''), 'Unknown') AS "dev",
         s."SESSION_ASC_RANKER" AS "rk", s."WORKSPACE_STATUS" AS "wst",
         CASE WHEN ${bot('c."BINARY_BOT_EXCLUSION"', 's."USER_ID"')} THEN 1 ELSE 0 END AS "bot"
  FROM ${t(CRO_TABLES.sessions)} s LEFT JOIN ${t(CRO_TABLES.crawler)} c ON c."IP_ADDRESS" = s."IP_ADDRESS"
  WHERE CAST(s."SESSION_START_UTC" AS date) >= ${d(rlo)} AND CAST(s."SESSION_START_UTC" AS date) <= ${d(dataEnd)}
    AND s."SESSION_ASC_RANKER" = 1 AND s."SITE" IN ('marketing_website', 'signup', 'login', 'university', 'ploy-guides')
),
ty AS (
  SELECT se.*, CASE WHEN "wst" = 'no existing workspace' AND "bot" = 0 THEN 1 ELSE 0 END AS "isnew", CASE
      WHEN "site" IN ('signup', 'login') THEN 'signup_login'
      WHEN "site" = 'university' AND "p" LIKE '/docs%' THEN 'docs'
      WHEN "site" IN ('university', 'ploy-guides') THEN 'guides_resources'
      WHEN "p" = '/' THEN 'homepage'
      WHEN "p" LIKE '/pricing%' THEN 'pricing'
      WHEN "p" LIKE '/blog%' THEN 'blog'
      WHEN "p" LIKE '/customers%' THEN 'customers'
      WHEN "p" IN ('/demo', '/contact', '/quote') OR "p" LIKE '/demo/%' THEN 'demo_contact'
      WHEN "p" LIKE '/use-cases%' OR "p" LIKE '/clay-for-%' OR "p" LIKE '/solutions%' OR "p" IN ('/enterprise', '/sdr', '/inbound-sdr') THEN 'solutions'
      WHEN "p" LIKE '/integrations%' OR "p" IN ('/signals', '/claygent', '/audiences', '/ai-formula', '/mcp', '/waterfall-enrichment', '/ads', '/functions',
           '/agent-plugin', '/sequencer', '/workflows', '/sculptor', '/agent', '/account-agents', '/changelog') THEN 'product_features'
      WHEN "p" LIKE '/dossier%' OR "p" LIKE '/glossary%' OR "p" LIKE '/templates%' OR "p" LIKE '/tools%' OR "p" LIKE '/faq%' OR "p" LIKE '/livestreams%'
        OR "p" LIKE '/providers-signal%' OR "p" LIKE '/data-tests%' OR "p" LIKE '/university%' THEN 'guides_resources'
      WHEN "p" LIKE '/docs%' THEN 'docs'
      ELSE 'other' END AS "lpt"
  FROM se
),
necv AS (
  SELECT DISTINCT ty."sid" FROM ty JOIN ${t(CRO_TABLES.cookies)} r ON r."ANONYMOUS_ID" = ty."aid"
  JOIN ${t(CRO_TABLES.customers)} cu ON cu."WORKSPACE_ID" = r."WORKSPACE_ID"
  WHERE ty."isnew" = 1 AND cu."CREATED_AT_UTC" >= ty."ts" AND cu."CREATED_AT_UTC" < ty."ts" + INTERVAL '1 day'
),
neclk AS (
  SELECT DISTINCT ty."sid", k."ID" AS "kid", CASE k."BUTTON_TYPE" WHEN 'Self-serve' THEN 'self_serve' WHEN 'Contact Form' THEN 'demo' ELSE 'other' END AS "motion",
         CASE WHEN TRIM(LOWER(k."ELEMENT_LOCATION")) = 'pricing' THEN 'pricing_cards' ELSE ${zoneCase('k."ELEMENT_LOCATION"')} END AS "zone"
  FROM ty JOIN ${t(CRO_TABLES.clicks)} k ON k."ANONYMOUS_ID" = ty."aid"
   AND k."TIMESTAMP" >= ty."ts" - INTERVAL '1 minute' AND k."TIMESTAMP" < ty."ts" + INTERVAL '1 day' AND k."TIMESTAMP" >= ${d(rlo)} - INTERVAL '1 day'
  WHERE ty."isnew" = 1
),
nesk AS (SELECT "sid", MAX(CASE WHEN "motion" = 'demo' THEN 1 ELSE 0 END) AS "dm", MAX(CASE WHEN "motion" = 'self_serve' THEN 1 ELSE 0 END) AS "ss" FROM neclk GROUP BY "sid"),
sf AS (
  SELECT rng."lbl" AS "b", ty."lpt", ty."ch", ty."dev", ty."p", ty."isnew", ty."bot",
         CASE WHEN necv."sid" IS NULL THEN 0 ELSE 1 END AS "cv", CASE WHEN nesk."sid" IS NULL THEN 0 ELSE 1 END AS "ck",
         COALESCE(nesk."dm", 0) AS "dm", COALESCE(nesk."ss", 0) AS "ss"
  FROM ty JOIN rng ON ty."day" BETWEEN rng."rs" AND rng."re"
  LEFT JOIN necv ON necv."sid" = ty."sid" LEFT JOIN nesk ON nesk."sid" = ty."sid"
)
SELECT 'pg' AS "k", CAST(pgd."day" AS string) AS "b", pgd."pg" AS "d", pgd."n", pgd."a", pgd."p", pgd."x", pgd."c", COALESCE(tr."views", 0) AS "y", 0 AS "z"
FROM pgd LEFT JOIN traffic tr ON tr."pg" = pgd."pg" AND tr."day" = pgd."day"
UNION ALL
SELECT 'hz', CAST("day" AS string), "motion" || '|' || "zone", COUNT(DISTINCT "kid"), COUNT(DISTINCT "aid"), 0, 0, 0, 0, 0
FROM ck WHERE "pg" = 'homepage' GROUP BY "day", "motion", "zone"
${(['all', 'lp', 'ch', 'dev', 'path'] as const).map(k => {
    const col = k === 'all' ? "''" : k === 'lp' ? '"lpt"' : k === 'path' ? '"p"' : `"${k}"`
    return `UNION ALL
SELECT '${k}', "b", ${col}, COUNT(*), SUM("isnew"), SUM("cv"), SUM("ck"), SUM("dm"), SUM("bot"), SUM("ss")
FROM sf GROUP BY "b"${k === 'all' ? '' : `, ${col}`}${k === 'path' ? ' HAVING SUM("isnew") >= 25' : ''}`
  }).join('\n')}
UNION ALL
SELECT 'cta', rng."lbl", neclk."zone" || '|' || neclk."motion", COUNT(DISTINCT neclk."kid"), COUNT(DISTINCT neclk."sid"), 0, 0, 0, 0, 0
FROM neclk JOIN ty ON ty."sid" = neclk."sid" JOIN rng ON ty."day" BETWEEN rng."rs" AND rng."re"
GROUP BY rng."lbl", neclk."zone", neclk."motion"`
}
