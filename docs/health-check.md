# Daily data health check

Runs every morning (scheduled task "PLG dashboard: daily data health check", 7:13 AM PT), after the 5:37 AM saved-view
refresh. It needs no secrets: it reads the dashboard's own database and writes one verdict document that the page
shows as a banner on every tab.

What watches what:

| Layer | Catches | Where |
|---|---|---|
| Clay alert rules | Any failed published run of Portfolio Discovery, Refresh Clay status, Publish this week, Startup Offer Eligibility | Clay → email to the subscriber |
| This check | Saved views not refreshed (>30 h), portfolio not synced (>8 days), no closed week since last Monday, missing company documents, week-over-week drops (>10% companies or firms), >5% unknown lookups, >20% failed source runs | `config/health` + banner + push notification |
| The banner itself | The check not running for 2 days | Dashboard, every tab |

## Steps (for the scheduled session)

Artifact: https://claude.ai/artifact/R2pMQF57g3idB4EvtazAeC. Work in a scratch directory `H` outside the repo.

1. `git fetch origin claude/affectionate-noether-v0n9id && git checkout FETCH_HEAD`.
2. With the ArtifactData tool, `get` each of these with `out_dir` = `H` (files land at `H/<collection>/<doc_id>.json`):
   `cache/main`, `cache/social`, `cache/startup`, `portfolio/meta`, `portfolio/sources`.
3. Read `companyChunks` from `H/portfolio/meta.json` (n) and `get` `portfolio/companies-<n-1>` the same way.
4. `node scripts/health-check.mjs H H/health.json`.
5. `get` `config/health` (to learn its current `version`), then `set` `config/health` from `file_path` `H/health.json`
   with that `if_version` (omit it only if the document doesn't exist).
6. Finish with exactly the script's last line (`STATUS OK`, `STATUS WARN: …` or `STATUS ALERT: …`). If the status is
   not OK, add one line saying which part of the pipeline to look at (saved views → docs/cache-refresh.md; portfolio
   sync or week → the weekly cycle in docs/portfolio-run-status.md).

Rules: read only these documents; write only `config/health`; never change code, commit or push. If a `get` fails,
treat that document as missing (the script reports it) rather than stopping.
