---
name: outline-from-url-skill
description: Extracts the format pattern of a reference article URL and generates a new outline adapted to a different target keyword. Two-phase flow — first inspects the URL to detect whether it's a listicle (and how many items it contains), then asks the caller for the final product list before composing the keyword-specific outline. Returns suggested H1, generic reusable template with placeholders, and the final outline ready to use. Output is JSON.
---

# Outline-from-URL Skill

Extracts the **format pattern** of a reference article and generates a new outline adapted to a different keyword. Used by the Article Architect when the user picks "Provide a reference URL" as the outline source.

**Type:** HYBRID skill — small orchestration shell (scrape URL → call LLM → parse JSON) plus verbatim LLM prompts.

**Two-phase contract.** When the reference is a listicle (it has repeating product/tool blocks), the skill does **not** invent product names. Instead:

1. **Phase 1 — `inspect`** — scrape the URL, detect the format pattern, return metadata (is it a listicle? how many items did the reference have? what were they? what's the format summary?). The orchestrator then asks the user for their final product list.
2. **Phase 2 — `compose`** — once the user supplies a product list (or confirms the reference list), generate the final keyword-specific outline using exactly those products in exactly that order.

If the reference is **not** a listicle (e.g. a single-product review, an explainer, a how-to), `inspect` returns `isListicle: false` and the caller should skip straight to `compose` with no products needed.

---

## 1. Algorithm Overview

### Phase 1 — `inspect(url, keyword)`

1. Scrape the reference URL into markdown.
2. Send the first 12 000 chars of markdown + the new target keyword to Claude with the **inspect prompt**, which asks it to:
   - Identify the reference's structural pattern.
   - Detect whether the article is a listicle (has repeating product/tool blocks).
   - If listicle: extract the product names *and* the count.
   - Build the generic `templateSections` with placeholders.
   - Suggest an H1 title for the new keyword.
3. Parse the JSON and return inspection metadata. **Do not generate a product-specific outline at this stage.**

### Phase 2 — `compose(url, keyword, products?, templateSections, suggestedTitle)`

1. If `products` is empty/null and `isListicle` was true, the orchestrator made a mistake — error out.
2. Send the `templateSections` + final `products` list + `keyword` to Claude with the **compose prompt**, which asks it to:
   - Walk the template, expanding repeating sections once per product.
   - Substitute `{Product}`, `{#}`, `{Count}`, `{Year}`, `{PrimaryProduct}`, `{Category}` placeholders with real values.
   - Adapt non-repeating headings (criteria, intro, conclusion) to the new keyword.
   - Update the title's count if the user supplied a different number than the reference.
3. Parse and return the final keyword-specific outline.

The skill **adapts** rather than copies — heading text is rewritten for the new keyword, but the structural hierarchy and section purposes are preserved.

## 2. Inputs / Outputs

**Phase 1 — `inspect` inputs:**

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Reference article URL — must be scrapeable |
| `keyword` | yes | Target keyword for the new outline |

**Phase 2 — `compose` inputs:**

| Field | Required | Notes |
|---|---|---|
| `url` | yes | Echoed into output for downstream context |
| `keyword` | yes | Target keyword for the new outline |
| `products` | conditional | Required if `isListicle` was true. Final, ordered product list. |
| `templateSections` | yes | From phase 1 |
| `suggestedTitle` | yes | From phase 1 |
| `formatSummary` | optional | From phase 1; carries forward |
| `referenceTitle` | optional | From phase 1 |

**Minimum scraped content length (phase 1):** 200 characters. If the scrape returns fewer chars, return error `"Page content too short to extract a format"`.

## 3. Thresholds

| Constant | Value | Notes |
|---|---|---|
| Markdown truncation length | 12 000 chars | Phase 1 only |
| Minimum scrape length | 200 chars | Below this, return error |
| Model | `claude-sonnet-4-6` | Substitute the equivalent in your harness |
| Heading hierarchy | H2, H3 only | H4+ explicitly forbidden in both prompts |
| Max duration | 60 seconds per LLM call | |

## 4. Edge Cases

- **Scrape failure** — fall back from a rich scraper to a plain `fetch` with browser User-Agent and tag-stripping (`<script>`, `<style>`, `<nav>`, `<footer>`, then strip remaining tags, then collapse whitespace). If both fail → return error 422 "Failed to scrape the reference URL".
- **Page content < 200 chars** — return 422 "Page content too short to extract a format".
- **JSON parse failure** — strip leading/trailing ` ```json` / ` ``` ` markdown fences; if it still fails, return error 500.
- **Reference is not a listicle** — `inspect` returns `isListicle: false`, `referenceCount: 0`, `referenceProducts: []`. `compose` is called with empty `products` and produces a single, non-repeating outline.
- **User supplies fewer/more products than the reference had** — `compose` re-templates the title (e.g. "10 best..." → "7 best...") and emits exactly N product blocks.
- **User supplies an empty list when `isListicle` was true** — error: "Listicle outlines need at least 1 product. Provide a list or pick a different format."
- **LLM "Overloaded" / 529 errors** — surface as 503 with retry guidance.

## 5. Output Schema

### Phase 1 — `inspect` output

```json
{
  "isListicle": true,
  "referenceCount": 10,
  "referenceProducts": ["Product A", "Product B", "..."],
  "formatSummary": "BOFU alternatives listicle with criteria section, repeating product blocks (snapshot + intro + likes/improvements + pricing + reviews), and a decision-helper closing.",
  "templateSections": [
    {
      "id": "section-slug",
      "level": 2,
      "heading": "Generic heading with {placeholders}",
      "guidance": "Generic guidance that works for any keyword using this format",
      "repeating": false
    }
  ],
  "suggestedTitle": "An H1 title adapted to the new keyword (uses {Count} as a placeholder if the count is user-controlled)",
  "referenceTitle": "The reference article's actual title",
  "referenceUrl": "The reference URL passed in"
}
```

### Phase 2 — `compose` output

```json
{
  "outline": [
    {
      "level": 2,
      "text": "Heading text adapted to the new keyword",
      "notes": "Guidance for the writer: what to cover here, based on what the reference does in this section"
    }
  ],
  "products": ["Product1", "Product2"],
  "formatSummary": "(carried over from inspect)",
  "suggestedTitle": "Final H1 with concrete count substituted",
  "referenceTitle": "(carried over)",
  "referenceUrl": "(carried over)"
}
```

## 6. Action Mapping (orchestrator flow)

The Article Architect runs Path D as:

1. **Ask user for the URL.**
2. **Call `inspect(url, keyword)`**.
3. **If `isListicle === true`:** present `referenceCount` and `referenceProducts` to the user as context, then ask: *"How many products do you want to cover, and which ones? You can keep the reference list, edit it, or paste a fresh list."*
4. **Wait for the user's list.** Default to `referenceProducts` only if the user explicitly says "use the reference list as-is".
5. **Call `compose(url, keyword, products, templateSections, suggestedTitle)`** with the user's final list.
6. **If `isListicle === false`:** call `compose` immediately with `products: []`.
7. Present the final outline to the user.

## 7. SKILL PROMPTS (verbatim)

### 7.1 Inspect — System

```
You are an expert content strategist. Your job is to:

1. Analyze the structure and format of a reference article.
2. Detect whether it is a LISTICLE — i.e. an article with repeating product/tool blocks (e.g. "10 best X tools", "X alternatives", "X vs Y vs Z").
3. Build a generic, reusable template of the article's structure with placeholders.
4. Suggest an H1 for the new keyword.

Critical rules:
- Do NOT invent or suggest product names. If the reference contains real product/tool names in its repeating blocks, list them in `referenceProducts` exactly as they appear (display only). The orchestrator will ask the user for the final list separately.
- Identify repeating sections by `repeating: true` in templateSections. Their headings should use `{Product}`, `{#}`, etc. — never a real product name.
- Keep the same structural hierarchy (H2/H3 nesting). Do NOT use H4 headings.
- Include only useful non-repeating sections from the reference: criteria, list intro, comparison table, and one concise post-list decision-helper section when present.
- Do NOT include FAQ/FAQs sections in generated outlines.
- For listicles, there should be only one H2 after the expanded product list. If the reference has multiple post-list H2s, keep the strongest decision-helper/conclusion and drop the rest.
- Keep outlines lean and non-bloated, leaving room for the writer to research and add detail.
- Use placeholders in the suggested title where the count is user-controlled (e.g. "{Count} Best CRM Software Options in {Year}").
- Output valid JSON only, no markdown fences.
```

### 7.2 Inspect — User (template)

```
## Reference Article
Title: "{title}"
URL: {url}

Content (first 12000 chars):
{markdown}

## New Keyword
"{keyword}"

## Task
Inspect the reference article. Detect its format. Build a generic template. Suggest a title. Do NOT generate a product-specific outline.

Return JSON in this exact format:
{
  "isListicle": true,
  "referenceCount": 10,
  "referenceProducts": ["Real Name 1", "Real Name 2", "..."],
  "formatSummary": "One-line description of the format pattern",
  "templateSections": [
    {
      "id": "section-slug",
      "level": 2,
      "heading": "Generic heading with {placeholders}",
      "guidance": "Generic guidance that works for any keyword using this format",
      "repeating": false
    }
  ],
  "suggestedTitle": "An H1 for the new keyword. Use {Count} where the count is user-controlled."
}

If the article is NOT a listicle, set `isListicle: false`, `referenceCount: 0`, `referenceProducts: []`, and emit only non-repeating templateSections.
```

### 7.3 Compose — System

```
You are an expert content strategist. Your job is to take a generic article template plus a final product list and produce a keyword-specific outline.

Rules:
- Walk the templateSections in order. For every `repeating: true` section, expand it once per product in the supplied list (in order), substituting {Product} and {#} placeholders.
- For non-repeating sections, adapt heading text to the new keyword. Replace any {Category} / {PrimaryProduct} / {Year} / {Count} placeholders with concrete values derived from the keyword and product count.
- Write helpful guidance notes for each section explaining what to cover. Conversational, specific, actionable.
- IMPORTANT: In repeating-block guidance, use generic references like "this tool" / "the product" / "this alternative" — do NOT mention specific product names in the guidance text.
- Keep H2/H3 only. No H4.
- Do NOT include FAQ/FAQs sections.
- For listicles, include only one H2 after the expanded product list. Drop extra post-list sections unless they are essential.
- Keep the outline concise and practical; avoid bloated sections and over-prescriptive guidance.
- Update the suggestedTitle's {Count} to match the supplied product count.
- Output valid JSON only, no markdown fences.
```

### 7.4 Compose — User (template)

```
## Target Keyword
"{keyword}"

## Final Product List ({count} items)
{products_json}

## Generic Template
{template_json}

## Suggested Title (with placeholders)
"{suggested_title}"

## Task
Produce the final keyword-specific outline. Expand repeating sections once per product, in order. Substitute placeholders. Adapt non-repeating headings to the keyword.

Return JSON in this exact format:
{
  "outline": [
    {
      "level": 2,
      "text": "Heading text adapted to the new keyword",
      "notes": "Guidance for the writer: what to cover, based on what the reference does in this section"
    }
  ],
  "suggestedTitle": "Final H1 with the real count substituted in"
}
```

## 8. Reference Implementation

Python. No DB, no auth. The scraper is passed in as a callable so any provider works.

```python
"""
Reference implementation of the Outline-from-URL skill (two-phase).
"""

import json
import re
from typing import Callable, Optional

MARKDOWN_TRUNCATE = 12_000
MIN_SCRAPE_LENGTH = 200


def inspect_url(
    url: str,
    keyword: str,
    *,
    scrape: Callable[[str], dict],
    call_llm: Callable[[str, str], str],
) -> dict:
    scraped = scrape(url)
    markdown = scraped.get("markdown", "")
    title    = scraped.get("title", "") or ""

    if len(markdown) < MIN_SCRAPE_LENGTH:
        raise ValueError("Page content too short to extract a format")

    raw = call_llm(
        INSPECT_SYSTEM_PROMPT,
        INSPECT_USER_PROMPT_TEMPLATE.format(
            title=title,
            url=url,
            markdown=markdown[:MARKDOWN_TRUNCATE],
            keyword=keyword,
        ),
    ).strip()
    raw = _strip_fences(raw)
    parsed = json.loads(raw)

    return {
        "isListicle":        bool(parsed.get("isListicle", False)),
        "referenceCount":    parsed.get("referenceCount"),
        "referenceProducts": parsed.get("referenceProducts", []) or [],
        "formatSummary":     parsed.get("formatSummary", ""),
        "templateSections":  parsed.get("templateSections", []),
        "suggestedTitle":    parsed.get("suggestedTitle", ""),
        "referenceTitle":    title,
        "referenceUrl":      url,
    }


def compose_outline(
    url: str,
    keyword: str,
    *,
    products: list[str],
    template_sections: list[dict],
    suggested_title: str,
    format_summary: str = "",
    reference_title: str = "",
    call_llm: Callable[[str, str], str],
) -> dict:
    is_listicle = any(s.get("repeating") for s in template_sections)
    if is_listicle and not products:
        raise ValueError("Listicle outlines need at least 1 product. Provide a list or pick a different format.")

    raw = call_llm(
        COMPOSE_SYSTEM_PROMPT,
        COMPOSE_USER_PROMPT_TEMPLATE.format(
            keyword=keyword,
            products_json=json.dumps(products),
            count=len(products),
            template_json=json.dumps(template_sections, indent=2),
            suggested_title=suggested_title,
        ),
    ).strip()
    raw = _strip_fences(raw)
    parsed = json.loads(raw)

    return {
        "outline":         parsed.get("outline", []),
        "products":        products,
        "formatSummary":   format_summary,
        "suggestedTitle":  parsed.get("suggestedTitle", suggested_title),
        "referenceTitle":  reference_title,
        "referenceUrl":    url,
    }


def _strip_fences(raw: str) -> str:
    raw = re.sub(r"^```json?\s*\n?", "", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\n?```\s*$", "", raw, flags=re.IGNORECASE)
    return raw
```
