/**
 * One Sigma (Snowflake, read-only) query per view state for the Social tab.
 * Returns labelled aggregate rows; never per-person data.
 *
 * Row kinds (column k), keyed by `key` = video id | 'untagged' | 'unmapped:<campaign>' | 'affiliate':
 *   vis    distinct visitors (ANONYMOUS_ID)        b = cur | prev (calendar) | coh (video's first 28 days)
 *   ws     new workspaces (first touch) + activated ≤7d, paid, expanded, churned, tier split
 *   plan   new workspaces by current plan (column d), with paid / expanded / churned
 *   ex     existing workspaces influenced (tagged visitor's user already in a workspace before the visit), tier split
 *   form   distinct offer-page (/wedge) form submitters; campaign from the form event, else the visitor's key
 *   vday / wsday   per-day series for the trend (calendar), by key; wsday also carries activated, paid and the tier split
 *   per    new + existing workspaces by persona (d = ONBOARDING_SURVEY.TEAMS)
 *   dev / geo  visitors (n), captures (a), new workspaces (p) by device (PLATFORM) / region (TIMEZONE)
 *   mon    new workspaces by signup month (d = YYYY-MM) with activated, paid, expanded, churned
 *   b = 'bc'   back catalog: a tracked video's visits / workspaces during the dates but after its first 28 days
 *
 * Rules
 *   tagged     utm_campaign maps to a video (lookup built from descriptions), plus the channel's
 *              requireSource if set; else the channel's fallback rule (see config.ts)
 *   unmapped   utm_campaign ILIKE '<prefix>%' but in no current description: flagged, never assigned to a video
 *   untagged   YouTube referrer or utm_source, no utm_campaign, not an affiliate (Rewardful ?via=) referral; for new
 *              workspaces also governed blended YouTube attribution with a session but no video
 *   survey     new workspaces the governed blended attribution gives to YouTube from the "how did you hear about us"
 *              answer only: YouTube worked, but no creator or video can be named
 *   bots       referral visits exclude likely bots (MARKETING_IP_CRAWLER_CLASSIFICATION, no Clay user id) and other sites
 *   existing   users identified by the pageview's user id or COOKIE_TO_USER_RELATIONSHIP, roles from USER_WORKSPACE_ROLES
 *   tier       the Marketing Q4 Tier 1–3 tile's rule (lib/plg/tier.ts): CUSTOMERS.DOMAIN → live Salesforce account,
 *              best tier per domain, personal emails excluded; no Salesforce account → Untiered
 */
import { addDays, type ISODate } from '../dates'
import { ACTIVATION_DAYS, CHANNELS } from './config'
import { TIER_ACCOUNTS, tierEligible } from '../tier'
import { bot } from '../cro/sql'
import { rangeTable } from '../offline'

const T = {
  pageviews: '2a126a88-fa3d-49aa-ae05-5e830a2f3037', // DBT.PROD.MARKETING_PAGEVIEWS
  firstTouch: '8d715619-0478-4abf-ba37-20a7a7045aa9', // DBT.PROD.FIRST_TOUCH_ATTRIBUTION
  blended: 'b9625c73-5094-4b94-9c0f-034c5efccbd4',   // DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION (activation, paid)
  customers: '7821001c-903e-47e1-9f1d-a03f2a5ca9ae', // DBT.PROD.CUSTOMERS
  accounts: TIER_ACCOUNTS,                          // FIVETRAN.SALESFORCE.ACCOUNT (lib/plg/tier.ts, the Marketing tile's rule)
  credits: '990653ed-fe9f-4d3c-a674-f4278de7049f',   // DBT.PROD.CREDIT_PACK_INVOICES
  forms: '794d9f65-d34c-4173-94d1-1b0709c1b040',     // SEGMENT.VERCEL.FORM_SUBMITTED (offer page captures)
  survey: '49872add-0b3c-4321-8746-f67ec6cf5510',    // DBT.PROD.ONBOARDING_SURVEY (persona = TEAMS)
  cookies: '22e14a56-e32f-4d31-aff8-b6bc3b23190b',   // DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP
  crawler: '08b06a57-54a4-42dc-aa3c-d6222a15b09a',   // DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION (bot rule)
  sessions: 'cf3c596b-2dde-415a-b248-efda79af9fa3',  // DBT.PROD.MARKETING_WEBSITE_SESSIONS (campaign of a blended YouTube session)
  cookieUsers: '62d723b6-0db1-4a76-903b-1c91792245fc', // DBT.PROD.COOKIE_TO_USER_RELATIONSHIP
  workspaceRoles: '0738c7c9-b1f4-4198-ba15-0cbec48fb14f', // DBT.PROD.USER_WORKSPACE_ROLES
}

