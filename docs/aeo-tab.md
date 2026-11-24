# AI visibility tab (AEO)

Replaces the Next.js AEO dashboard (clay-aeo.vercel.app) with a tab in the PLG artifact. Phase 1 is the home view:
6 tiles, visibility trend vs competitors, brand leaderboard, citations trend and top domains, Claygent/MCP mentions,
recommended-as-follow-up, sentiment, and visibility by PMM use case and by topic. Filters: platform, prompt type
(Benchmark by default), period (4/8/13/26 weeks, each vs the same number of weeks before).

## Data

- Source: the AEO Supabase project (prompt runs in `responses`; daily aggregates in the `aeo_cache_*` tables). Each
  prompt runs once per platform every Monday.
- `scripts/sync-aeo.mjs` (to build once the project key is available) sums the cache tables into weeks and writes the
  artifact db collection `aeo`: `aeo/meta` (weeks, domain types, Clay-owned domains, slice list) and one
  `aeo/slice-<platform>-<type>` per platform (all, chatgpt, claude) × prompt type (benchmark, branded, all). Shape:
  `lib/plg/aeo/data.ts`. Each document must stay under 256 KB: keep the top 40 competitors, 40 domains and 60 topics.
- Everything is stored as weekly counts, so every rate is summed (numerators, denominators) over the selected weeks,
  never averaged.
- Until `aeo/meta` exists the tab shows generated sample data (`lib/plg/aeo/sample.ts`), labelled "Sample data".
  A synced copy that fails `checkAeo` (missing slice, a count above its denominator) shows "not synced" instead.

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
