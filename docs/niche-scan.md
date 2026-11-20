# Weekly niche scan (Content insights tab)

Runs every Monday. It scans what the GTM / cold email / AI lead-gen niche watches on YouTube, works back from what beat
its channel, and writes this week's five recommendations. The dashboard reads one document, `youtube/scan`.

Work in a scratch folder `W`. Never print credentials. Keep raw results in files, never in chat.

1. **Last week's scan.** `ArtifactData` `get` collection `youtube`, doc `scan` with `out_dir` = `W/prev` (it may not exist
   on the first run). Note its `version` for step 6. Also get `youtube/creators` into `W/prev` (program channels).
2. **Pull.** `NODE_USE_ENV_PROXY=1 node scripts/niche-scan.mjs W/now --creators W/prev/youtube/creators.json --prev W/prev/raw.json`
   (add `--discover` on the first Monday of the month to refresh the channel list from the seed terms in
   `lib/plg/creators/scan.config.json`). If it stops on quota it writes a partial pull: run it again the next day with
   `--resume`, or carry on and the tab marks the scan partial.
   - The previous raw pull is needed for the channel list: keep `W/now/raw.json` as next week's `--prev` (store it in the
     scratch folder of the scheduled task, or rerun `--discover` if it's gone).
3. **Analyze.** `node scripts/niche-analyze.mjs W/now/raw.json W/now/scan.json --prev W/prev/youtube/scan.json`.
4. **Review and write the recommendations** (this is the judgment step, done by the agent running this):
   - Build the page's own ranking to see which five themes it picks: the five highest-scoring themes in
     `lib/plg/creators/compute.ts` (`recommend`). Print each theme's original hit, winners, losers, separators and words
     from `W/now/scan.json`, plus our creators' signup proof (the dashboard's `creators` saved copy).
   - Write `W/now/recs.json`: one entry per recommended theme, `{theme, title, angle, thumbnail, structure, offer, notes}`.
     Every claim must come from the scan or the program data: counts of copies that worked and failed, the separators,
     the rising terms, our creators' workspaces. Titles use formats the scan shows working (course, "I tested", year tag,
     beginner) and avoid ones under the base rate. Don't reuse last week's wording for a theme that's still on the list
     unless the evidence is unchanged; say what moved.
   - Rerun step 3 with `--recs W/now/recs.json` (it fails if a theme has no copies that worked).
5. **Check.** The document is under 240 KB (the script refuses otherwise). Open the numbers that changed most against
   last week (new videos, rising terms, themes on and off the list) and make sure they're plausible.
6. **Write.** `ArtifactData` `set` collection `youtube`, doc `scan`, `file_path` `W/now/scan.json`, `if_version` from
   step 1 (omit it on the first run).
7. **Report** in one line: channels, videos scored, outliers, new videos, rising terms, the five themes (marking new ones).

The health check warns when `youtube/scan` is older than 8 days or partial.
