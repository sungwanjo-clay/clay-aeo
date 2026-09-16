# Exact tool calls, parameters and gotchas

Read this before your first Ahrefs or GSC call. Several of these fail by returning an empty array rather than an error, so a wrong argument shape and a genuine "no data" finding look identical — and mistaking one for the other puts a false finding in the brief.

## Contents

1. [Ahrefs](#ahrefs)
2. [Google Search Console](#google-search-console)
3. [Gotchas](#gotchas-each-one-cost-a-real-debugging-cycle)
4. [Spillover](#spillover)
5. [No MCP? direct API fallback](#no-mcp-direct-api-fallback)

---

## Ahrefs

### Domain rating (Phase 1)

```
ahrefs__domain_rating:
  target: "clay.com"
  date:   "2026-08-27"        # 2-3 weeks back, see gotchas
```

### Keywords overview (Phase 2)

Batch 20 keywords per call, 2-3 calls in parallel.

```
ahrefs__keywords_overview:
  country:  "us"
  keywords: "kw1,kw2,...,kw20"
  select:   "keyword,volume,difficulty,cpc,global_volume,traffic_potential"
```

`traffic_potential` is the traffic of the page currently ranking #1. Always request it — it's the field that catches a 200/mo keyword whose ranking page pulls 4,000 visits.

### Organic keywords (Phase 3)

Per topic stem, in parallel:

```
ahrefs__organic_keywords:
  target:  "clay.com"
  country: "us"
  date:    "2026-08-27"
  limit:   50
  select:  "keyword,best_position,volume,keyword_difficulty,best_position_url"
  where:   {"field":"keyword","is":["substring","sequenc"]}
```

Against the specific URL:

```
ahrefs__organic_keywords:
  target:  "https://www.clay.com/sequencer"
  mode:    "exact"
  country: "us"
  date:    "2026-08-27"
  select:  "keyword,best_position,volume,keyword_difficulty"
```

### SERP overview (Phase 5)

```
ahrefs__serp_overview:
  keyword:       "ai agent builder"
  country:       "us"
  top_positions: 10
  select:        "position,url,title,domain_rating,traffic"
```

Organic only — paid slots never appear here. Run it on the brand term too, to see who's parasitizing it.

### Matching terms (Phase 7, optional)

```
ahrefs__matching_terms:
  keywords: "ai sdr,inbound lead,speed to lead"
  country:  "us"
  limit:    40
  order_by: "volume:desc"
  select:   "keyword,volume,difficulty,cpc"
  where:    {"field":"volume","is":["gte",100]}
```

Always filter on volume or you drown in long-tail noise.

## Google Search Console

Find the property first — guessing the form wastes a call:

```
gsearchconsole__list_sites
```

### Query level, target page (Phase 4)

```
gsearchconsole__query_search_analytics:
  site_url:   "sc-domain:clay.com"
  start_date: "2026-06-14"          # trailing 90 days
  end_date:   "2026-09-12"
  dimensions: ["query"]
  dimension_filters: [{"dimension":"page","operator":"contains","expression":"/sequencer"}]
  max_limit:  50
```

### Page level — does this URL even exist?

```
gsearchconsole__query_search_analytics:
  site_url:   "sc-domain:clay.com"
  start_date: "2026-06-14"
  end_date:   "2026-09-12"
  dimensions: ["page"]
  dimension_filters: [{"dimension":"page","operator":"contains","expression":"claygent"}]
```

This is the call that caught a brief proposing `/claygents` when only `/claygent` exists (2,969 clicks).

### Topic sweep across the whole domain

```
  dimensions: ["query","page"]
  dimension_filters: [{"dimension":"query","operator":"includingRegex",
                       "expression":"sdr|inbound|routing|speed to lead"}]
```

Use this in Mode C, where there's no target URL yet — it answers "what does this domain already earn on this topic, anywhere?"

## Gotchas (each one cost a real debugging cycle)

| Issue | Detail | Fix |
|---|---|---|
| **Ahrefs CPC is in cents** | `"cpc": 3500` | Divide by 100 → $35.00 |
| **Ahrefs date lag** | `date: "2026-09-14"` returned `[]`; `"2026-08-27"` returned full data | Use a date 2-3 weeks back |
| **`order_by` syntax** | `"volume_desc"` throws 400 | `"volume:desc"` |
| **`where` filter shape** | Nested and non-obvious | `{"field":"keyword","is":["substring","agent"]}` |
| **KD is unreliable alone** | "ai sales agent" read KD 43, then KD 2 | Always confirm with `serp_overview` |
| **GSC `byPage` aggregation** | A page-filtered query returns unrelated brand queries the page also serves | Expected — read it as "queries this page appears for" |
| **GSC data lag** | Last 2-3 days are partial | End the window 3 days back |
| **GSC query anonymization** | Rare queries are dropped from the `query` dimension entirely | Zero query rows ≠ zero traffic; confirm with the `page` dimension |
| **Large outputs truncate** | Results >8K chars spill to `/home/user/.spillover/` | Parse in Python, print only what you need |
| **Empty results are data** | `[]` from `organic_keywords` or `serp_overview` | Report as "zero rankings" / "no entrenched SERP" |

On the date-lag one: if a call returns `[]`, re-run it with an older date *before* concluding there's no data. An empty result is only a finding once you've ruled out the lag.

## Spillover

```bash
python3 scripts/parse_spillover.py /home/user/.spillover/<file>.txt --top 40
```

Handles GSC rows (`dimension_values` / clicks / impressions / position / ctr) and Ahrefs rows, sorts by impressions or volume, prints a fixed-width table. Written once here so each brief doesn't rewrite it.

## No MCP? direct API fallback

If the Ahrefs/GSC MCP servers aren't connected, call the APIs directly with credentials from the environment — **never hardcode a key or paste a token into the brief**.

**Ahrefs** — `AHREFS_API_KEY`, bearer auth against `https://api.ahrefs.com/v3/`:
`site-explorer/domain-rating`, `keywords-explorer/overview`, `site-explorer/organic-keywords`, `serp-overview/serp-overview`. Same parameter names as the MCP tools.

**GSC** — scope `https://www.googleapis.com/auth/webmasters.readonly`. Token via `POST https://oauth2.googleapis.com/token` using either a service account (`GSC_SERVICE_ACCOUNT_JSON`, and the service-account email must be added as a user on the property in Search Console or every call 403s) or a refresh token (`GSC_CLIENT_ID` / `GSC_CLIENT_SECRET` / `GSC_REFRESH_TOKEN`). Then:

- `POST https://searchconsole.googleapis.com/webmasters/v3/sites/{encoded_site_url}/searchAnalytics/query`
- `GET  https://searchconsole.googleapis.com/webmasters/v3/sites` (property list)
- `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` — index status, canonical, last crawl. Worth adding in Mode A/B: a page Google isn't indexing can't be fixed with a better title.

`GSC_SITE_URL` must match the registered property exactly — `sc-domain:clay.com` for a Domain property, `https://www.clay.com/` with the trailing slash for URL-prefix. A near-miss is a 403, not an empty result. URL-encode it in the path.

**Firecrawl** — `FIRECRAWL_API_KEY`, scrape to markdown. Falls back to `web_fetch`.

If Ahrefs or GSC is unavailable by either route, stop and say so. A brief built on estimates looks exactly like a brief built on data and is worse than no brief.
