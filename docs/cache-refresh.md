# Daily refresh of the dashboard's saved default view

Viewers without a Clay Sigma connection see the PLG dashboard (Workspaces with its CRO and Tier 4 sections, Media properties, Startup program) from a
saved copy in the artifact's database, collection `cache`. This job writes it every morning. Each tab's copy covers
**every preset × comparison** (Last 7 / 28 / 90 days, quarter to date, year to date; previous period or same period last
year) and the page applies the grain, so only custom dates need Sigma. One query per tab computes all of them: it joins a
small table of the date ranges and labels each row with its range (`lib/plg/offline.ts`), so unique visitors are exact
for every range. The page never overwrites this copy with a single view it loaded.

Artifact: https://claude.ai/artifact/R2pMQF57g3idB4EvtazAeC · Sigma connection `2d269863-3d4a-459d-9245-daff9e223f17`

## Runbook (for the scheduled session)

Work in a scratch folder `W` (e.g. `$TMPDIR/cache-refresh`). Never print or paste query results into chat; they stay in files.

1. **Code.** In the repository: `git fetch origin claude/affectionate-noether-v0n9id && git checkout FETCH_HEAD`, then
   `[ -d node_modules ] || npm ci`.
2. **YouTube sync, then the YouTube documents.** The Media properties query and tab need fresh YouTube data, and
   nothing else refreshes it.
   - `ArtifactData` `list` of collection `youtube` on the artifact, with `out_dir` = `W/prev` (the current copies, with
     their `version`s).
   - If `YOUTUBE_CLIENT_ID` is set in the environment (check with `[ -n "$YOUTUBE_CLIENT_ID" ] && echo yes`, never print
     it): `NODE_USE_ENV_PROXY=1 YOUTUBE_PREV_DIR=W/prev/youtube node scripts/sync-youtube.mjs` (the proxy flag lets it download thumbnails from i.ytimg.com). It writes `dist/youtube/<channelId>.json` and
     prints one line per channel. A channel that fails keeps its previous file, so write only the files it printed
     `→ dist/youtube/…` for.
   - Write those files with one `ArtifactData` `batch`: `set` `youtube/<channelId>` from each file, and
     `youtube/thumbs-<channelId>` from each `thumbs-<channelId>.json` it printed (thumbnails; a batch is capped at 1 MB, so
     split it if needed), with `if_version`
     from `W/prev`. Skip any file over 250 KB and report it.
   - If the variable isn't set, or the sync fails, report `youtube: not synced (<reason>)` and carry on with the copies
     in `W/prev`.
   - Then use `W/yt` = a fresh `list` of collection `youtube` (`out_dir` = `W/yt`) for the steps below.
3. **Latest complete day.** `node scripts/refresh-cache.mjs latest` prints `{connectionId, sql}`. Call the Clay Sigma
   connector's `begin_session` once, then `query` with `{type: "connection", connectionId, sql}` using that SQL
   exactly, and have the result saved to `W/fresh.json`. `node scripts/refresh-cache.mjs dataend W/fresh.json` prints
   `DATAEND`: the last day that blended attribution, CUSTOMERS, sessions, pageviews and CTA clicks have all fully loaded
   (per source the day before its newest day, checked against the same weekday's typical volume; the earliest across
   sources). Every query below uses this one date, so no section runs a day ahead of another. If it exits 3, a source
   has no whole day: stop and report which.
4. **Default-view SQL.** `node scripts/refresh-cache.mjs sql DATAEND W/yt/youtube > W/sql.json`.
5. **Run the nine queries,** one at a time, for NAME in `main`, `startup`, `social`, `tier4`, `tier4list`, `cro`, `crotrend`, `creators`, `daily`:
   - Print the SQL: `node -e "process.stdout.write(require('W/sql.json').NAME)"` (use the real path).
   - Call Sigma `query` with that SQL **character for character** (connection type, same connectionId).
   - Large results are saved to a file and the tool returns its path: use that path. If the result comes back inline
     instead, write it unchanged to `W/NAME.result.json` and use that.
   - `node scripts/refresh-cache.mjs pack NAME DATAEND <result path> W/sql.json W/out` writes the documents
     `W/out/NAME-0.json…` (parts) and `W/out/NAME.json` (header).
   - If a query errors, skip that NAME (its previous copy stays) and continue with the next.
   - If `pack` exits with code 3 it printed `refused` and the data-contract problems: the result is broken (missing
     ranges, no rows, impossible counts). Write nothing for that NAME, keep its previous copy, and report the problems.
6. **Write to the dashboard.** `ArtifactData` `list` of collection `cache` (to read each document's `version`), then for
   each NAME: `set` each part `cache/NAME-<i>` from its file, in batches of at most 4 parts (a batch is capped at 1 MB),
   then the header `cache/NAME` last, in the final batch (readers use the header to find the parts, so it must go after
   them). Pass `if_version` for every document that already exists. If a part number from an older, longer copy is left
   over, leave it: the header's `parts` count limits what is read.
7. **Report** one line for the YouTube sync (channels written, views and impressions through which day), then one line per
   NAME: data through DATAEND, rows, parts, written or skipped (and why).

## Format

Matches what the page writes in `artifact/plg/main.tsx` (`readCached` / `writeCached`): header
`{parts, key, storedAt, dataEnd}` where `key` is the SQL the page would run, and parts `{s: <JSON text slice>}` of
about 200,000 characters each (documents are capped at 256 KB).
