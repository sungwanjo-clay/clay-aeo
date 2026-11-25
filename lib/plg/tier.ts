/**
 * Sales tier of a workspace, one rule for the whole dashboard: the Marketing Q4 source-of-truth Tier 1–3 tile's
 * definition, so every Tier 1–3 number ties to it 1:1.
 *
 *   workspace → DBT.PROD.CUSTOMERS.DOMAIN (Stripe email domain) → FIVETRAN.SALESFORCE.ACCOUNT.DOMAIN_C, live accounts
 *   (IS_DELETED = false), current SALES_TIER_C, best (lowest) tier per domain. Personal (free-mail) domains never get a
 *   tier; academic and every other business domain do. No high-quality filter here (the HQ tiles add it on top).
 *
 * (DBT.STAGING.STG_SALESFORCE__ACCOUNT gives identical tiers; this table is the one the Marketing tile reads.)
 */
export const TIER_ACCOUNTS = 'e6443e27-6d72-4dd5-b511-94aba9cab915' // FIVETRAN.SALESFORCE.ACCOUNT

/** CTE body: one row per domain with its best live tier. */
export const tierAccountsSql = `SELECT LOWER("DOMAIN_C") AS "dom", MIN("SALES_TIER_C") AS "tier"
  FROM "connection"."${TIER_ACCOUNTS}"
  WHERE "IS_DELETED" = false AND "DOMAIN_C" IS NOT NULL AND "SALES_TIER_C" IS NOT NULL
  GROUP BY LOWER("DOMAIN_C")`

/** SQL condition: may this workspace carry a tier? `seg` = its CUSTOMER_DOMAIN_SEGMENT column. */
export const tierEligible = (seg: string) => `COALESCE(${seg}, '') <> 'personal'`

/** Free-mail domains: a captured email at one of these never gets a company tier (lead-magnet captures by email). */
export const PERSONAL_DOMAINS = ['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'yandex.com', 'mail.com', 'zoho.com', 'hey.com', 'fastmail.com', 'qq.com', '163.com']
