import snowflake from 'snowflake-sdk'

/**
 * Thin promise wrapper around snowflake-sdk. Server-only.
 *
 * Env:
 *   SNOWFLAKE_ACCOUNT        e.g. "abc12345.us-east-1" (account identifier)
 *   SNOWFLAKE_USERNAME       service user
 *   SNOWFLAKE_PRIVATE_KEY    PEM (key-pair auth, preferred). Literal "\n" are unescaped.
 *   SNOWFLAKE_PRIVATE_KEY_PASSPHRASE (optional)
 *   SNOWFLAKE_PASSWORD       fallback if no private key
 *   SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE (optional)
 */
export function snowflakeConfigured(): boolean {
  return !!(process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_USERNAME &&
    (process.env.SNOWFLAKE_PRIVATE_KEY || process.env.SNOWFLAKE_PASSWORD))
}

snowflake.configure({ logLevel: 'WARN' })

async function connect(): Promise<snowflake.Connection> {
  const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const conn = snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USERNAME!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    role: process.env.SNOWFLAKE_ROLE,
    database: 'DBT',
    application: 'clay-plg-dashboard',
    ...(privateKey
      ? {
          authenticator: 'SNOWFLAKE_JWT',
          privateKey,
          privateKeyPass: process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE,
        }
      : { password: process.env.SNOWFLAKE_PASSWORD }),
  })
  await conn.connectAsync()
  return conn
}

export type Row = Record<string, unknown>

function exec(conn: snowflake.Connection, sqlText: string, binds: (string | number)[]): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve((rows ?? []) as Row[])),
    })
  })
}

/** Run several queries on one connection, then close it. */
export async function withSnowflake<T>(fn: (q: (sql: string, binds?: (string | number)[]) => Promise<Row[]>) => Promise<T>): Promise<T> {
  const conn = await connect()
  try {
    // All date math in UTC so "yesterday" matches the dbt models' day boundaries.
    await exec(conn, "ALTER SESSION SET TIMEZONE = 'UTC'", [])
    return await fn((sql, binds = []) => exec(conn, sql, binds))
  } finally {
    await new Promise<void>(res => conn.destroy(() => res()))
  }
}

// ── Queries ──────────────────────────────────────────────────────────────────
// Binds: 1 = start date (inclusive, 'YYYY-MM-DD'), 2 = end date (inclusive).

/**
 * Daily fact rows at (day × channel hierarchy × SFDC sales tier × domain quality).
 *
 * Source of truth is the workspace-level blended attribution table, which
 * reconciles exactly with fct_plg_workspace_blended_attribution_metrics
 * (verified Nov 2–8 2026: 10,129 both, identical channel splits). We go
 * workspace-level because the metrics table doesn't carry tier.
 *
 * Note: at workspace level ATTRIBUTION_TYPE is 'first_touch' (the metrics
 * table labels the same rows 'blended'). PLG segment is implicit in this table.
 *
 * Tier path: workspace → dbt.prod.customers.DOMAIN → SFDC Account.DOMAIN_C →
 * SALES_TIER_C ('Tier 1'..'Tier 4'). When a domain maps to several accounts we
 * take the best (lowest) tier. No match → 'Unassigned' (bucketed in the app).
 */
