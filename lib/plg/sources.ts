/**
 * What each dashboard tab is built from, for the collapsed "Sources and SQL" panel at the bottom of every tab.
 * Queries are the exact SQL the page runs for the current filters (Sigma connection SQL), plus a Snowflake version
 * with Sigma's table references swapped for warehouse paths, so anyone with Snowflake access can rerun them.
 */

/** Sigma table ids on the Snowflake connection → warehouse path. */
export const TABLES: Record<string, string> = {
  'b9625c73-5094-4b94-9c0f-034c5efccbd4': 'DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION',
  'fc12f388-0a8f-4213-9af1-e4575ddf79e6': 'DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION_METRICS',
  '7821001c-903e-47e1-9f1d-a03f2a5ca9ae': 'DBT.PROD.CUSTOMERS',
  'e6443e27-6d72-4dd5-b511-94aba9cab915': 'FIVETRAN.SALESFORCE.ACCOUNT',
  'c5f1715b-69c1-4033-ad5c-8281a21d2cd5': 'DBT.STAGING.STG_SALESFORCE__ACCOUNT',
  '2a126a88-fa3d-49aa-ae05-5e830a2f3037': 'DBT.PROD.MARKETING_PAGEVIEWS',
  '8d715619-0478-4abf-ba37-20a7a7045aa9': 'DBT.PROD.FIRST_TOUCH_ATTRIBUTION',
  '22e14a56-e32f-4d31-aff8-b6bc3b23190b': 'DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP',
  '49872add-0b3c-4321-8746-f67ec6cf5510': 'DBT.PROD.ONBOARDING_SURVEY',
  '794d9f65-d34c-4173-94d1-1b0709c1b040': 'SEGMENT.VERCEL.FORM_SUBMITTED',
  '990653ed-fe9f-4d3c-a674-f4278de7049f': 'DBT.PROD.CREDIT_PACK_INVOICES',
  'a7defd23-614d-4c68-ad31-b807b7a164b0': 'FIVETRAN.AURORA_POSTGRES_CLAY_ADMIN.USER_ROLES',
  '4d8a7488-9cde-4f4f-b451-a712f4e83183': 'DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL',
  '9a9c17db-c29f-4516-888d-02b939ae202c': 'DBT.PROD.INT_OPPORTUNITY_SOURCE_TOUCHPOINT_MAP',
  '08b06a57-54a4-42dc-aa3c-d6222a15b09a': 'DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION',
  '97cf52d9-8523-4af4-a02e-b8e8d8019b28': 'SEGMENT.MARKETING_WEBSITE.CONVERSION_BUTTON_CLICKED',
  'cf3c596b-2dde-415a-b248-efda79af9fa3': 'DBT.PROD.MARKETING_WEBSITE_SESSIONS',
}

