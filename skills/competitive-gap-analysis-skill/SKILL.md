---
name: competitive-gap-analysis-skill
description: Runs a SERP-based competitive gap analysis for a target SEO keyword and produces a "Competitive Brief" table to prepend to an article outline. Searches the keyword, identifies the top-ranking pages, scrapes the top 3-5 competitors, and summarizes what each does well plus the specific gaps our page can fill to win. Use at the start of outline generation (any format) when the user wants to beat the current top results, or as Path C (AI from Competitors). Output is a markdown table plus a short "How we win" list. Does not write full article prose.
icon: search
color: Teal
related_server_ids:
  - firecrawl
  - gsearchconsole
---

# Competitive Gap Analysis Skill

Produces a data-backed competitive brief that sits at the top of an article outline so the writer knows exactly how to beat the current top-ranking pages.

**Type:** PROCEDURAL + PROMPT skill. It performs live SERP + scrape work, then formats a brief.

## Activation

Invoke this skill when:
- The user picks Path C (AI from Competitors) in the outline-source step, OR
- The user explicitly asks for a competitive gap analysis / competitor brief for a keyword, OR
- Before generating any format outline when the user says they want to "beat" or "outrank" the current results.

The skill assumes the target keyword is already known. If not, ask once for it.

## Inputs

| Field | Required | Notes |
|---|---|---|
| `target_keyword` | yes | e.g. "apollo alternatives" |
| `competitor_count` | no | how many top pages to analyze; default 3, max 5 |
| `our_angle` | no | any differentiator the user already has (product, POV, data) |

## Outputs

1. A **Competitive Brief** markdown table (one row per analyzed competitor).
2. A short **"How we win"** bullet list of 4-7 concrete gaps to exploit.

This brief is prepended to the article outline (above the H1). It does not replace the outline — pair it with the relevant format skill (best-of, alternatives, review, how-to).

## PROCEDURE

### Step 1 — Pull the SERP
Use `web_search_tool` with the exact `target_keyword` (`num_results = competitor_count + 3`, to allow skipping non-article results).

Skip results that are not rankable article competitors:
- Pure homepages / product landing pages (unless the keyword is navigational)
- Ads, marketplaces, login pages, PDFs
- The user's own domain (if known)

Keep the top `competitor_count` genuine article/listicle/guide URLs, in rank order.

### Step 2 — Scrape each competitor
For each kept URL, scrape the page content. Prefer the `firecrawl` integration (scrape / markdown mode) via `tool_discovery` → `tool_executor`; batch the scrapes in one parallel `tool_executor` call when possible. Fall back to `web_fetch_tool` if firecrawl fails for a URL.

From each page, extract (do NOT invent — only record what is actually present):
- Page title / H1
- Word count (approximate is fine)
- Heading structure — main H2s/H3s, item count if it's a listicle
- Content angle / format (listicle, comparison table, single review, tutorial, etc.)
- Notable strengths — what they do well (comparison tables, screenshots, pricing data, original data, video, FAQs, depth, recency)
- Notable gaps / weaknesses — what's missing, thin, outdated, or generic

### Step 3 — Identify the gaps
Compare the competitors against each other and against best-practice for the keyword's funnel stage/format. Find:
- Coverage every competitor has (table stakes — we must match)
- Coverage some have and some lack (differentiators we should include)
- Coverage nobody has (the real wedge — original data, deeper how-to, better structure, fresher info, missing sub-topics, missing FAQs, missing comparison dimensions)

### Step 4 — Emit the Competitive Brief
Output exactly this structure:

```
## Competitive Brief — "{target_keyword}"

| # | Page (domain) | Format | ~Words | What they do well | Where they fall short |
|---|---------------|--------|--------|-------------------|-----------------------|
| 1 | {title — domain} | {format} | {count} | {strengths} | {gaps} |
| 2 | ... | ... | ... | ... | ... |
| 3 | ... | ... | ... | ... | ... |

**How we win (gaps to fill):**
- {Concrete gap #1 — what to add/do that the SERP lacks}
- {Concrete gap #2}
- {... 4-7 total, specific and actionable}
```

Then hand off: the gaps feed directly into the chosen format skill's outline. Add a one-line note such as: *"I've baked these gaps into the outline below."*

## OUTPUT RULES

- Table first, then the "How we win" list.
- Every strength/gap must come from the actual scraped page — cite the concrete element (e.g. "has a side-by-side pricing table", "no GDPR/compliance section").
- Keep each table cell tight (one phrase to one short sentence).
- Rank order matches SERP order.
- If a page can't be scraped, note "could not access" in its row rather than guessing.

## GLOBAL RULES

- Never invent pricing, stats, reviews, or page content — only report what was actually found.
- Never fabricate SERP rankings; use real search results.
- Never include the user's own domain as a competitor.
- Keep the brief skimmable — it's a pre-writing tool, not an essay.
- If fewer than 2 competitors are scrapeable, say so and proceed with what's available.
- Do not write the full article — output the brief and feed gaps into the outline.
