# Phase 6 — Organic page teardown

Phase 5 establishes whether the SERP is winnable. This phase establishes **what the page has to contain to win it**, so that section and header recommendations come from what is actually ranking rather than from taste.

Same logic as the competitive-gap-analysis step in `best-listicle-brief`, pointed at landing-page structure instead of a product list.

## Contents

1. [Step 1 — Classify the SERP](#step-1--classify-the-full-serp)
2. [Step 2 — Pick the five](#step-2--pick-the-five)
3. [Step 3 — Crawl](#step-3--crawl)
4. [Step 4 — Extract per page](#step-4--extract-per-page)
5. [Step 5 — Consensus analysis](#step-5--consensus-analysis-the-payoff)
6. [Step 6 — Output blocks](#step-6--output-blocks)
7. [Failure modes](#failure-modes)

---

## Step 1 — Classify the full SERP

Start from the `ahrefs__serp_overview` result for the primary keyword (`top_positions: 10`). Classify **every** result — you report the mix even though you only tear down some of it, because the mix decides what kind of page can rank at all.

| Bucket | What's in it | Tear down? |
|---|---|---|
| `product` | Vendor product / solution / feature / platform page | **Yes — the gold** |
| `guide` | Editorial how-to, "what is X", category explainer | **Yes** |
| `listicle` | "Best X tools", "Top 10 X" roundups | Only to fill out five (flag it) |
| `review-directory` | G2, Capterra, TrustRadius, Gartner Peer Insights | No |
| `social-ugc` | Reddit, YouTube, Quora, LinkedIn, X/Twitter, Facebook, TikTok, Hacker News, Medium, Substack | No |
| `paid` | Sponsored results and shopping units | No — never a teardown target |
| `own` | The client's own domain | No, but record the position |
| `irrelevant` | Different industry entirely — intent pollution | No — this is a Phase 5 finding |

Two notes on scope:

- `ahrefs__serp_overview` returns **organic results only**, so paid slots never appear there and the `paid` bucket only matters if you also ran a live check via `web_search`. If you did, discard the ad block and the AI Overview prose.
- **Record whether an AI Overview is present.** It doesn't give you a page to tear down, but it's a CTR-suppression finding that pairs directly with the Phase 4 pattern "position 1 + near-zero CTR at scale" (the "clay ai" case: 50,273 impressions, position 1.0, 0.26% CTR). If the SERP has an AI Overview and GSC shows that pattern, you've found the cause, and no amount of on-page work fixes it.

Excluding social and directories is about what you can *learn structure from*, not about whether they matter. A Reddit thread at position 2 is real evidence about how buyers discuss the category and is worth quoting in the brief — you just can't copy its information architecture onto a product page.

## Step 2 — Pick the five

Take the **top 5 by position** from `product` + `guide`. Then:

- **Fewer than 3 available?** Fill from `listicle` and say so — "the SERP has only 2 real product pages; the rest is roundups" is itself the headline finding, because it means the page is entering a review-driven SERP and may need a comparison asset rather than a landing page.
- **Zero available?** Don't force it. Report the SERP as non-teardownable, explain what that implies (usually: this keyword is served by editorial or UGC, so target it with a guide and point the landing page at a different term), and skip to Phase 7.
- **More than 5 available?** Stop at 5. Returns flatten fast and the crawl cost is real.

Never tear down the client's own page in this set — it's the subject, not a competitor. Do crawl it separately in Mode A/B so you can compare draft against incumbent.

## Step 3 — Crawl

Firecrawl in markdown mode, all five batched in one parallel call. `web_fetch` is the fallback; it's lossier on JS-rendered pages, which most modern landing pages are — if a page comes back with a nav and no body, say the crawl failed for that URL rather than drawing conclusions from a fragment.

Record only what's actually on the page. The failure mode here is inferring a section from a nav link.

## Step 4 — Extract per page

```
URL | position | DR | est. traffic
Title tag (verbatim)
H1 (verbatim)
H2/H3 outline (in order)
Word count
Above-fold promise — the one-sentence value proposition
Proof elements — logos, named customers, hard metrics, case-study links, security/compliance badges
Format elements — comparison table, pricing on page, demo video, interactive/sandbox demo, screenshots, FAQ (+ FAQ schema?)
CTA pattern — primary vs secondary, self-serve vs gated demo
Internal links out — which clusters this page feeds
Category vocabulary — what they call the thing, and whether they use our intended target term at all
```

Title tag and H1 verbatim are not optional: they feed Phase 9's pattern analysis, and that's how you catch a draft H1 that says "agent" fifteen times without once saying "AI" while all five ranking pages lead with it.

The last line — do they even use our target term — is a cheap, high-value check. If none of the five ranking pages uses the phrase we're building the page around, either the phrase is wrong or we're defining a category, and those need very different briefs.

## Step 5 — Consensus analysis (the payoff)

Five teardowns are raw material. The finding is in the overlap. Sort every section into three buckets:

| Bucket | Threshold | What it means for the brief |
|---|---|---|
| **Table stakes** | on 4-5 of 5 | Required. If the draft lacks one, flag it ⚠️ — this is a gap, not a preference |
| **Differentiator** | on 2-3 of 5 | Optional. Recommend by fit with the product, not by count |
| **Wedge** | on 0-1 of 5 **and** we can credibly do it | The argument the brief exists to make |

The wedge only counts if it's real. "Nobody has an observability section" is a wedge when the product genuinely has observability — that's how `ai agent observability` (350/mo, KD 16, a SERP of pure dev-tool players with nobody owning the GTM angle) became the top recommendation on the Account Agents brief. "Nobody covers X" for an X we can't back is just a gap we'd also have.

Also extract, across the five:

- **Title pattern** — the shared construction (e.g. `{Brand} {Product} | {Category outcome}`). Feeds Phase 9.
- **H1 pattern** — benefit-led or category-led? Does the category term appear in it?
- **Depth norm** — median word count. A 400-word draft against a 1,800-word median is a finding.
- **Proof norm** — if all five show named customers with metrics and the draft has a logo bar, say so.

## Step 6 — Output blocks

Two blocks go into the brief. First, the teardown itself:

```
## Organic SERP teardown - "{keyword}"
SERP mix (top 10): {n} product | {n} guide | {n} listicle | {n} review/directory | {n} social/UGC{ | AI Overview present}
Excluded from teardown: {urls + bucket}
{Our own domain at position N, if present}

| # | Page (domain) | Type | DR | ~Words | Above-fold promise | What works | What's thin |
|---|---|---|---|---|---|---|---|

Title patterns on page one:
- {verbatim title} (pos N)
...
Shared construction: {pattern}
```

Then the part that actually drives the recommendation:

```
## What this tells us about our page

Table stakes (4-5 of 5 have it - we need it)
| Section | On N/5 | In our draft? |

Differentiators (2-3 of 5 - pick by fit)
| Section | On N/5 | Recommend? | Why |

White space (0-1 of 5 - and we can back it)
| Angle | Evidence nobody owns it | Our credible claim |

Depth: median {N} words across the five{; our draft is {N}}
Proof norm: {what the ranking pages show}
```

In Mode A, map each row back to the draft's own section headers so the reader sees their outline with gaps marked, rather than a generic list. In Mode C there's no draft to map to, so this block becomes the proposed skeleton directly.

## Failure modes

| Symptom | What it means | Do this |
|---|---|---|
| All 5 crawls thin (<200 words) | JS-rendered, `web_fetch` can't see it | Note it; use Firecrawl or report teardown as unavailable |
| Every page structurally identical | Mature, templated category | Say so — differentiation has to come from proof, not structure |
| No shared sections at all | The keyword spans multiple intents | Return to Phase 5; the target term is probably too broad |
| Target term absent from all 5 | We're naming a category nobody searches | Flag it — brand the page, target a real term alongside |
| SERP is all `social-ugc` | Buyers want peer opinion, not vendor copy | A landing page won't win this; recommend a different asset |

Across all of these: an empty or degenerate result is data. Report it as a finding with its implication, never as a step that didn't work.
