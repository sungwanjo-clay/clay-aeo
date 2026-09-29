# Clay Marketplace `/skills?search=` pages: SEO title and meta recommendations

Per-URL titles and descriptions are in [`marketplace-skills-search-meta.csv`](./marketplace-skills-search-meta.csv) (48 URLs, with character counts, the keyword each page targets, and whether to index it).

Data sources: Ahrefs Keywords Explorer (US volumes, pulled 2026-09-29) and the live `<head>` of marketplace.clay.com. **GSC returned no data** through the Ahrefs "Clay" project (project 5873096) for any date range, so there are no click or CTR baselines here. Connect or verify the `marketplace.clay.com` property in Ahrefs GSC before measuring impact.

## 1. Why "Workflows" is the right modifier

| Keyword pattern | US volume | Notes |
|---|---|---|
| sales workflow | 1,300 | KD 0 |
| marketing workflow | 1,700 | KD 5 |
| hubspot workflows / workflow | 700 / 200 | |
| slack workflows / workflow | 700 / 500 | |
| crm workflow / workflows | 500 / 300 | KD 1, $9 CPC |
| salesforce workflow | 250 | |
| clay workflows / workflow | 150 / 70 | vs. "clay skills" 10 |
| **sales skills** | 2,100 | **wrong intent** (soft skills, not software) |
| **claude code skills / claude skills** | 10K / 20K | right intent only for AI-agent pages |

"Skills" is Clay's product noun, but searchers read it as a soft-skill word. "Workflows" matches how buyers search for GTM automation and has near-zero difficulty. **Lead the title with "{Topic} Workflows"** and keep "skills" in the description, so the page still matches the product name and AI-agent queries.

**Exception:** on the Clay agent plugin page, lead with "AI Agent Skills". There, "skills" is the high-volume, on-intent term (claude code skills 10K, agent skills 1.3K, clay mcp 300).

## 2. Templates (for current and future search, tag, and persona pages)

**Topic or category page**
- Title: `{Topic} Workflows: {Primary outcome} | Clay` (add ` Marketplace` if it still fits in 60 characters)
- Description: `{Verb} {outcome}. Clay workflows {do X}, {do Y}, and {do Z} for {audience/system}.` (140–155 characters, and include "skills" or "AI" at least once)

**Integration or partner page** (Slack, BuiltWith, Salesforce/HubSpot, Landyard, sequencer)
- Title: `{Partner} Workflows: {What the pairing does} | Clay`
- Description: `Use {Partner} data in Clay. {Job 1}, {job 2}, and {job 3}. Ready-made workflows, no manual exports.`

**Persona page** (`persona:sdr`, `persona:revops`, …)
- Title: `{Persona} Workflows: {Top 2 jobs} | Clay` or `Workflows for {Persona plural}: {jobs} | Clay`
- Description: `Clay workflows for {persona}: {job 1}, {job 2}, and {job 3}.`

**Fallback** (when nothing is hand-written)
- Title: `{Title-cased topic} Workflows & AI Skills | Clay Marketplace`
- Description: `Browse {n} Clay workflows for {topic}. Compare community-built skills that {generic outcome for category} and put them to work in your GTM stack.` Show `{n}` only when it is 3 or more. Leave the count out rather than say "1 Skill".

Rules: write in Title Case, don't put the raw query in curly quotes (today's titles look like `Skills for “slack”`), don't include `persona:` prefixes or hyphenated tag slugs in visible copy, and keep titles to 60 characters or fewer.

## 3. Technical issues to fix alongside the copy (these matter more than the copy)

1. **The canonicals are inconsistent, so the `?search=` URLs aren't the pages that get indexed.**
   - `?search=Research skills` → canonical `?category=research`
   - `?search=Slack skills` → canonical `?q=slack`
   - `?search=persona:sdr skills` → canonical `?q=persona%3Asdr`

   Google indexes the canonical URL, so apply these titles and descriptions to the canonical URLs too. Better still, move to clean paths such as `/skills/workflows/slack`, `/skills/category/research`, and `/skills/for/sdr`.
2. **Several URLs are duplicates of each other.** Consolidate each group to one canonical page (the CSV marks the canonical owner):
   - `event` / `events`
   - `crm` / `CRM` / `CRM system`
   - `Enrich` / `Enrichment`
   - `csv` / `CSV or Google Sheets`
   - `search` / `people-search`
   - `email finder/validator providers` / `Clay's email verification provider`
3. **Many pages are thin.** The marketplace lists only 34 skills, and many of these searches return one result ("Browse 1 Skill…"). Index a page only when it has 3 or more skills. Below that, use `noindex, follow` until the catalog grows.
4. **Internal tags have no search demand.** Set `clay-action` and `managed-function` to `noindex, follow`. Rename `jd` → `job-description`, `exemplar-profiles` → `lookalike-profiles`, and `brief` → `account-brief` before indexing them.
5. **"people search" (296K) is a consumer-intent trap** (TruePeopleSearch and similar sites). Target "B2B people search" / "find decision-makers" instead.
6. **Every page needs unique on-page content.** Add an H1 that matches the title topic and 50–100 words of intro copy, so these don't read as near-duplicate filtered listings.
