---
name: aeo-listicle-outreach
description: Finds third-party listicles that AI models cite for benchmark keywords, filters for ones where Clay is missing but should be mentioned, enriches the author with an email, drafts a mirror article + outreach email that trades a positioning review for reciprocal mention. Invoke whenever the user wants to run an AEO outreach cycle, find listicles missing Clay, prospect authors of high-citation articles, or generate the mirror-article + email pair for a target URL. Requires network access to api.ahrefs.com and api.firecrawl.dev; reads from Supabase (aeo_cache_domain_urls) and writes to aeo_outreach_log.
---

# AEO Listicle Outreach

Third-party listicles drive most AI citations for benchmark keywords. When Clay is missing from one, we don't fix it by writing our own listicle — we prospect the author, offer a genuine positioning review of a mirror article we're publishing, and ask for reciprocal mention. This skill runs the discovery → enrichment → drafting pipeline end-to-end with explicit approval points.

**Type:** PROCEDURAL. Runs live queries against Supabase, Ahrefs, and Firecrawl; hands off to `outline-from-url-skill` and a format skill for article drafting.

**Network hosts required at runtime:** `api.ahrefs.com`, `api.firecrawl.dev`, your Supabase project URL. This skill will fail in restricted-egress sessions where those hosts are denied — run it locally or in a session with those hosts allowlisted.

---

## Environment

Reads from process env (do not hardcode):

| Var | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (skill only reads, but the outreach log write needs it) |
| `AHREFS_TOKEN` | MCP-generated token from Ahrefs Account Settings → API Keys → "Generate MCP key" |
| `FIRECRAWL_API_KEY` | Firecrawl API key (fallback scraper only) |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | For the LLM classifier + drafting handoffs |

Clay MCP is expected to be already wired at the session level (`mcp__Clay__find-and-enrich-contacts-at-company`).

---

## Inputs

| Field | Required | Notes |
|---|---|---|
| `lookback_days` | no | default `14` |
| `top_n` | no | max candidate URLs to pull; default `200` |
| `min_ahrefs_dr` | no | domain rating floor; default `30` |
| `min_ahrefs_traffic` | no | monthly organic traffic floor; default `5000` |
| `platforms` | no | AI platforms to include (openai / perplexity / etc); default all |

---

## PROCEDURE

### Stage 1 — Pull candidate URLs from Supabase

Run `scripts/fetch_candidates.ts` (Node). It executes:

```sql
SELECT domain, url, MAX(title) AS title, SUM(url_count) AS citations
FROM aeo_cache_domain_urls
WHERE run_day >= CURRENT_DATE - INTERVAL '{lookback_days} days'
  AND prompt_type ILIKE 'benchmark'
GROUP BY domain, url
ORDER BY citations DESC
LIMIT {top_n};
```

Writes candidates to `.aeo-outreach/candidates.json`. Print top 20 to stdout so the user sees what's coming.

### Stage 2 — Filter own domain, social, docs, and noise

Drop any URL whose domain matches:
- `clay.com` and any subdomain
- Social: `youtube.com`, `linkedin.com`, `twitter.com`/`x.com`, `reddit.com`, `facebook.com`, `tiktok.com`, `instagram.com`, `threads.net`
- Regulatory / help-center noise: `ftc.gov`, `ico.org.uk`, `support.google.com`
- News aggregators / discussion: `news.ycombinator.com`, `quora.com`, `medium.com`

Also drop URLs that look like technical documentation via cheap subdomain/path patterns:
- Subdomain starts with `docs.`, `developer.`, `dev.`, `api.`, `help.`, `support.`, `learn.`, `university.`, `kb.`, `status.`
- Path starts with `/docs/`, `/reference/`, `/api/`, `/developer/`, `/help/`, `/support/`, `/learn/`, `/university/`, `/kb/`, `/status/`

**Competitor listicles are NOT filtered here.** If Apollo or ZoomInfo runs a listicle where Clay is missing, that's exactly the kind of target we want — we're happy to reciprocate a mention. Non-listicle content from competitor domains falls out at Stage 4 via the classifier.

