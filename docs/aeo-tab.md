# AI visibility tab (AEO)

Replaces the Next.js AEO dashboard (clay-aeo.vercel.app) with a tab in the PLG artifact. Phase 1 is the home view:
6 tiles, visibility trend vs competitors, brand leaderboard, citations trend and top domains, Claygent/MCP mentions,
recommended-as-follow-up, sentiment, and visibility by PMM use case and by topic. Filters: platform, prompt type
(Benchmark by default), period (4/8/13/26 weeks, each vs the same number of weeks before).

## Data

- Source: the AEO Supabase project (prompt runs in `responses`; daily aggregates in the `aeo_cache_*` tables). Each
  prompt runs once per platform every Monday.
- `scripts/sync-aeo.mjs` sums the cache tables into weeks and writes the
  artifact db collection `aeo`: `aeo/meta` (weeks, domain types, Clay-owned domains, slice list) and one
  `aeo/slice-<platform>-<type>` per platform (all, chatgpt, claude) × prompt type (benchmark, branded, all). Shape:
  `lib/plg/aeo/data.ts`. Each document must stay under 256 KB: keep the top 40 competitors, 40 domains and 60 topics.
- Everything is stored as weekly counts, so every rate is summed (numerators, denominators) over the selected weeks,
  never averaged.
- Until `aeo/meta` exists the tab shows generated sample data (`lib/plg/aeo/sample.ts`), labelled "Sample data".
  A synced copy that fails `checkAeo` (missing slice, a count above its denominator) shows "not synced" instead.

## Deeper sections

- **Top cited domains** (`aeo_cache_domain_urls`): each kept domain's 15 most-cited pages per week (title and URL type in
  `aeo/urlinfo`), so the drill-down follows the period and filters like everything else. Counts are answers citing the
  page, not raw citations.
- **Narrative intelligence** (`responses.themes`): counted as answers carrying a (theme, sentiment), one run day per week
  (the earliest that week), with the 6 newest quotes each; top 40 themes per sentiment. Not
  `get_sentiment_narratives_rpc`: it returns at most 1,000 rows (Negative only) and its `occurrence_count` is inflated
  by a join (374,800 for one theme over 12 weeks of about 54,000 answers).
- **Fix narrative** notes: `aeonotes/<theme id>` `{theme, sentiment, status, note, updatedAt}`, written from the page by
  any signed-in viewer who can use it (rule `aeonotes` write `interact`).

## Definitions

| Metric | Formula |
|---|---|
| Visibility | Clay mentions ÷ responses |
| Citation rate | responses citing a Clay domain ÷ responses with any citation |
| Avg position | Σ mention position ÷ responses with a position (lower is better) |
| Positive sentiment | positive ÷ (positive + neutral + negative), among Clay mentions |
| Claygent & MCP | responses naming Claygent or Clay MCP (count) |
| Brand share | responses mentioning the brand ÷ responses |
| Domain share | responses citing the domain ÷ responses with any citation (an answer can cite several) |

The Event Campaigns PMM use case is hidden everywhere. Competitor and domain colors are fixed by overall rank across all
data, so filters never repaint a line.

## Phase 2

Competitive gaps by topic, full citations explorer (URLs), sentiment themes, MCP by platform, and AI bot hits once the
CDN request logs land in Snowflake (data team request).

## Daily sync (scheduled)

A Monday batch takes until about Friday to finish writing (the Nov 16 batch landed Nov 20–21), so the sync runs daily
and picks each batch up when it lands. It reads only the `aeo_cache_*` tables, which the AEO project's
`refresh_dashboard_cache()` rebuilds daily: keep that job running (pg_cron or the old app's cron) before the Vercel app
is retired.

1. `git fetch origin claude/affectionate-noether-v0n9id && git checkout FETCH_HEAD`.
2. `NODE_USE_ENV_PROXY=1 node scripts/sync-aeo.mjs W/aeo.json` (env `AEO_SUPABASE_URL`, `AEO_SUPABASE_KEY`; never print
   them). Exit 3 (a count above its denominator) or 2 (missing key, document too large): stop, write nothing, report.
3. Split its `docs` into one JSON file per document (29 documents: `slice-*`, `urls-*`, `narr-*`, `urlinfo`, `meta`).
   With `ArtifactData` on https://claude.ai/artifact/R2pMQF57g3idB4EvtazAeC: `list` collection `aeo` for current
   versions, then `batch` writes in the order the script lists them, each batch under 1 MB (about 4 `narr-*` documents
   per batch), every entry pinned with `if_version` when the document exists, and `set` `aeo/meta` last on its own.
4. Report one line: weeks covered, latest week, its Benchmark visibility and responses, and any warning the script
   printed.
