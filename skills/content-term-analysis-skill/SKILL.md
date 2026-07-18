---
name: content-term-analysis-skill
description: Surfer/Clearscope-style content term analysis for a target keyword. Pulls the top ~10 ranking pages for the keyword (Semrush organic results preferred, web-search/DataforSEO fallback), scrapes them with Firecrawl, and runs a TF-IDF / term-frequency analysis to produce the words and phrases the page should include, with target usage counts and a recommended word count. Use when the user wants a content brief, term/keyword list, content score targets, or "what should I include to rank" for a keyword. Output is a term-recommendation table plus a target word count.
icon: list-checks
color: Green
related_server_ids:
  - semrush
  - firecrawl
  - ahrefs
---

# Content Term Analysis Skill (TF-IDF)

Generates a Surfer SEO / Clearscope-style content brief: the terms and phrases your page should contain to compete for a keyword, with recommended usage counts and a target length, derived from the actual top-ranking pages.

**Type:** PROCEDURAL skill. It fetches the SERP, scrapes pages, and runs a bundled TF-IDF script.

## Activation

Invoke when the user wants any of:
- A content brief / term list for a keyword
- "What keywords/terms should I include to rank for X?"
- Content-score targets, term coverage, or word-count targets
- Surfer/Clearscope-style optimization guidance

Often paired with an outline: run this skill, then fold the recommended terms into the outline's section guidance.

## Inputs

| Field | Required | Notes |
|---|---|---|
| `target_keyword` | yes | the keyword to optimize for |
| `page_count` | no | how many top pages to analyze; default 10, max 10 |
| `target_word_count` | no | if omitted, the script uses the median competitor length |

## Outputs

- A **target word count** (median of competitors, or the user's value).
- A **Primary Terms** table — single words, with coverage %, avg uses, and a suggested usage-count range.
- A **Key Phrases** table — 2-3 word phrases with the same columns.
- A short note on the highest-priority gaps (terms used by most competitors).

## PROCEDURE

### Step 1 — Get the top ~10 ranking URLs
Preferred source order (use whatever is connected):
1. **Semrush** — organic positions / SERP for the keyword. If semrush is not connected, ask the user once whether to add it (`add_server_awaiter('semrush')`), or proceed with a fallback.
2. **DataforSEO (gumstack)** — SERP endpoint, if connected.
3. **Fallback:** `web_search_tool` with the exact keyword, `num_results=10`.

Collect the top `page_count` organic article/landing URLs in rank order. Drop duplicates, the user's own domain, and obvious non-content (login, PDF, marketplace) pages. Discover the exact tool via `tool_discovery(server='semrush')` then run it through `tool_executor`.

### Step 2 — Scrape each URL with Firecrawl
Use the `firecrawl` integration (scrape, markdown/text mode) via `tool_discovery` → `tool_executor`. Batch the scrapes in one parallel `tool_executor` call. Fall back to `web_fetch_tool` for any URL Firecrawl can't fetch.

Keep the main body text for each page. Strip nav/footer boilerplate where possible (Firecrawl markdown already does most of this).

### Step 3 — Build the input file and run the analyzer
Write a JSON file shaped like:

```json
{
  "keyword": "<target_keyword>",
  "target_word_count": <optional int>,
  "pages": [ {"url": "...", "text": "<body text>"}, ... ]
}
```

Then run the bundled script in the sandbox:

```
python3 scripts/tfidf_analyze.py /home/user/pages.json --top 60
```

It prints a JSON report and writes `<input>.report.json`. The report includes `median_competitor_words`, `target_word_count`, `primary_terms`, `phrases`, and `all_terms`. Each term row has: `term`, `pages_using`, `coverage_pct`, `avg_uses_when_present`, and `suggested_uses` ([low, high]).

The script handles tokenization, stop-word removal, 1-3 gram TF-IDF, document frequency, and usage normalization to the target word count. Requires ≥2 scrapeable pages.

### Step 4 — Present the brief
Format the report as two clean tables. Example:

```
## Content Brief — "{keyword}"
**Target length:** ~{target_word_count} words (median of top {n} pages)

### Primary terms to include
| Term | Used by | Suggested uses |
|------|---------|----------------|
| contact data | 90% of pages | 6-11 |
| ... | ... | ... |

### Key phrases
| Phrase | Used by | Suggested uses |
|--------|---------|----------------|
| sales prospecting | 80% of pages | 4-8 |
| ... | ... | ... |

**Priority gaps:** terms used by ≥80% of top pages that your draft should not miss.
```

If paired with an outline, add: *"Fold high-coverage terms into the relevant sections naturally — don't keyword-stuff."*

## OUTPUT RULES

- Lead with the target word count, then primary terms, then phrases.
- Sort terms by the script's relevance score (already done in the report).
- Coverage % = share of analyzed pages that use the term — surface it so the user knows what's table-stakes vs. nice-to-have.
- Present usage as a range, never a single rigid number.
- Always say how many pages were actually analyzed; if fewer than the target (some failed to scrape), note it.

## GLOBAL RULES

- Use real SERP data — never invent rankings, URLs, or term frequencies.
- Only analyze text actually scraped from the pages.
- Recommend natural inclusion; explicitly warn against keyword-stuffing.
- Exclude the user's own domain from the competitor set.
- If Semrush isn't connected and the user declines to add it, fall back to web search and say so.
- This skill produces a brief/term list — it does not write the article.
