# Testing the PLG dashboard

Four layers, cheapest first. Run all of them before publishing a new version (`DB` = a folder of downloaded artifact-db
documents: `ArtifactData list` of `cache`, `youtube`, `config` and `get` of `portfolio/meta`, `portfolio/sources` and a few
`portfolio/companies-<i>`, each with `out_dir` = `DB`).

| Layer | Command | Catches |
|---|---|---|
| Types and lint | `npx tsc --noEmit -p tsconfig.json` · `npx eslint artifact lib components` | Wiring and type errors |
| Data contracts | run by the page, `refresh-cache.mjs pack` and the health check (lib/plg/contracts.ts) | Missing ranges or rows, impossible counts (conversions above visitors), wrong shape |
| Reconciliation | `npm run test:audit -- DB/cache DB/youtube` | Tiles ≠ tables ≠ funnels ≠ What moved; parts not summing to totals (channels, devices, landing pages, video rows, tiers) |
| End to end | `npm run test:e2e -- DB` (add `--quick` for 2 presets) | Page or console errors, crashed sections, "NaN" / "undefined" / "Infinity" on screen, missing sections, on every tab × preset × comparison; plus broken saved copies (no database, corrupt part, missing part, a result breaking its contract) must show a message, not zeros |

The daily health check (docs/health-check.md) runs the contracts against the live saved copies every morning and flags
copies that are stale, partial, cover only one view, or fail their checks.

Known gaps: the queries themselves only run in Sigma (the Clay Sigma connector), so CI can't execute them; the daily
refresh is their end-to-end run, and `pack` refuses any result that fails its contract.

## Content insights (creator program)

The tab joins two sources:

- `youtube/creators` (+ `youtube/creators-thumbs-<i>`): the affiliate team's placement list, exported with
  `python3 -I scripts/creators-from-sheet.py <Influencer_Master.xlsx> <export.json>` and enriched with
  `NODE_USE_ENV_PROXY=1 node scripts/sync-creators.mjs <export.json> [preview.json]` (public YouTube metadata). Output
  goes to `dist/creators/`, which is git-ignored; store each file in the page's `youtube` collection under its file name.
  The sheet carries fees and contacts: the export script reads only the Placements and Ingest - Youtube sheets.
- the `creators` saved copy (lib/plg/creators/sql.ts), refreshed daily with the other saved views.

The weekly niche scan (docs/niche-scan.md) adds `youtube/scan` and `youtube/scan-thumbs-<i>`. On the tab:

- **Make next** lists up to 15 ideas, one per topic (theme + subject, lib/plg/creators/compute.ts `recommend`): working
  title, topic, median views vs channel, our signups where we've made it, trend. A row expands in place: the niche
  copies (views vs their channel's median, no Clay link), our creators on the topic (workspaces), the brief (title, use
  case, offer, CTA, up to 3 related resources), how it's been sold (the topic's winners vs losers by trait), and why each
  decision; a tracked link (one of the resources with the UTMs the /campaign-create workflow builds for an Internal -
  Influencer YouTube campaign, lib/plg/creators/utm.ts, plus a campaign brief to paste into the skill); and a Markdown
  brief to download or copy for an agent (lib/plg/creators/brief.ts). An idea has its own
  link, `#insights-idea=<theme:subject>`, which opens it expanded. Video rows open a side panel with the video's details.
- **New this week** (a table, signups only where the video is ours), **Videos**, **Themes** and **Winners vs losers**
  (our factors, reach vs signups, the niche's traits by lift and title formats) follow. Rows open the same panel.
- The e2e run opens an idea link and loads a scan without topics (scans before Nov 23) to check both still render.
