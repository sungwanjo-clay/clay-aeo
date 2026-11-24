# Portfolio routine (VC and Partners tab)

Keeps the portfolio list current without anyone running it: the firm list follows the Venture Partner Program sheet,
new firms get a baseline, every firm's companies are re-checked for workspace and paid status weekly, and every firm's
portfolio is rediscovered about once a month. Replaces the manual steps in docs/portfolio-run-status.md.

## Cadence

| When | Step | Cost (credits) |
|---|---|---|
| Every Monday | 1. Sheet check: added firms are created, removed firms hidden (history kept), returning firms listed again | 0 |
| | 2. Baseline discovery for each new or returning firm | about 400 each |
| | 3. Rolling rediscovery: the quarter of listed firms with the oldest roster (new investments, new companies) | per firm; measure before scheduling (see below) |
| | 4. Refresh Clay status for every other listed firm (workspace, paid, ARR, churn) | about 6 each |
| | 5. Publish the week (close the snapshot: freezes membership) | about 3 |
| | 6. Sync the closed week to the dashboard | 0 |

Firms on hold (clay/portfolio-discovery/routine.json `hold`: the non-investor partners) are skipped until decided.
A run that can't afford its next group stops before starting it (exit 7) and the week isn't published; the daily
health check then alerts (portfolio not synced in 8 days, no closed week since last Monday).

## Runbook (for the scheduled session)

Work in a scratch folder `W`. Never print keys. Secrets come from the environment: `CLAY_API_KEY`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `PORTFOLIO_READ_KEY`, `PORTFOLIO_SHEET_KEY`.

1. **Code.** `git fetch origin claude/affectionate-noether-v0n9id && git checkout FETCH_HEAD`, `[ -d node_modules ] || npm ci`.
2. **Credits.** `python3 -I scripts/portfolio-run.py credits`. Below 2,000: stop and report (nothing else runs).
3. **Sheet.** Google Drive connector `download_file_content`, file `1VfI608_c4N32bYMugURoUJspAlV_fagCzfc8B09DepQ`,
   `exportMimeType` `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; copy the saved file into
   `W/sheet/vpp.xlsx` (its own folder). Preview: `python3 -I scripts/portfolio-sheet-sync.py W/sheet/vpp.xlsx W/preview.json`.
   If the preview removes more than 5 firms, stop and report the names instead of applying (a renamed tab or column
   reads as mass removal). Otherwise apply: `... W/sheet/vpp.xlsx W/sheet.json --apply`.
4. **Plan.** `python3 -I scripts/portfolio-run.py plan rolling W/plan.json --sheet W/sheet.json` (until the monthly pass
   is measured and approved, use `plan weekly`: baselines for new firms + refresh for the rest).
5. **Run.** `python3 -I scripts/portfolio-run.py run discover W/plan.json W/discover.jsonl`, then
   `... run refresh W/plan.json W/refresh.jsonl`. Exit 7 (credits) or 8 (approval needed): stop, don't publish, report.
   Exit 3 (some firms failed): carry on; report them.
6. **Publish.** `python3 -I scripts/portfolio-run.py publish <this Monday, YYYY-MM-DD> W/publish.jsonl`.
7. **Sync.** `NODE_USE_ENV_PROXY=1 node scripts/sync-portfolio.mjs W/sync.json`, then write its documents with
   `ArtifactData` to https://claude.ai/artifact/R2pMQF57g3idB4EvtazAeC, collection `portfolio`: `companies-<i>` parts
   first, then `sources` and `firmrows-<i>`, then `meta` last (readers follow its counts), each pinned with `if_version`
   from a fresh `list`, in batches under 1 MB. Every document must stay under 256 KB; the sync exits 2 if one doesn't.
8. **Report** one line each: sheet (new, removed, back), discovery (complete, failed), refresh (complete, failed),
   published week and its totals (companies, with a workspace, paying, ARR), credits used and left.

## One-time setup

- Supabase: apply `supabase/migrations/010_firm_list_sync.sql` in the SQL editor; it prints `portfolio_sheet_key` once.
  Store it as the environment secret `PORTFOLIO_SHEET_KEY`.
- Clay: an API key for the routine (`clay api-keys create --name "Portfolio routine"`, or Clay settings) as
  `CLAY_API_KEY`. Its runs bill to the key's owner, so that person's monthly credit limit (or an assigned budget) must
  cover the weekly cost.
- Approvals: the first run of each routine (discover, refresh, publish) from the key asks for approval. Approve each once
  with `clay approvals approve <request id> --always-allow`; later runs don't ask.
- Routines: Discovery (`workflow:wf_0torcquSMPmUpqZUVsM`), Refresh Clay status (`workflow:wf_0torm87ruzTzETUGfjw`) and
  Publish this week (`workflow:wf_0torfb0HFxNBwqHMaT4`, registered Nov 24) are enabled for API & CLI.

## Measuring the monthly pass

Before scheduling `plan rolling`, run Discovery for 5 firms that already have a roster
(`plan firms --firms "A,B,C,D,E"`) and read each run's credits (`clay workflows runs get <workflow> <run>`:
`dataCreditsUsed` + `actionCreditsUsed`). Set `routines.discover.cost` in routine.json to the rerun average; the rolling
pass costs a quarter of the listed firms × that per week.
