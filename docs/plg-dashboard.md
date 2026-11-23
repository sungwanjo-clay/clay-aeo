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
| Quarter calendar, HQ tier goals, channel groups, guardrail thresholds | `lib/plg/config.ts` |
| Goals override (no deploy needed) | Supabase `plg_goals` (rows win over config) |
| Snowflake SQL | `lib/plg/snowflake.ts` |
| Nightly ETL, restatement log, reconciliation | `lib/plg/etl.ts` |
| All dashboard math (pure, no I/O) | `lib/plg/compute.ts` |
| UI | `components/plg/*` |

The one official goal is **new workspaces from Tier 1–3 accounts**, all quality, the Marketing Q4 scoreboard's `t123_workspaces`: Q4 (Nov 1 – Jan 31) = 18,448, paced in a straight line from 0 on Nov 1 (`lib/plg/config.ts`, `target`). There are no per-tier goals and no goal on HQ workspaces. The Tier 1–3 tiles, the cumulative chart's default view, the projection and the weekly commentary all use it. To set another quarter, add a row with scope `tier13` and the quarter's target (Supabase `plg_goals`, or the artifact store doc `config/goals` = `{rows: [...]}`).

## Data definitions (verified against Snowflake via Sigma, Nov 2026)

- **Source**: workspace-level `FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION`, `ATTRIBUTION_WINDOW = '90_days'`, `ATTRIBUTION_TYPE = 'first_touch'`. At that grain the table labels rows `first_touch`; the metrics table labels the same rows `blended`. It reconciles exactly with the metrics table under the five required filters (Nov 2–8: 10,129 both, identical per-channel counts). The ETL re-checks this every night per day (`plg_daily_reconciliation`), and any mismatch shows in the Data quality strip.
- **Tier**: workspace → `CUSTOMERS.DOMAIN` → SFDC `ACCOUNT.DOMAIN_C` → `SALES_TIER_C` (`Tier 1`–`Tier 4`). If a domain maps to several accounts, the best tier wins. Unmatched domains (about 67% of workspaces, almost all personal email) are stored as `Unassigned` and shown as their own **Unmatched** row/column (report-only, no goal).
- **Domain quality**: `CUSTOMER_DOMAIN_QUALITY_SEGMENT`; the independent cross-check is `CUSTOMERS.CUSTOMER_DOMAIN_SEGMENT` (hover the HQ share tile).
- Pace = Tier 1–3 actual ÷ the quarter's target prorated evenly per day over the selected dates (the straight line). Projection = Tier 1–3 QTD actual + selected-range Tier 1–3 run rate × days left in the quarter of the latest data day, rounded to 100. Days outside a configured quarter have no goal.
- Commentary is always the last complete Mon–Sun week vs the week before, generated from movers with |Δ| ≥ 30. It describes what moved, never why.

## Local development without Supabase

`PLG_FIXTURE_PATH=/path/to/facts.json npm run dev` serves `/plg` from a JSON file of fact rows. This only works outside production, and the page shows a **FIXTURE DATA** pill. `npx tsx scripts/plg-check.ts facts.json 2026-11-02` prints the acceptance-checklist numbers for a week.

## Open items to confirm before go-live

1. ~~Quarter calendar~~ Confirmed: Q4 = Nov 1 – Jan 31.
2. ~~Goals~~ Confirmed: HQ tier goals from the Q4 PLG Planning sheet. Real Q3 HQ totals (44,946) match the sheet's Q3 pacing (45,468); per-tier splits differ somewhat (e.g. Tier 2 8,071 vs 9,606), so check the sheet used the same SFDC tier field.
4. **Cron time.** 11:30 UTC assumes dbt prod has finished by then.
5. Social video / Startup program tabs are placeholders.

## claude.ai artifact (live via Sigma), the recommended path

No Vercel, Supabase or Snowflake credentials needed. The page queries Snowflake through **each viewer's own Clay Sigma connector** (read-only `query` tool), so viewers need Sigma connected in claude.ai and Sigma access to the three source tables.

- Build: `node scripts/build-plg-artifact.mjs` → `dist/plg-artifact.html` (entry `artifact/plg/main.tsx`, SQL `lib/plg/sigma.ts`). Republish that file to the same artifact URL after code changes.
- Latest complete day comes from the metrics table's `CURRENT_TIME_PERIOD_FLAG` (the raw table can hold a partial day).
- Results are cached by claude.ai for up to 6 h; reopening is instant, then refreshes.
- Artifact store: `weeks/<monday>` = restatement log (written when a closed week moves >3%); `config/goals` = `{ rows: GoalRow[] }` goal overrides (editors only), same shape as `plg_goals` rows.
- Not in the artifact: the daily reconciliation against the metrics table (ETL-only).

## Headline tiles (MBR definitions)

1. **New workspaces:** all new workspaces, compared with the previous period.
2. **Tier 1–3 workspaces:** new workspaces at Salesforce Tier 1–3 accounts, all quality (personal emails excluded, the quarter-to-date tile's rule), compared with the previous period. Also shown against the Q4 Tier 1–3 goal (18,448), straight-line, prorated to the selected dates.
3. **Non-personal share:** non-personal is high and low quality combined; personal is shown alongside it. Both counts and shares are compared with the previous period. The remainder (spam, not yet scored) is in neither.
4. **Conversion rates:** each is compared with the previous period, in percentage points.
   - **Visitor → HQ trial user** = HQ new workspaces ÷ unique visitors. Unique visitors are distinct `ANONYMOUS_ID` on the marketing site plus signup pages in MARKETING_PAGEVIEWS, excluding UTC and Asia/* timezones.
   - **Trial → paid** = new PLG paid workspaces ÷ HQ new workspaces in the same period. New PLG paid workspaces are those with `FIRST_INVOICE_UTC` in the period and `FIRST_GTM_MOTION = 'PLG'`.
   - **Activation** = new workspaces that ran a first table within 7 days ÷ new workspaces. This one isn't in the MBR.

These match the MBR "PLG Headline Metrics" for July 2026:

| Metric | Dashboard | MBR |
|---|---|---|
| Unique visitors | 292,509 | 291,177 |
| HQ trial users | 16,551 | 16,604 |
| New paid workspaces | 1,741 | 1,737 |

Visitor counts are distinct per period, so a weekly visitor → HQ rate is lower than the monthly MBR rate: weekly uniques don't add up to monthly uniques.
