# PLG Weekly Metrics: Workspaces tab (`/plg`)

Live version of the "New workspaces & pacing" mock. Data refreshes nightly from Snowflake.

```
Snowflake ──(Vercel cron 11:30 UTC → /api/plg/refresh)──▶ Supabase plg_* tables
                                                              │
/plg page ──fetch /api/plg/dashboard?preset=…&compare=…&grain=…┘ (RPCs, service role only)
```

## Setup (one time)

1. Run `supabase/plg_schema.sql` in the Supabase SQL editor (safe to re-run).
2. Add the Vercel env vars:
   - `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USERNAME`, `SNOWFLAKE_PRIVATE_KEY` (PEM, key-pair auth; literal `\n` is fine), optional `SNOWFLAKE_PRIVATE_KEY_PASSPHRASE`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_ROLE`. `SNOWFLAKE_PASSWORD` works instead of a key.
   - `SUPABASE_SERVICE_ROLE_KEY` (already used by `/api/refresh-cache`). The PLG data is **not** readable with the anon key.
   - `CRON_SECRET` (already set for the other crons).
3. Backfill once while signed in: `GET /api/plg/refresh?from=2025-10-01`. After that the cron re-pulls the trailing ~6 weeks every night, so late restatements flow in.

The Snowflake role needs `SELECT` on `DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION`, `DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION_METRICS`, `DBT.PROD.CUSTOMERS` and `FIVETRAN.SALESFORCE.ACCOUNT`.

## Where things live

| What | File |
|---|---|
| Quarter calendar, goals, channel groups, tier fallback, guardrail thresholds | `lib/plg/config.ts` |
| Goals override (no deploy needed) | Supabase `plg_goals` (rows win over config) |
| Snowflake SQL | `lib/plg/snowflake.ts` |
| Nightly ETL, restatement log, reconciliation | `lib/plg/etl.ts` |
| All dashboard math (pure, no I/O) | `lib/plg/compute.ts` |
| UI | `components/plg/*` |

To add Q1 2027, insert `plg_goals` rows with the new `quarter_start` / `quarter_end` (scope `quarter` / `tier` / `group`).

## Data definitions (verified against Snowflake via Sigma, Nov 2026)

- **Source**: workspace-level `FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION`, `ATTRIBUTION_WINDOW = '90_days'`, `ATTRIBUTION_TYPE = 'first_touch'`. At that grain the table labels rows `first_touch`; the metrics table labels the same rows `blended`. It reconciles exactly with the metrics table under the five required filters (Nov 2–8: 10,129 both, identical per-channel counts). The ETL re-checks this every night per day (`plg_daily_reconciliation`), and any mismatch shows in the Data quality strip.
- **Tier**: workspace → `CUSTOMERS.DOMAIN` → SFDC `ACCOUNT.DOMAIN_C` → `SALES_TIER_C` (`Tier 1`–`Tier 4`). If a domain maps to several accounts, the best tier wins. Unmatched domains (about 67% of workspaces, almost all personal email) are stored as `Unassigned` and shown as their own **Unmatched** row/column (report-only, no goal).
- **Domain quality**: `CUSTOMER_DOMAIN_QUALITY_SEGMENT`; the independent cross-check is `CUSTOMERS.CUSTOMER_DOMAIN_SEGMENT` (hover the HQ share tile).
- Pace and tier status = actual ÷ goal prorated (weekly / 7 per day) over the selected dates. Projection = QTD actual + selected-range run rate × days left in the quarter of the latest data day, rounded to 100.
- Commentary is always the last complete Mon–Sun week vs the week before, generated from movers with |Δ| ≥ 30. It describes what moved, never why.

## Local development without Supabase

`PLG_FIXTURE_PATH=/path/to/facts.json npm run dev` serves `/plg` from a JSON file of fact rows. This only works outside production, and the page shows a **FIXTURE DATA** pill. `npx tsx scripts/plg-check.ts facts.json 2026-11-02` prints the acceptance-checklist numbers for a week.

## Open items to confirm before go-live

1. ~~Quarter calendar~~ Confirmed: Q4 = Nov 1 – Jan 31.
2. **Tier source / goals.** `SALES_TIER_C` gives Tier 1/2/3/4/Unmatched = 124 / 717 / 244 / 2,237 / 6,807 for Nov 2–8. The reference was 318 / 878 / 2,428 / 6,576, so the Tier 3 (2,600/wk) and Tier 4 (7,538/wk) goals look calibrated to a different definition.
3. **Goal owner**, plus whether the illustrative goals in `plg_goals` are current.
4. **Cron time.** 11:30 UTC assumes dbt prod has finished by then.
5. Social video / Startup program tabs are placeholders.

## claude.ai artifact (live via Sigma), the recommended path

No Vercel, Supabase or Snowflake credentials needed. The page queries Snowflake through **each viewer's own Clay Sigma connector** (read-only `query` tool), so viewers need Sigma connected in claude.ai and Sigma access to the three source tables.

- Build: `node scripts/build-plg-artifact.mjs` → `dist/plg-artifact.html` (entry `artifact/plg/main.tsx`, SQL `lib/plg/sigma.ts`). Republish that file to the same artifact URL after code changes.
- Latest complete day comes from the metrics table's `CURRENT_TIME_PERIOD_FLAG` (the raw table can hold a partial day).
- Results are cached by claude.ai for up to 6 h; reopening is instant, then refreshes.
- Artifact store: `weeks/<monday>` = restatement log (written when a closed week moves >3%); `config/goals` = `{ rows: GoalRow[] }` goal overrides (editors only), same shape as `plg_goals` rows.
- Not in the artifact: the daily reconciliation against the metrics table (ETL-only).