Optional manual override: `.aeo-outreach/manual_deny.txt` (one domain per line, `#` comments OK) — use for sites you've already reached out to, or one-off exclusions.

Write filtered set to `.aeo-outreach/candidates_filtered.json`.

### Stage 3 — Ahrefs quality gate

For each remaining domain, call the Ahrefs MCP tool `site-explorer-overview` (or REST equivalent at `api.ahrefs.com/v3/site-explorer/overview`). Auth: `Authorization: Bearer $AHREFS_TOKEN`.

Reject rows where `domain_rating < min_ahrefs_dr` OR `organic_traffic_monthly < min_ahrefs_traffic`. Batch calls in parallel (max 5 concurrent).

Writes `.aeo-outreach/candidates_dr_passed.json` with `{...url, dr, traffic}` per row.

### Stage 4 — Scrape + listicle classification

Run `scripts/scrape_url.ts <url>` for each survivor. It tries in order:
1. Plain `fetch()` + Mozilla Readability (npm `@mozilla/readability`) — free, handles static HTML.
2. If Readability returns < 500 chars of body, fall back to Firecrawl (`POST https://api.firecrawl.dev/v1/scrape` with `{url, formats:['markdown'], onlyMainContent:true}`).

Extract from the scrape: `title`, `published_date`, `author_byline`, `main_content_markdown`, `h2_headings[]`, `h3_headings[]`.

Then run `scripts/detect_listicle.ts` — an LLM classifier that takes the h2/h3 headings + first 1500 chars and returns one of `listicle | comparison | guide | news | other`. Keep only `listicle` and `comparison`.

### Stage 5 — Clay-mention check

For each survivor, check if `main_content_markdown` matches `\b(clay\.com|clay)\b` case-insensitively AND is not just in a footer/nav mention. Rules:
- `clay.com` link → mentioned → drop
- Word "Clay" in a repeating product-block heading → mentioned → drop
- Only appearance is in "See also" / footer / navigation → NOT mentioned → keep as target

Writes `.aeo-outreach/targets.json`.

### Stage 6 — Author enrichment via Clay MCP

Two resolution paths, chosen per target based on the scraped byline:

**Path A — Named author.** If `author_byline` is a real person's name (first + last, not a role/team name), call:

```
mcp__Clay__find-and-enrich-contacts-at-company({
  company_domain: <target domain>,
  first_name: <parsed first>,
  last_name: <parsed last>
})
```

Fallback if that returns no email:
```
mcp__Clay__find-and-enrich-list-of-contacts({
  contacts: [{ name: <byline>, company: <target domain> }]
})
```

If both fail, ALSO run Path B below (the SEO lead is often the right escalation contact anyway) and CC them on the outreach.

**Path B — Team byline or unnamed.** If the byline is empty, or matches patterns like `"The X Team"`, `"X Editorial"`, `"Marketing Team"`, `"Content Team"`, or any generic role, search for the SEO/AEO lead at the company. Call:

```
mcp__Clay__find-and-enrich-contacts-at-company({
  companyIdentifier: <target domain>,
  contactFilters: {
    job_title_keywords: [
      "SEO", "AEO", "GEO",
      "Organic", "Content Marketing",
      "Head of Content", "Editorial",
      "Growth Marketing"
    ]
  },
  dataPoints: { contactDataPoints: [{type: "Email"}, {type: "LinkedIn"}] }
})
```

Preferred titles in order (pick the most senior match at the domain):
1. Head of SEO / Director of SEO / SEO Lead / SEO Manager
2. Head of AEO / AEO Lead / GEO Manager
3. Head of Content / Content Marketing Manager / Editorial Director / Head of Editorial
4. Growth Marketing Manager / Head of Growth (only if content is part of their remit)

Skip founders/CEOs unless it's an unequivocal SMB or the founder personally writes the blog.

