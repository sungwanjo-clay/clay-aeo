# clay.com — Google Search Console keyword → URL export (2026 onward)

Prepared for paid-search agency onboarding.

- **Property:** `sc-domain:clay.com` (domain property)
- **Date range:** 2026-01-01 → 2026-08-10
- **Search type:** Web
- **Data state:** `final` (finalized data only)
- **Generated:** 2026-08-13

## Files

| File | Rows | Description |
|---|---|---|
| `clay-gsc-keyword-url-2026.csv.gz` | 736,655 | One row per unique keyword → URL pair, totalled across the whole window. **Start here.** |
| `clay-gsc-keyword-url-by-month-2026.csv.gz` | 1,572,134 | Same pairs broken out by month, for trend and seasonality. |

Both are gzipped (the uncompressed CSVs are 88MB and 167MB). `gunzip <file>`, or
open directly in pandas: `pd.read_csv("...csv.gz")`. Excel struggles at this row
count — the monthly file exceeds Excel's 1,048,576-row limit, so use pandas,
BigQuery, or filter before opening.

## Columns

**Aggregate file:**

| Column | Meaning |
|---|---|
| `keyword` | Search query as typed by the user |
| `url` | Landing page that appeared in results for that query |
| `clicks` | Total clicks, 2026-01-01 → 2026-08-10 |
| `impressions` | Total impressions over the same window |
| `ctr_pct` | Recomputed as `clicks / impressions × 100` (percent, not fraction) |
| `avg_position` | Impression-weighted average position |
| `months_with_data` | How many of the 8 months this pair appeared in (1–8) |
| `first_month` / `last_month` | First and last month with data — useful for spotting decayed or newly-emerging queries |

**Monthly file:** `month`, `keyword`, `url`, `clicks`, `impressions`, `ctr_pct`, `avg_position`.

Sorted by clicks descending (monthly file: by month, then clicks descending).

## Scope: what this property covers

`sc-domain:clay.com` is a domain property, so it is a strict superset of the four
URL-prefix properties in the account (`/blog/`, `/tools/`, `/guides/`, `/dossier/`)
and the two subdomain properties. Verified: the export spans 13 hosts —
`www.clay.com`, `university.clay.com`, `community.clay.com`, `developers.clay.com`,
`app.clay.com`, `status.clay.com`, `trust.clay.com`, `sculpt.clay.com`,
`sequencer.clay.com`, `partner.clay.com`, `events.clay.com`, `privacy.clay.com`,
`clay.com`. No property merge or de-duplication was needed.

## Read this before analysing

**1. This is organic search only — there is no paid data here.**
Search Console reports Google *organic* results. It contains no CPC, no spend, no
match type, no quality score, no impression share, and no Ads campaign structure.
For paid keyword planning this export is useful as evidence of *demonstrated*
query demand and as a map of which URLs already rank (candidate landing pages),
but actual paid performance must come from Google Ads, which was not accessible
in this environment. Anyone treating these columns as paid metrics will be wrong.

**2. Keyword-level totals are lower than property totals, by design.**
Google withholds queries that are rare or could identify a user, so no
query-dimensioned export ever sums to the property total:

| | This export | Property total | Coverage |
|---|---|---|---|
| Clicks | 1,152,994 | 1,553,058 | **74.2%** |
| Impressions | 57,667,550 | 129,919,957 | **44.4%** |

The ~26% of clicks and ~56% of impressions missing here are anonymised
long-tail queries. This is a Search Console privacy limit, not a gap in the pull.
Do not reconcile these figures against the GSC UI's totals and conclude the export
is incomplete — compare against the UI's *Queries* tab, not its headline number.

**3. `avg_position` is an average of ranked impressions, not a ranking.**
It is impression-weighted (`Σ(position × impressions) / Σimpressions`), which is how
Search Console derives it natively. A pair with 3 impressions and position 2.0 is
not "ranking #2" in any stable sense.

**4. Zero-click rows are retained.** Pairs with impressions but no clicks are kept
deliberately — for paid work, high-impression/zero-click queries are often the
interesting ones. Filter on `clicks > 0` if you want the earned-traffic view only.

**5. Data is brand-dominated.** The single pair `clay` → `www.clay.com/` accounts
for 537,245 clicks — roughly 47% of all clicks in this export. Any unfiltered
average will be swamped by brand. Segment brand vs non-brand before drawing
conclusions about non-brand opportunity.

**6. August 2026 is a partial month** (Aug 1–10 only). Do not compare its totals
against full months without normalising. Aug 11–12 data existed at generation time
but was still provisional and was excluded so the recent tail would not read as a
traffic decline.

## Method

Requests were chunked one month at a time. A single full-range `query` × `page`
request takes ~30s server-side and was being cut off by the environment's
outbound-request timeout; a one-month request returns in ~9s. Chunking also means
each month clears Search Console's privacy threshold independently, which surfaces
more distinct pairs than one full-range query would.

The aggregate file is derived from the monthly data, not re-queried: clicks and
impressions sum, `avg_position` is impression-weighted, and `ctr_pct` is recomputed
from summed clicks and impressions (never averaged from monthly CTRs). Because of
per-month thresholds, aggregate totals may differ slightly from what a single
full-range API call would return.

Pagination ran at 25,000 rows per request until exhaustion, with retry and
exponential backoff on 429/5xx and transport errors. The final run needed zero
retries.

## Regenerating

`gsc.py` (API client), `export_monthly.py` (pull), `build_csv.py` (CSV build).
Requires `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, and `GSC_REFRESH_TOKEN` in the
environment; the token needs `webmasters.readonly`. Update the `MONTHS` list in
`export_monthly.py` to extend the window, then:

```bash
python3 export_monthly.py && python3 build_csv.py
```
