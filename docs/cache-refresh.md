# Daily refresh of the dashboard's saved default view

Viewers without a Clay Sigma connection see the PLG dashboard's default **Last 7 days** view (Workspaces, Media
properties, Startup program) from a saved copy in the artifact's database, collection `cache`. The page refreshes that
copy itself when someone with Sigma and edit access opens it; this job refreshes it every day regardless.

Artifact: https://claude.ai/artifact/R2pMQF57g3idB4EvtazAeC · Sigma connection `2d269863-3d4a-459d-9245-daff9e223f17`

## Runbook (for the scheduled session)

Work in a scratch folder `W` (e.g. `$TMPDIR/cache-refresh`). Never print or paste query results into chat; they stay in files.

1. **Code.** In the repository: `git fetch origin claude/affectionate-noether-v0n9id && git checkout FETCH_HEAD`, then
   `[ -d node_modules ] || npm ci`.
2. **YouTube documents** (the Media properties query needs them): `ArtifactData` `list` of collection `youtube` on the
   artifact, with `out_dir` = `W/yt`.
3. **Latest complete day.** `node scripts/refresh-cache.mjs latest` prints `{connectionId, sql}`. Call the Clay Sigma
   connector's `begin_session` once, then `query` with `{type: "connection", connectionId, sql}` using that SQL
   exactly. The single row's `max_day` (first 10 characters) is `DATAEND`.
4. **Default-view SQL.** `node scripts/refresh-cache.mjs sql DATAEND W/yt/youtube > W/sql.json`.
5. **Run the three queries,** one at a time, for NAME in `main`, `startup`, `social`:
   - Print the SQL: `node -e "process.stdout.write(require('W/sql.json').NAME)"` (use the real path).
   - Call Sigma `query` with that SQL **character for character** (connection type, same connectionId).
   - Large results are saved to a file and the tool returns its path: use that path. If the result comes back inline
     instead, write it unchanged to `W/NAME.result.json` and use that.
   - `node scripts/refresh-cache.mjs pack NAME DATAEND <result path> W/sql.json W/out` writes the documents
     `W/out/NAME-0.json…` (parts) and `W/out/NAME.json` (header).
   - If a query errors, skip that NAME (its previous copy stays) and continue with the next.
6. **Write to the dashboard.** `ArtifactData` `list` of collection `cache` (to read each document's `version`), then one
   `batch` per NAME: `set` each part `cache/NAME-<i>` from its file, then the header `cache/NAME` last (readers use the
   header to find the parts, so it must go after them). Pass `if_version` for every document that already exists. If a
   part number from an older, longer copy is left over, leave it: the header's `parts` count limits what is read.
7. **Report** one line per NAME: data through DATAEND, rows, parts, written or skipped (and why).

## Format

Matches what the page writes in `artifact/plg/main.tsx` (`readCached` / `writeCached`): header
`{parts, key, storedAt, dataEnd}` where `key` is the SQL the page would run, and parts `{s: <JSON text slice>}` of
about 200,000 characters each (documents are capped at 256 KB).