/** Device from the pageview's OS. iOS is not reported by this source, so it lands in Unknown. */
export const DEVICE_SQL = (col: string) => `CASE WHEN ${col} IN ('macOS', 'Windows', 'Linux', 'Chrome OS') THEN 'Desktop' WHEN ${col} IN ('Android', 'iOS', 'iPadOS') THEN 'Mobile' ELSE 'Unknown' END`
const US_TZ = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'America/Detroit', 'America/Boise', 'America/Juneau', 'Pacific/Honolulu']
const CA_TZ = ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns', 'America/Regina', 'America/Montreal', 'America/Moncton']
/** Region from the browser timezone (a proxy for geo; no IP lookup). */
export const REGION_SQL = (col: string) => `CASE WHEN ${col} IN (${[...US_TZ, ...CA_TZ].map(z => `'${z}'`).join(', ')}) OR ${col} LIKE 'America/Indiana/%' OR ${col} LIKE 'America/Kentucky/%' OR ${col} LIKE 'America/North_Dakota/%' THEN 'US & Canada'
    WHEN ${col} LIKE 'America/%' THEN 'Latin America' WHEN ${col} LIKE 'Europe/%' THEN 'UK & Europe'
    WHEN ${col} LIKE 'Asia/%' OR ${col} LIKE 'Australia/%' OR ${col} LIKE 'Pacific/%' THEN 'Asia-Pacific'
    WHEN ${col} LIKE 'Africa/%' OR ${col} LIKE 'Atlantic/%' OR ${col} LIKE 'Indian/%' THEN 'Rest of world' ELSE 'Unknown' END`
const t = (id: string) => `"connection"."${id}"`
const d = (x: ISODate) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Error(`bad date ${x}`)
  return `DATE '${x}'`
}
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

export interface TaggedVideo { videoId: string; campaign: string; cohortStart: ISODate; cohortEnd: ISODate; requireSource: string | null }
/** Channel-level rule for traffic whose campaign Snowflake lost; `key` is a video id or 'ch:<channel>'. */
export interface ChannelFallback { key: string; cohortStart: ISODate; cohortEnd: ISODate; pageview: string; firstTouch: string }
export interface SocialQuery {
  cur: [ISODate, ISODate]
  prev: [ISODate, ISODate]
  /** Videos whose description link carries a utm_campaign (from the YouTube sync). */
  tagged: TaggedVideo[]
  fallbacks: ChannelFallback[]
  /**
   * Saved-copy mode (lib/plg/offline.ts): instead of cur/prev, every row is computed for each of these ranges and its
   * bucket column holds the range label ("<start>~<end>"); back-catalog rows hold "bc@<label>". cur/prev are ignored.
   */
  ranges?: [ISODate, ISODate][]
}