**Log the resolution path per target** in `authors_enriched.json`:
- `resolution: "named_author"` — Path A succeeded
- `resolution: "named_author_plus_seo_cc"` — Path A found a person, Path B found an SEO lead to CC
- `resolution: "seo_lead_fallback"` — Path A failed, Path B succeeded
- `resolution: "team_byline_lookup"` — no named author, Path B succeeded
- `resolution: "unresolved"` — nothing found

In the outreach email:
- `To:` primary contact (named author when available, else SEO lead)
- `CC:` SEO/AEO lead if resolved and distinct from the primary

If both paths fail, keep the row with `author_email = null` — the user may resolve manually.

Writes `.aeo-outreach/targets_enriched.json`.

### Stage 7 — Present shortlist for approval

Print a table to stdout:

```
| # | URL | Domain | DR | Traffic | Author | Email | Why target |
|---|-----|--------|-----|---------|--------|-------|-----------|
```

Then ask the user (in chat):

> Here are the {N} targets that passed all filters. Reply with the numbers to proceed with (e.g. `1,3,5`), `all`, or `none` to abort.

Wait for user response. Save the approved subset to `.aeo-outreach/targets_approved.json`.

Also insert one row per approved target into `aeo_outreach_log` with `status = 'queued'`.

### Stage 8a — Draft the mirror article outline

For each approved target:

1. Derive the mirror keyword. Rule: the target's H1, minus year and count. E.g. "10 Best Data Enrichment Tools for 2026" → keyword `best data enrichment tools`.
2. Call `outline-from-url-skill` phase 1 (`inspect`) with `{url: target_url, keyword: mirror_keyword}`.
3. Take `referenceProducts[]`. Add "Clay" to the list at position 1 (or at the position that reads most naturally based on category — ask the user if unclear).
4. Call `outline-from-url-skill` phase 2 (`compose`) with `{url, keyword, products: [Clay + approved list], templateSections, suggestedTitle}`.
5. Hand off the compose output to the correct format skill based on `formatSummary`:
   - "best-of listicle" or similar → `best-of-format-skill`
   - "alternatives / comparison" → `alternatives-format-skill`
   - "review" → `review-format-skill-3`
   - "how-to / tutorial" → `how-to-format-skill`
6. Optionally run `content-term-analysis-skill` on the same keyword to add TF-IDF term guidance.
7. Save the outline to `.aeo-outreach/drafts/{slug}.md`.

Update the outreach log: `status = 'outline_ready'`.

### Stage 8b — Enrich placeholders with real assets

Format skills leave placeholders like `[Add photo]`, `[Add product photo]`, `Pricing varies — verify on the official site`, `Reviews: TBD (add once verified)`. Replace them with real data by running `scripts/enrich_article.ts <slug>.md`, which for each product in the outline:

1. **Screenshot** — try `/pricing` first for a feature/pricing table; fall back to `/` hero. Use Playwright with the pre-installed Chromium at `/opt/pw-browsers/chromium`. Save to `.aeo-outreach/drafts/{slug}-assets/{product-slug}.png`. Insert a markdown image reference immediately after the product's `Quick Snapshot` bullets.
2. **Pricing** — fetch the product's `/pricing` page (fallback: homepage) via the scraper, then use the LLM classifier pattern (OPENAI_API_KEY or ANTHROPIC_API_KEY) to extract:
   - Model type (freemium / paid tiers / usage-based / enterprise / quote-only)
   - Entry price (numeric or "free")
   - Tier names
   Substitute into the `Pricing:` snapshot bullet. If pricing is genuinely not public, keep "Pricing varies — verify on the official site" but tag it in log so the user knows.
3. **Proof / Reviews** — DO NOT auto-fill for competitor products (too risky to invent). For Clay specifically, pull proof from `Editorial Content/clay-knowledge-context-v2.txt` via the Google Drive MCP (the context-update skill maintains this file). If no proof is available for Clay in a given article's angle, leave the placeholder — never invent.

Save the enriched article to `.aeo-outreach/drafts/{slug}.enriched.md`. Update the log: `status = 'draft_ready'`.