export const FACTS_SQL = `
WITH ws AS (
  SELECT
    b.WORKSPACE_ID,
    b.WORKSPACE_CREATED_AT_UTC::date                          AS day,
    COALESCE(b.BLENDED_ATTRIBUTION_CHANNEL_CATEGORY, 'undefined') AS channel_category,
    COALESCE(b.BLENDED_ATTRIBUTION_CHANNEL, 'undefined')          AS channel,
    COALESCE(b.BLENDED_ATTRIBUTION_SUBCHANNEL, 'undefined')       AS subchannel,
    COALESCE(b.CUSTOMER_DOMAIN_QUALITY_SEGMENT, 'not available')  AS quality_segment
  FROM DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION b
  WHERE b.ATTRIBUTION_WINDOW = '90_days'
    AND b.ATTRIBUTION_TYPE   = 'first_touch'
    AND b.WORKSPACE_CREATED_AT_UTC::date BETWEEN ?::date AND ?::date
),
cust AS (
  SELECT WORKSPACE_ID, MIN(LOWER(DOMAIN)) AS domain
  FROM DBT.PROD.CUSTOMERS
  WHERE WORKSPACE_ID IN (SELECT WORKSPACE_ID FROM ws)
  GROUP BY 1
),
acct AS (
  SELECT LOWER(DOMAIN_C) AS domain, MIN(SALES_TIER_C) AS sales_tier
  FROM FIVETRAN.SALESFORCE.ACCOUNT
  WHERE NOT IS_DELETED AND DOMAIN_C IS NOT NULL AND SALES_TIER_C IS NOT NULL
  GROUP BY 1
)
SELECT
  TO_VARCHAR(ws.day, 'YYYY-MM-DD')          AS "day",
  ws.channel_category                       AS "channel_category",
  ws.channel                                AS "channel",
  ws.subchannel                             AS "subchannel",
  COALESCE(acct.sales_tier, 'Unassigned')   AS "sales_tier",
  ws.quality_segment                        AS "quality_segment",
  COUNT(*)                                  AS "n"
FROM ws
LEFT JOIN cust ON cust.WORKSPACE_ID = ws.WORKSPACE_ID
LEFT JOIN acct ON acct.domain = cust.domain
GROUP BY 1, 2, 3, 4, 5, 6
`

/** Daily totals from the canonical metrics table, with the five required filters. Used to reconcile. */
export const METRICS_TOTALS_SQL = `
SELECT TO_VARCHAR(TIME_PERIOD_START::date, 'YYYY-MM-DD') AS "day",
       SUM(N_CREATED_WORKSPACES)                        AS "n"
FROM DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION_METRICS
WHERE TIME_PERIOD_TYPE         = 'day'
  AND CHANNEL_HIERARCHY_LEVEL  = 'aggregate'
  AND DIMENSION_TYPE           = 'aggregate'
  AND ATTRIBUTION_TYPE         = 'blended'
  AND ATTRIBUTION_WINDOW       = '90_days'
  AND FUNNEL_GTM_SEGMENT       = 'PLG'
  AND DATE_COHORT_ANCHOR       = 'workspace_created_date'
  AND CURRENT_TIME_PERIOD_FLAG = 0
  AND TIME_PERIOD_START::date BETWEEN ?::date AND ?::date
GROUP BY 1
`

/**
 * Independent domain check from CUSTOMERS.CUSTOMER_DOMAIN_SEGMENT, which does not
 * depend on the quality-scoring job. Keyed on the workspace's creation day.
 */
export const DOMAIN_SEGMENT_SQL = `
SELECT TO_VARCHAR(b.WORKSPACE_CREATED_AT_UTC::date, 'YYYY-MM-DD') AS "day",
       CASE WHEN c.CUSTOMER_DOMAIN_SEGMENT IN ('personal', 'academic') THEN c.CUSTOMER_DOMAIN_SEGMENT
            WHEN c.CUSTOMER_DOMAIN_SEGMENT IS NULL THEN 'unknown'
            ELSE 'non_personal' END                                AS "segment",
       COUNT(DISTINCT b.WORKSPACE_ID)                              AS "n"
FROM DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION b
LEFT JOIN DBT.PROD.CUSTOMERS c ON c.WORKSPACE_ID = b.WORKSPACE_ID
WHERE b.ATTRIBUTION_WINDOW = '90_days'
  AND b.ATTRIBUTION_TYPE   = 'first_touch'
  AND b.WORKSPACE_CREATED_AT_UTC::date BETWEEN ?::date AND ?::date
GROUP BY 1, 2
`