export function socialSql(q: SocialQuery): string {
  const multi = q.ranges?.length ? q.ranges : null
  const dates = [...(multi ? multi.flat() : [q.cur[0], q.cur[1], q.prev[0], q.prev[1]]), ...q.tagged.flatMap(v => [v.cohortStart, v.cohortEnd]), ...q.fallbacks.flatMap(f => [f.cohortStart, f.cohortEnd])].sort()
  const lo = dates[0]; const hi = dates[dates.length - 1]
  const bucket = (col: string) => multi ? '"rlbl"'
    : `CASE WHEN ${col} BETWEEN ${d(q.cur[0])} AND ${d(q.cur[1])} THEN 'cur' WHEN ${col} BETWEEN ${d(q.prev[0])} AND ${d(q.prev[1])} THEN 'prev' END`
  // Saved-copy mode: each source joined to the range table, one copy of a row per range its day falls in.
  const R = (src: string) => (multi ? `${src}_r` : src)
  const multiCtes = !multi ? '' : `,
rng AS (${rangeTable(multi)}),
${['pv', 'fs2', 'fx', 'exx', 'pw', 'cutv'].map(x => `${x}_r AS (SELECT ${x}.*, rng."lbl" AS "rlbl" FROM ${x} JOIN rng ON ${x}."day" BETWEEN rng."rs" AND rng."re")`).join(',\n')}`
  const prefixes = CHANNELS.map(c => c.campaignPrefix).filter(Boolean) as string[]
  const prefixMatch = (col: string) => prefixes.length ? `(${prefixes.map(p => `${col} LIKE ${lit(`${p}%`)}`).join(' OR ')})` : 'FALSE'
  // Lookup table; a sentinel row keeps the CTE valid when no video is tagged.
  const vmap = [...q.tagged, { videoId: '__none__', campaign: '__none__', cohortStart: '1970-01-01', cohortEnd: '1970-01-01', requireSource: null }]
    .map(v => `SELECT ${lit(v.campaign.toLowerCase())} AS "camp", ${lit(v.videoId)} AS "vid", ${d(v.cohortStart)} AS "cs", ${d(v.cohortEnd)} AS "ce", ${lit(v.requireSource ?? '')} AS "src"`)
    .join(' UNION ALL ')
  // Channel fallbacks: key + cohort window when the per-video campaign match fails.
  const fb = (alias: 'p' | 'f') => q.fallbacks.map(f => ({ ...f, pred: alias === 'p' ? f.pageview : f.firstTouch }))
  const fbKey = (alias: 'p' | 'f') => fb(alias).map(f => `WHEN ${f.pred} THEN ${lit(f.key)}`).join(' ')
  const fbWin = (alias: 'p' | 'f', which: 'cohortStart' | 'cohortEnd') => fb(alias).map(f => `WHEN ${f.pred} THEN ${d(f[which])}`).join(' ')
  const fbAny = (alias: 'p' | 'f') => fb(alias).length ? fb(alias).map(f => f.pred).join(' OR ') : 'FALSE'
  const tierCols = ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'Untiered']
    .map((tn, i) => `SUM(CASE WHEN "tier" = '${tn}' THEN 1 ELSE 0 END) AS "t${i + 1}"`).join(', ')
  const zeroT = `0 AS "x", 0 AS "c", 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"`
  const keyExpr = (camp: string, alias: 'p' | 'f') => `CASE WHEN vm."vid" IS NOT NULL THEN vm."vid" ${fbKey(alias)}
              WHEN ${camp} <> '' AND ${prefixMatch(camp)} THEN 'unmapped:' || ${camp}
              WHEN ${camp} = '' THEN 'untagged' ELSE 'other' END`

  return `WITH vmap AS (${vmap}),
pv AS (
  SELECT p."ANONYMOUS_ID" AS "aid", p."USER_ID" AS "uid", p."TIMESTAMP_UTC" AS "ts", CAST(p."TIMESTAMP_UTC" AS date) AS "day",
         ${DEVICE_SQL('p."PLATFORM"')} AS "dev", ${REGION_SQL('p."TIMEZONE"')} AS "geo",
         CASE ${q.fallbacks.length ? fb('p').map(f => `WHEN ${f.pred} THEN ${lit(f.key)}`).join(' ') : ''} WHEN p."REFERRER" = 'affiliate' AND TRIM(COALESCE(p."UTM_CAMPAIGN", '')) = '' THEN 'affiliate'
              ELSE ${keyExpr(`LOWER(TRIM(COALESCE(p."UTM_CAMPAIGN", '')))`, 'p')} END AS "key",
         COALESCE(vm."cs", CASE ${fbWin('p', 'cohortStart') || 'WHEN FALSE THEN NULL'} END) AS "cs",
         COALESCE(vm."ce", CASE ${fbWin('p', 'cohortEnd') || 'WHEN FALSE THEN NULL'} END) AS "ce"
  FROM ${t(T.pageviews)} p
  LEFT JOIN vmap vm ON vm."camp" = LOWER(TRIM(COALESCE(p."UTM_CAMPAIGN", ''))) AND (vm."src" = '' OR p."UTM_SOURCE" ILIKE '%' || vm."src" || '%')
  LEFT JOIN ${t(T.crawler)} bc ON bc."IP_ADDRESS" = p."IP_ADDRESS"
  WHERE CAST(p."TIMESTAMP_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND p."SITE" = 'marketing_website' AND NOT ${bot('bc."BINARY_BOT_EXCLUSION"', 'p."USER_ID"')}
    AND (p."REFERRER_RAW" ILIKE '%youtu%' OR p."UTM_SOURCE" ILIKE '%youtu%' OR vm."vid" IS NOT NULL OR ${fbAny('p')})
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
  SELECT cu."wid", CASE WHEN ${tierEligible('cu."seg"')} AND acct."tier" IS NOT NULL THEN acct."tier" ELSE 'Untiered' END AS "tier"
  FROM cu LEFT JOIN acct ON acct."dom" = cu."dom"
),
ft0 AS (
  SELECT f."WORKSPACE_ID" AS "wid", CAST(f."CREATED_AT_UTC" AS date) AS "day",
         ${keyExpr(`LOWER(TRIM(COALESCE(f."UTM_CAMPAIGN", '')))`, 'f')} AS "key",
         COALESCE(vm."cs", CASE ${fbWin('f', 'cohortStart') || 'WHEN FALSE THEN NULL'} END) AS "cs",
         COALESCE(vm."ce", CASE ${fbWin('f', 'cohortEnd') || 'WHEN FALSE THEN NULL'} END) AS "ce"
  FROM ${t(T.firstTouch)} f
  LEFT JOIN vmap vm ON vm."camp" = LOWER(TRIM(COALESCE(f."UTM_CAMPAIGN", ''))) AND (vm."src" = '' OR f."UTM_SOURCE" ILIKE '%' || vm."src" || '%')
  WHERE CAST(f."CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
    AND (f."UTM_SOURCE" ILIKE '%youtu%' OR f."RAW_REFERRER" ILIKE '%youtu%' OR f."REFERRER" ILIKE '%youtu%' OR vm."vid" IS NOT NULL OR ${fbAny('f')})
    AND (COALESCE(f."CHANNEL", '') <> 'Affiliate' OR ${fbAny('f')})
),
yb AS (
  SELECT b."WORKSPACE_ID" AS "wid", CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) AS "day", b."BLENDED_ATTRIBUTION_MECHANISM" AS "mech",
         LOWER(TRIM(COALESCE(s."UTM_CAMPAIGN", ''))) AS "camp", s."UTM_SOURCE" AS "src"
  FROM ${t(T.blended)} b LEFT JOIN ${t(T.sessions)} s ON s."SESSION_ID" = b."SESSION_ID"
  WHERE b."ATTRIBUTION_WINDOW" = '90_days' AND b."ATTRIBUTION_TYPE" = 'first_touch' AND LOWER(b."BLENDED_ATTRIBUTION_PLATFORM") = 'youtube'
    AND CAST(b."WORKSPACE_CREATED_AT_UTC" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
),
yk AS (
  SELECT yb."wid", yb."day",
         CASE WHEN vm."vid" IS NOT NULL THEN vm."vid"
              WHEN yb."camp" <> '' AND ${prefixMatch('yb."camp"')} THEN 'unmapped:' || yb."camp"
              WHEN yb."mech" = 'session' THEN 'untagged' ELSE 'survey' END AS "key",
         vm."cs", vm."ce"
  FROM yb LEFT JOIN vmap vm ON vm."camp" = yb."camp" AND (vm."src" = '' OR yb."src" ILIKE '%' || vm."src" || '%')
),
ft AS (
  SELECT * FROM ft0
  UNION ALL
  SELECT yk.* FROM yk LEFT JOIN ft0 ON ft0."wid" = yk."wid" WHERE ft0."wid" IS NULL
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
fsub AS (
  SELECT f."ANONYMOUS_ID" AS "aid", CAST(f."TIMESTAMP" AS date) AS "day",
         COALESCE(vf."vid", pk."key") AS "key", COALESCE(vf."cs", pk."cs") AS "cs", COALESCE(vf."ce", pk."ce") AS "ce"
  FROM ${t(T.forms)} f
  LEFT JOIN vmap vf ON vf."camp" = LOWER(COALESCE(f."CONTEXT_CAMPAIGN_NAME", ''))
  LEFT JOIN (SELECT "aid", MIN("key") AS "key", MIN("cs") AS "cs", MIN("ce") AS "ce" FROM pv WHERE "cs" IS NOT NULL GROUP BY "aid") pk ON pk."aid" = f."ANONYMOUS_ID"
  WHERE f."CONTEXT_PAGE_PATH" ILIKE '/wedge%' AND CAST(f."TIMESTAMP" AS date) BETWEEN ${d(lo)} AND ${d(hi)}
),
fs2 AS (SELECT * FROM fsub WHERE "key" IS NOT NULL),
tv AS (
  SELECT COALESCE(NULLIF(pv."uid", ''), cu2."USER_ID") AS "uid", pv."key", pv."cs", pv."ce", pv."day", pv."ts"
  FROM pv LEFT JOIN ${t(T.cookieUsers)} cu2 ON cu2."ANONYMOUS_ID" = pv."aid" AND NULLIF(pv."uid", '') IS NULL
  WHERE pv."cs" IS NOT NULL AND COALESCE(NULLIF(pv."uid", ''), cu2."USER_ID") IS NOT NULL
),
exw AS (
  SELECT DISTINCT tv."key", tv."day", tv."cs", tv."ce", CAST(r."WORKSPACE_ID" AS integer) AS "wid"
  FROM tv JOIN ${t(T.workspaceRoles)} r
    ON CAST(r."USER_ID" AS string) = tv."uid" AND r."DELETED_AT_UTC" IS NULL AND r."CREATED_AT_UTC" < tv."ts"
),
exx AS (SELECT exw.*, COALESCE(wt."tier", 'Untiered') AS "tier" FROM exw LEFT JOIN wtier wt ON wt."wid" = exw."wid"),
sv AS (SELECT "WORKSPACE_ID" AS "wid", MIN("TEAMS") AS "team" FROM ${t(T.survey)} WHERE "TEAMS" IS NOT NULL AND "TEAMS" <> '' GROUP BY "WORKSPACE_ID"),
pw AS (
  SELECT x."wid", x."key", x."day", x."cs", x."ce", COALESCE(sv."team", 'No answer') AS "team"
  FROM (SELECT "wid", "key", "day", "cs", "ce" FROM fx UNION ALL SELECT "wid", "key", "day", "cs", "ce" FROM exx) x
  LEFT JOIN sv ON sv."wid" = CAST(x."wid" AS string)
),
pva AS (SELECT "aid", "key", MIN("dev") AS "dev", MIN("geo") AS "geo" FROM pv GROUP BY "aid", "key"),
fsd AS (SELECT fs2.*, pva."dev", pva."geo" FROM fs2 LEFT JOIN pva ON pva."aid" = fs2."aid" AND pva."key" = fs2."key"),
fxd AS (
  SELECT fx."wid", fx."key", fx."day", fx."cs", fx."ce", MIN(COALESCE(pva."dev", 'Unknown')) AS "dev", MIN(COALESCE(pva."geo", 'Unknown')) AS "geo"
  FROM fx LEFT JOIN ${t(T.cookies)} ck ON ck."WORKSPACE_ID" = fx."wid"
  LEFT JOIN pva ON pva."aid" = ck."ANONYMOUS_ID" AND pva."key" = fx."key"
  GROUP BY fx."wid", fx."key", fx."day", fx."cs", fx."ce"
),
cutv AS (
  SELECT 'v' AS "m", "aid" AS "id", "key", "day", "cs", "ce", "dev", "geo" FROM pv
  UNION ALL SELECT 'f', "aid", "key", "day", "cs", "ce", COALESCE("dev", 'Unknown'), COALESCE("geo", 'Unknown') FROM fsd
  UNION ALL SELECT 'w', CAST("wid" AS string), "key", "day", "cs", "ce", "dev", "geo" FROM fxd
)${multiCtes}
SELECT 'vis' AS "k", ${bucket('"day"')} AS "b", "key", '' AS "d", COUNT(DISTINCT "aid") AS "n", 0 AS "a", 0 AS "p", ${zeroT}
FROM ${R('pv')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'vis', 'coh', "key", '', COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM pv WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key"
UNION ALL
SELECT 'vday', '', "key", CAST("day" AS string), COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM ${R('pv')} WHERE ${bucket('"day"')} IS NOT NULL AND ("cs" IS NOT NULL OR "key" = 'untagged')
GROUP BY "key", "day"
UNION ALL
SELECT 'form', ${bucket('"day"')}, "key", '', COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM ${R('fs2')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'form', 'coh', "key", '', COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM fs2 WHERE "day" BETWEEN "cs" AND "ce" GROUP BY "key"
UNION ALL
SELECT 'ws', ${bucket('"day"')}, "key", '', COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM ${R('fx')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'ws', 'coh', "key", '', COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM fx WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key"
UNION ALL
SELECT 'plan', ${bucket('"day"')}, "key", "plan", COUNT(DISTINCT "wid"), 0, SUM("paid"), SUM("exp"), SUM("churn"), 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"
FROM ${R('fx')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key", "plan"
UNION ALL
SELECT 'plan', 'coh', "key", "plan", COUNT(DISTINCT "wid"), 0, SUM("paid"), SUM("exp"), SUM("churn"), 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"
FROM fx WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key", "plan"
UNION ALL
SELECT 'wsday', '', "key", CAST("day" AS string), COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM ${R('fx')} WHERE ${bucket('"day"')} IS NOT NULL AND ("cs" IS NOT NULL OR "key" = 'untagged')
GROUP BY "key", "day"
UNION ALL
SELECT 'ex', ${bucket('"day"')}, "key", '', COUNT(DISTINCT "wid"), 0, 0, 0, 0, ${tierCols}
FROM ${R('exx')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key"
UNION ALL
SELECT 'ex', 'coh', "key", '', COUNT(DISTINCT "wid"), 0, 0, 0, 0, ${tierCols}
FROM exx WHERE "day" BETWEEN "cs" AND "ce" GROUP BY "key"
UNION ALL
SELECT 'per', ${bucket('"day"')}, "key", "team", COUNT(DISTINCT "wid"), 0, 0, ${zeroT}
FROM ${R('pw')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key", "team"
UNION ALL
SELECT 'per', 'coh', "key", "team", COUNT(DISTINCT "wid"), 0, 0, ${zeroT}
FROM pw WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key", "team"
${(['dev', 'geo'] as const).map(c => `UNION ALL
SELECT '${c}', ${bucket('"day"')}, "key", "${c}", COUNT(DISTINCT CASE WHEN "m" = 'v' THEN "id" END), COUNT(DISTINCT CASE WHEN "m" = 'f' THEN "id" END), COUNT(DISTINCT CASE WHEN "m" = 'w' THEN "id" END), ${zeroT}
FROM ${R('cutv')} WHERE ${bucket('"day"')} IS NOT NULL AND ("cs" IS NOT NULL OR "key" = 'untagged') GROUP BY ${bucket('"day"')}, "key", "${c}"
UNION ALL
SELECT '${c}', 'coh', "key", "${c}", COUNT(DISTINCT CASE WHEN "m" = 'v' THEN "id" END), COUNT(DISTINCT CASE WHEN "m" = 'f' THEN "id" END), COUNT(DISTINCT CASE WHEN "m" = 'w' THEN "id" END), ${zeroT}
FROM cutv WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key", "${c}"`).join('\n')}
UNION ALL
SELECT 'mon', ${bucket('"day"')}, "key", SUBSTR(CAST("day" AS string), 1, 7), COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"
FROM ${R('fx')} WHERE ${bucket('"day"')} IS NOT NULL GROUP BY ${bucket('"day"')}, "key", SUBSTR(CAST("day" AS string), 1, 7)
UNION ALL
SELECT 'mon', 'coh', "key", SUBSTR(CAST("day" AS string), 1, 7), COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), 0 AS "t1", 0 AS "t2", 0 AS "t3", 0 AS "t4", 0 AS "t5"
FROM fx WHERE "cs" IS NOT NULL AND "day" BETWEEN "cs" AND "ce" GROUP BY "key", SUBSTR(CAST("day" AS string), 1, 7)
UNION ALL
${multi ? `SELECT 'vis', 'bc@' || "rlbl", "key", '', COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM pv_r WHERE "cs" IS NOT NULL AND "day" > "ce" GROUP BY "rlbl", "key"` : `SELECT 'vis', 'bc', "key", '', COUNT(DISTINCT "aid"), 0, 0, ${zeroT}
FROM pv WHERE "cs" IS NOT NULL AND "day" > "ce" AND "day" BETWEEN ${d(q.cur[0])} AND ${d(q.cur[1])} GROUP BY "key"`}
UNION ALL
${multi ? `SELECT 'ws', 'bc@' || "rlbl", "key", '', COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM fx_r WHERE "cs" IS NOT NULL AND "day" > "ce" GROUP BY "rlbl", "key"` : `SELECT 'ws', 'bc', "key", '', COUNT(DISTINCT "wid"), SUM("act"), SUM("paid"), SUM("exp"), SUM("churn"), ${tierCols}
FROM fx WHERE "cs" IS NOT NULL AND "day" > "ce" AND "day" BETWEEN ${d(q.cur[0])} AND ${d(q.cur[1])} GROUP BY "key"`}`
}

/** Window helper: a video's first COHORT_DAYS days, capped at the last complete data day. */
export function cohortWindow(published: ISODate, days: number, dataEnd: ISODate): [ISODate, ISODate] {
  const end = addDays(published, days - 1)
  return [published, end < dataEnd ? end : dataEnd]
}
