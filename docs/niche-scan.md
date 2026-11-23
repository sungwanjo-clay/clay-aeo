# Weekly niche scan (Content insights tab)

Runs every Monday. It scans what the GTM / cold email / AI lead-gen niche watches on YouTube, works back from what beat
its channel, and writes this week's video ideas (up to 15, one per topic: a theme narrowed to the tool it's about, with
a brief). The
dashboard reads `youtube/scan` and the thumbnails in `youtube/scan-thumbs-<i>`.

Work in a scratch folder `W`. Never print credentials. Keep raw results in files, never in chat.

1. **Last week's scan.** `ArtifactData` `get` collection `youtube`, doc `scan` with `out_dir` = `W/prev` (it may not exist
   on the first run). Note its `version` for step 6. Also get `youtube/creators` into `W/prev` (program channels).
2. **Pull.** `NODE_USE_ENV_PROXY=1 node scripts/niche-scan.mjs W/now --creators W/prev/youtube/creators.json --prev-scan W/prev/youtube/scan.json`
   (add `--discover` on the first Monday of the month to refresh the channel list from the seed terms in
   `lib/plg/creators/scan.config.json`). If it stops on quota it writes a partial pull: run it again the next day with
   `--resume`, or carry on and the tab marks the scan partial.
   - The channel list comes from last week's scan document (`tracked`); without one the script runs discovery.
3. **Analyze.** `node scripts/niche-analyze.mjs W/now/raw.json W/now/scan.json --prev W/prev/youtube/scan.json`.
4. **Review and write the briefs** (this is the judgment step, done by the agent running this):
   - `ArtifactData` `list` collection `cache` with `out_dir` = `W/db` (the `creators` saved copy), then
     `node scripts/niche-review.mjs W/now/scan.json W/prev/youtube/creators.json W/db/cache` prints the ideas the page
     will rank (`recommend` in `lib/plg/creators/compute.ts`: one per topic, theme + subject from `SUBJECTS` in
     `lib/plg/creators/themes.ts`; 8+ copies on 3+ channels, 10+ points above the niche's hit rate, at most 3 per theme)
     with each one's source copies, failures, title formats and assistants tried, separators, title words and our
     creators' videos and workspaces. Fewer than 15 is fine: don't pad the list.
   - Write `W/now/recs.json`: one entry per idea, `{theme, subject, format, title, angle, thumbnail, structure, offer,
     useCase, cta, copy, placement, notes, why: {title, useCase, landing, cta, placement, structure}}` (ScanRec in
     `lib/plg/creators/scan.ts`). Leave out `useCase`, `landing`, `offer` or `cta` to keep the theme's default play
     (`PLAYS` in `lib/plg/creators/themes.ts`, real clay.com pages). Every claim must come from the scan or the program
     data: counts of copies that worked and failed, the separators, the rising terms, our creators' workspaces; quote
     the numbers the review printed and don't describe a video you haven't seen in it. `format` is the title format to
     sell it with (the review's best by hit rate, or say why not); an AI-assistant topic's title names one assistant;
     check each claim against the examples (if a comparison worked, don't say comparisons fail). Don't reuse last week's
     wording for an idea that's still on the list unless the evidence is unchanged; say what moved.
   - Rerun step 3 with `--recs W/now/recs.json` (it fails if an idea's theme has no copies that worked, its subject isn't
     one of the theme's topics, or two entries are the same topic).
5. **Thumbnails.** `NODE_USE_ENV_PROXY=1 node scripts/niche-thumbs.mjs W/now/scan.json W/now/thumbs` downloads 176×99
   thumbnails for the new videos and every idea's sources (about 130, 4 documents) and sets `thumbParts` on the scan.
6. **Check.** The scan document is under 240 KB (the script refuses otherwise). Open the numbers that changed most
   against last week (new videos, rising terms, ideas on and off the list) and make sure they're plausible.
7. **Write.** `ArtifactData` `batch`: `set` `youtube/scan-thumbs-<i>` from each `W/now/thumbs/scan-thumbs-<i>.json`
   (at most 4 per batch; pass `if_version` for parts that exist), then `set` collection `youtube`, doc `scan`,
   `file_path` `W/now/scan.json`, `if_version` from step 1 (omit it on the first run), last.
8. **Report** in one line: channels, videos scored, outliers, new videos, rising terms, the 15 ideas (marking new ones).

The health check warns when `youtube/scan` is older than 8 days or partial.