/** Sigma connection SQL → Snowflake SQL: warehouse table paths, and Snowflake's DATEADD for Sigma's DATE_ADD. */
export function toSnowflake(sql: string): string {
  return sql
    .replace(/"connection"\."([0-9a-f-]{36})"/g, (m, id: string) => TABLES[id] ?? m)
    .replace(/\bDATE_ADD\(/g, 'DATEADD(')
}

/** Tables a query reads, by warehouse path. */
export function tablesIn(sql: string): string[] {
  return [...new Set([...sql.matchAll(/"connection"\."([0-9a-f-]{36})"/g)].map(m => TABLES[m[1]] ?? m[1]))]
}

export type Source = { name: string; where: string; what: string }
export type SourceQuery = { label: string; sql: string; note?: string }
export type TabSources = { sources: Source[]; queries: SourceQuery[]; notes?: string[] }

const SIGMA_NOTE = 'Runs through the Clay Sigma connector (Snowflake connection 2d269863…). The Snowflake version swaps Sigma’s table ids for warehouse paths.'

const SLG_NOTE = 'S1, S2 and pipeline use the SLG Team Pulse definitions on the same dbt model (Sales KPI Dashboard → Marketing → Sales Funnel): S1 dated by LEAST(S1, S2) for S2 opps, S2 by the S2 enter date, pipeline = current amount; touchpoints since 2025-01-01; team = every channel except Partner Referral and Sales Outbound.'

export function workspacesSources(sql: string | null, latest: string, slg: string | null = null): TabSources {
  return {
    sources: [
      { name: 'New workspaces, channel, quality, activation', where: 'DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION', what: '90-day window, first-touch attribution; one row per workspace' },
      { name: 'Latest complete day', where: 'DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION_METRICS', what: 'Day rows with CURRENT_TIME_PERIOD_FLAG = 0' },
      { name: 'Workspace domain and first invoice', where: 'DBT.PROD.CUSTOMERS', what: 'Domain → Salesforce tier; FIRST_INVOICE_UTC for new paid (FIRST_GTM_MOTION = PLG)' },
      { name: 'Sales tier', where: 'FIVETRAN.SALESFORCE.ACCOUNT', what: 'SALES_TIER_C by DOMAIN_C, live accounts, best tier per domain' },
      { name: 'Visitors', where: 'DBT.PROD.MARKETING_PAGEVIEWS', what: 'Distinct ANONYMOUS_ID on marketing_website + signup, excluding UTC and Asia/* time zones' },
      { name: 'PLG-sourced S1, S2, pipeline', where: 'DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL', what: 'SLG Team Pulse base; sourcing touchpoint is a GTM Play HRE on a PLG play campaign (lib/plg/slg/sql.ts PLG_PLAYS)' },
    ],
    queries: [
      ...(sql ? [{ label: 'Dashboard query (current filters)', sql, note: SIGMA_NOTE }] : []),
      ...(slg ? [{ label: 'PLG-sourced pipeline (current filters)', sql: slg, note: SLG_NOTE }] : []),
      { label: 'Latest complete day', sql: latest },
    ],
  }
}

export function socialSources(sql: string | null): TabSources {
  return {
    sources: [
      { name: 'Views, watch time', where: 'YouTube Analytics API v2 (reports, per channel and per video)', what: 'Daily; needs the channel owner’s sign-in or Viewer access' },
      { name: 'Impressions, thumbnail clicks', where: 'YouTube Reporting API, channel_reach_basic_a1', what: 'Daily files about 1–2 days late; thumbnail clicks = impressions × video_thumbnail_impressions_ctr' },
      { name: 'Videos, links, thumbnails', where: 'YouTube Data API v3 (channels, playlistItems, videos)', what: 'Descriptions are parsed for clay.com links; utm_campaign maps a visit to a video' },
      { name: 'Referral visits', where: 'DBT.PROD.MARKETING_PAGEVIEWS', what: 'YouTube referrer or utm_source; campaign → video; creator fallbacks in lib/plg/social/config.ts' },
      { name: 'New workspaces', where: 'DBT.PROD.FIRST_TOUCH_ATTRIBUTION', what: 'First-touch campaign → video' },
      { name: 'Activated, paid, expanded, churned', where: 'DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION, DBT.PROD.CUSTOMERS, DBT.PROD.CREDIT_PACK_INVOICES', what: 'Activated = first table within 7 days' },
      { name: 'Tier', where: 'DBT.STAGING.STG_SALESFORCE__ACCOUNT', what: 'SALES_TIER_C, business domains only' },
      { name: 'Email captures', where: 'SEGMENT.VERCEL.FORM_SUBMITTED', what: 'Offer-page (/wedge) form submits' },
      { name: 'Existing workspaces, persona, device', where: 'FIVETRAN.AURORA_POSTGRES_CLAY_ADMIN.USER_ROLES, DBT.PROD.ONBOARDING_SURVEY, DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP', what: '' },
    ],
    queries: sql ? [{ label: 'Media properties query (current filters)', sql, note: `${SIGMA_NOTE} The video → campaign lookup (vmap) is built from the YouTube sync, so it changes when descriptions change.` }] : [],
    notes: ['YouTube numbers come from scripts/sync-youtube.mjs (daily), stored in this dashboard’s database (collection youtube).'],
  }
}

export function startupSources(sql: string | null): TabSources {
  return {
    sources: [
      { name: 'Startup page visits', where: 'DBT.PROD.MARKETING_PAGEVIEWS', what: 'marketing_website, /clay-for-startups (and /fr/); paid platform from click ids and utm_medium' },
      { name: 'Visitor → workspace', where: 'DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP', what: 'Visitors with at most 3 workspaces; created within 30 days of the first visit' },
      { name: 'Domain, first invoice, current customer', where: 'DBT.PROD.CUSTOMERS', what: 'Clay’s own domains excluded' },
      { name: 'Tier (MQALs)', where: 'DBT.STAGING.STG_SALESFORCE__ACCOUNT', what: 'Tier 1–3 company domains among new workspaces' },
      { name: 'Activation', where: 'DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION', what: 'First table within 7 days' },
    ],
    queries: sql ? [{ label: 'Startup program query (current filters)', sql, note: SIGMA_NOTE }] : [],
  }
}

export function croSources(sql: string | null): TabSources {
  return {
    sources: [
      { name: 'Entry sessions, landing page, channel, device', where: 'DBT.PROD.MARKETING_WEBSITE_SESSIONS', what: 'First-ever session per cookie (SESSION_ASC_RANKER = 1); WORKSPACE_STATUS = no existing workspace' },
      { name: 'Homepage and pricing first views', where: 'DBT.PROD.MARKETING_PAGEVIEWS', what: 'site marketing_website, path / and /pricing, first-ever view per cookie since 2023' },
      { name: 'Bot filter', where: 'DBT.PROD.MARKETING_IP_CRAWLER_CLASSIFICATION', what: 'BINARY_BOT_EXCLUSION = 1 and no Clay (numeric) user id' },
      { name: 'Visitor → workspace', where: 'DBT.PROD.COOKIE_TO_WORKSPACE_RELATIONSHIP, DBT.PROD.CUSTOMERS', what: 'Workspace created within 24 hours of the first visit; prior workspace = FIRST_SEEN before it' },
      { name: 'CTA clicks', where: 'SEGMENT.MARKETING_WEBSITE.CONVERSION_BUTTON_CLICKED', what: 'BUTTON_TYPE Self-serve | Contact Form; ELEMENT_LOCATION → zone; 1 minute before to 24 hours after' },
    ],
    queries: sql ? [{ label: 'CRO query (current filters)', sql, note: 'Definitions from monty (Clay’s data analyst agent), growth-marketing landing-page playbook. ' + SIGMA_NOTE }] : [],
    notes: ['The homepage launch date (2026-06-23, about 15:00 UTC) comes from the hero button ids switching in the click data; there is no deploy event in the warehouse.',
      'The dbt model DBT.PROD.CONVERSION_BUTTON_CLICKED is not in Sigma, so the page reads its Segment source; counts can differ slightly where the model dedupes.'],
  }
}

export function tier4Sources(agg: string | null, list: string | null): TabSources {
  return {
    sources: [
      { name: 'Tier 4 hand-raisers', where: 'DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL', what: 'SLG touchpoints where ACCOUNT_SALES_TIER (point-in-time) = Tier 4; aggregator accounts excluded' },
      { name: 'Re-tiered', where: 'DBT.PROD.INT_SLG_TOUCHPOINT_FUNNEL_DETAIL', what: 'ACCOUNT_SALES_TIER_CURRENT is Tier 1–3 today' },
      { name: 'Workspace, activation, paying, ARR, usage', where: 'DBT.PROD.CUSTOMERS', what: 'Work-domain workspaces (segment other) on the account domain; Clay’s own domains excluded' },
      { name: 'Reached S2', where: 'DBT.PROD.INT_OPPORTUNITY_SOURCE_TOUCHPOINT_MAP', what: 'Any new-business opp on the account that entered S2 after the first Tier 4 touchpoint' },
    ],
    queries: [
      ...(agg ? [{ label: 'Movement, touchpoint types, monthly cohorts (current filters)', sql: agg, note: SIGMA_NOTE }] : []),
      ...(list ? [{ label: 'Accounts to nurture (last 180 days)', sql: list, note: 'Company-level fields only; no contacts.' }] : []),
    ],
    notes: ['Point-in-time tiers come from Salesforce account snapshots that start around February 2026, so monthly cohorts start in April 2026.'],
  }
}

export function portfolioSources(): TabSources {
  const views = ['firms', 'roster', 'companies', 'company_status', 'snapshots', 'snapshot_companies', 'firm_penetration', 'portfolio_totals', 'source_coverage', 'source_runs']
  return {
    sources: [
      { name: 'Firms, rosters, verified companies', where: 'Supabase · schema portfolio (written by Clay workflows: Portfolio Discovery, Refresh Clay status, Publish this week)', what: 'Firm list from the Venture Partner Program sheet' },
      { name: 'Clay workspace, paying, ARR, churn', where: 'Snowflake via the Refresh Clay status workflow: DBT.PROD.CUSTOMERS, Salesforce accounts', what: 'Written into weekly snapshots' },
      { name: 'Reporting views', where: `Supabase · schema dashboard: ${views.join(', ')}`, what: 'Read through the read-key RPC public.portfolio_export; synced weekly into this dashboard (scripts/sync-portfolio.mjs)' },
    ],
    queries: [
      { label: 'Read one view (Supabase SQL editor)', sql: views.map(v => `select * from dashboard.${v};`).join('\n') },
      { label: 'Read one view (REST, with a read key)', sql: `POST /rest/v1/rpc/portfolio_export\n{"p_key": "<read key>", "p_view": "firm_penetration", "p_offset": 0, "p_limit": 1000}`,
        note: 'Pages of up to 5,000 rows; "done" is true on the last page. Read keys live in portfolio.ingest_keys.' },
    ],
    notes: ['Definitions of every view are in supabase/migrations (latest: 009_sales_tier.sql) in the clay-aeo repository.'],
  }
}