### Stage 8c — Publish to Google Doc for human review

Publish `{slug}.enriched.md` to a new Google Doc so the user can review the article visually (with screenshots inlined) before outreach goes out.

Use the Google Drive MCP:
1. `mcp__Google_Drive__create_file` with a Google Docs mimeType, name `AEO Outreach — {mirror_title}`, in the "Editorial Content / AEO Outreach" folder (create the folder if missing).
2. For each screenshot in `{slug}-assets/`, upload to Drive as an image via `create_file`, then insert into the Doc at the marked position. If the Docs API image-insertion flow is too fiddly to script, fall back to attaching screenshots as separate Drive files in the same folder and adding "See screenshot: {filename}" placeholders in the Doc.
3. Set Drive permissions so the user can edit.
4. Store the Doc URL in `aeo_outreach_log.status_note`. Update `status = 'awaiting_review'`.

Then print to the user in chat:

> Draft ready for review. Please open the Google Doc, edit anything that reads wrong, and reply `approved N` (where N is the target number from the shortlist) once you're happy. I'll then draft the outreach email for that target.
>
> Doc: {url}

Do NOT proceed to stage 9 until the user replies with explicit approval per target.

### Stage 9a — Generate paste-ready Clay entry

Before writing the email, run `scripts/generate_mention_block.ts <scrape.json> <clay_positioning.json>` for each approved target. This produces a Clay entry that mimics the target article's exact structure, heading levels, bullet style, sub-section pattern, and voice — so the author can paste it in verbatim without rewriting.

The `<clay_positioning.json>` file holds article-specific Clay facts (positioning, pricing, key features, differentiator, proof) that the skill body assembles from `clay-knowledge-context-v2.txt`. Never invent facts beyond that block.

Output includes `block_markdown` (the paste-ready entry), plus short `tone_notes`, `structure_notes`, and `position_recommendation` (where in their list Clay would slot in most naturally).

### Stage 9b — Draft outreach email (post-review)

For each target with `status = 'draft_ready'`, generate an email using this exact template (adjust placeholders only — do not change the ask):

```
Subject: Made you a paste-ready Clay entry for "<target_title>"

Hi <FirstName>,

I'm <UserFirstName> from Clay. I've been reading your piece on "<target_title>" — the section on <specific_thing_from_scrape> was particularly sharp.

Clay isn't in the list right now, and I think we'd actually be a natural fit alongside <name of 2 tools from their list> — teams tend to stack us with those tools rather than pick between them, because <one-line reason based on Clay's differentiator>. To make it zero-effort if you agree, I drafted a Clay entry that matches your article's structure and voice exactly — you can paste it in as-is or edit freely:

--- PASTE-READY CLAY ENTRY ---
<block_markdown from generate_mention_block.ts>
--- END ---

Suggested position: <position_recommendation from generate_mention_block.ts>.

In return: I'm publishing "<mirror_article_title>" next week, and I'd love to include <TargetPublication> in it — either linking to your piece as the authoritative source on this category, or featuring <FirstName> as a quoted expert. Whichever you'd prefer.

Two smaller things I'd genuinely value your read on before we publish ours:
1. <positioning_question_1>  (e.g. "We're calling Clay 'waterfall enrichment across 100+ providers' — does that read as accurate or overclaiming to you?")
2. <positioning_question_2>  (e.g. "We position it as best for RevOps building custom pipelines. Would you frame the ideal user differently?")

Happy to send you the full draft if that helps — takes 5 min to skim.

Thanks either way,
<UserFirstName>
```

Guardrails:
- Never fabricate a "you mentioned X in your bio" — only reference things pulled from the scraped article.
- The paste-ready block must come from `generate_mention_block.ts` — do not hand-write it, or it won't match the target's voice.
- The reciprocity offer is concrete (link/quote), not vague. Pick one that fits the target's likely motivation (publication link for outlets with ranking-sensitive traffic, quoted-expert for individual authors building their brand).
- Two positioning questions max, drawn from real ambiguity in the mirror article — never invented, never asking about something you've already stated firmly in the mirror piece.
- Never insert intentional errors (pricing typos, name misspellings, etc). The ask must be a real ask.

Save to `.aeo-outreach/emails/{slug}.md`. Update log: `status = 'email_ready'`.

Only draft emails for targets whose article was `approved` in stage 8c. Never draft an email for a target still in `awaiting_review` or `draft_ready` — the human review is a hard gate.

### Stage 10 — Webflow publish (STUB — do not implement automation yet)

Print to the user:

> All drafts + emails ready in `.aeo-outreach/`. Webflow push is intentionally not automated. Review each draft, then push to Webflow manually via CMS. When we're ready to automate this, I'll add the collection ID + field mapping to the skill.

Do not call the Webflow API in this version.

### Stage 11 — Log the run

Update `aeo_outreach_log` for each processed target with final status. Print a summary:

```
Run summary
  Candidates pulled:      {n_stage1}
  After domain filter:    {n_stage2}
  Passed Ahrefs quality:  {n_stage3}
  Listicles/comparisons:  {n_stage4}
  Missing Clay mention:   {n_stage5}
  Author enriched:        {n_stage6}
  Approved by user:       {n_stage7}
  Drafts produced:        {n_stage8}
  Emails drafted:         {n_stage9}
```

---

## OUTPUT RULES

- Every stage writes an intermediate JSON file so the pipeline is resumable and inspectable.
- The skill NEVER sends emails, pushes to Webflow, or publishes anything. Human approval gates at stage 7 (target shortlist) and stage 10 (publish decision).
- All secrets from env; nothing hardcoded.
- If a scraper or MCP fails on a specific row, that row moves to `status = 'failed'` with the error message and the pipeline continues.

## GLOBAL RULES

1. Never invent an author name if the scrape returned none — mark the row `author = null` and skip enrichment.
2. Never invent a "positioning question" — draw it from real ambiguity in the mirror article's Clay positioning.
3. Never claim a positioning-review request that's insincere (e.g. don't add intentional pricing errors). The ask must be a real ask.
4. The reciprocal-mention offer is separate from the review ask — never phrased as an exchange.
5. If Ahrefs is not reachable, mark all rows `dr = null, traffic = null` and let the user override the DR/traffic filter to proceed — do not fail the whole run.
6. Deduplicate against `aeo_outreach_log`: never re-target a URL that already has status `sent`, `replied`, `mentioned`, or `published`. Prompt user for confirmation if targeting a URL that previously reached `queued` or `email_ready` and got stuck.

---

## Files

- `SKILL.md` — this file
- `scripts/package.json` — dependencies (`@mozilla/readability`, `jsdom`, `playwright`, `tsx`, `typescript`)
- `scripts/fetch_candidates.ts` — Stage 1 Supabase query
- `scripts/domain_filter.ts` — Stage 2 own/social/competitor filter
- `scripts/ahrefs_check.ts` — Stage 3 Ahrefs quality gate
- `scripts/scrape_url.ts` — Stage 4 fetch+readability with Firecrawl fallback
- `scripts/detect_listicle.ts` — Stage 4 LLM classifier
- `scripts/check_clay_mention.ts` — Stage 5 mention detection
- `scripts/run_pipeline.ts` — orchestrator for stages 1–5 (author enrichment + shortlist prompt handled in skill body via Clay MCP)
- `scripts/capture_screenshot.ts` — Stage 8b Playwright screenshot (pricing → homepage fallback)
- `scripts/extract_pricing.ts` — Stage 8b LLM-driven pricing extractor
- `scripts/enrich_article.ts` — Stage 8b placeholder substitution
- `scripts/publish_gdoc.ts` — Stage 8c Google Doc publisher
- `scripts/generate_mention_block.ts` — Stage 9a paste-ready Clay entry matching target article's tone/structure
- `supabase/aeo_outreach_log.sql` — outreach log table migration (apply once)
