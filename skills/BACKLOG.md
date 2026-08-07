# Skills library — prioritized backlog & build calendar

Built 2026-08-07 by joining: SEO demand data (438 how-to use cases + 21 `clay workflows`
long-tail clusters), the Claybooks catalog (92 published, with use-case tags and authors),
the clay-gtm-architect KB (13 spines, 14 data-point playbooks, corpus counts from 425 POCs),
and the workspace's managed-function catalog. PRD alignment: Phase 1 is one-sided
(Clay-managed, admin publishes); tag pages (`/marketplace/tags/[slug]`) are the SEO surface.

**Scoring**: demand = monthly search volume (SEO sheet) or corpus frequency; evidence =
what exists to distill from (KB page / Claybook / managed function); surface = execution
substrate (managed function = stable, workflow = Alpha showcase).

---

## Taxonomy v1 (for marketplace filters + skill frontmatter)

**Category** (one per skill — merged from Claybook tags, KB motions, SEO clusters):
`find-contact-data` · `verify-and-clean` · `build-lists` · `enrich` · `score-and-qualify` ·
`signals` · `personalize-outbound` · `route-and-automate` · `research`

**Type** (the most important browse filter): `task` (one data point, minutes) vs `play`
(multi-stage motion).

**Facets** (tags array): input shape (`csv` / `crm` / `audience` / `none`), surface
(`managed-function` / `workflow` / `claygent`), integrations (`salesforce`, `hubspot`,
`slack`, …), and the SEO keyword slug the skill targets (drives its tag page).

Frontmatter fields from here on: `category`, `type`, `tags`, `keyword` (primary SEO target).

---

## Status key
✅ built & eval'd · 🔨 in factory · ⬜ backlog

## Wave A — launch-critical (build W2–W3 · Aug 17–28) — internal factory

| # | Skill | Type | Category | Demand | Evidence | Surface |
|---|---|---|---|---|---|---|
| A1 | find-work-email ✅ | task | find-contact-data | 68,850/mo | KB email page · Work Email fn · eval'd | managed fn |
| A2 | verify-email-deliverability | task | verify-and-clean | 16,880/mo | KB email page (validator tiers, catch-all) · Claybook "Domain Deliverability Check" | managed fn |
| A3 | find-work-phone | task | find-contact-data | 7,940 + 1,380 + 1,180/mo | KB mobile-phone page (14-finder roster) · Find Phone Number fn · Claybook (phone via email) | managed fn |
| A4 | clean-email-list | task | verify-and-clean | 8,010 + 1,500/mo | Claybook "Automate email data cleaning" · KB email page | managed fn |
| A5 | enrich-signup-users (reverse: person from email) | play | enrich | 4,950 + 2,120/mo + P0 cluster (1,310) | KB email-type-routing + inbound-LE spine · existing internal prototype | managed fns |
| A6 | dedupe-contacts | task | verify-and-clean | 3,720/mo | crm-hygiene spine · SFDC DeDupe fn · sfdc-dedup-hierarchy primitive | managed fn |
| A7 | find-linkedin-profile | task | find-contact-data | 3,030 + 2,970/mo | KB linkedin-url page (find→validate→recover) · functions | managed fn |
| A8 | build-prospect-list (people + companies) | play | build-lists | 9,220 + 2,250 + 1,850/mo + P0 cluster (900) | contact-sourcing spine (170 wbs) + tam-sourcing spine · Claybooks ×4 | search + fns |
| A9 | track-champion-job-changes ✅ | play | signals | Claybook exact match · corpus job-change fork (3 won) | champion-alumni primitive · eval'd | workflow |
| A10 | score-inbound-leads | play | score-and-qualify | P1 cluster + 1,530/mo | contact/account-scoring spines · scoring-composition primitive | fn + formula |
| A11 | detect-tech-stack | task | research | competitor/displacement demand | KB technographics page (4 scenarios) · Website Technology Stack fn · Claybook (displacement) | managed fn |
| A12 | monitor-buying-signals | play | signals | 1,140/mo + Claybook Signals series (8 books) | KB buying-signals page (12-signal menu) · Company News fn | fn + workflow |

Wave A = 12 skills; every taxonomy category covered by ≥1, `find-contact-data`/`verify-and-clean`
(the SEO heads) covered by 3+ each. Ten of twelve ride the stable managed-function surface;
A9 + A12 are the workflow showcases (re-verify in launch week per gotchas discipline).

## Wave B — launch-plus (W4 · Aug 31–Sep 4)

| # | Skill | Type | Category | Demand | Evidence |
|---|---|---|---|---|---|
| B1 | scrape-any-website | task | research | 9,090 + 3,000/mo | KB scrapers.md (zenrows/CSS decision ladder) · Claybooks ×3 |
| B2 | source-local-businesses (Google Maps) | play | build-lists | 1,320/mo | tam-sourcing SMB sub-motion · Claybooks ×2 (Openmart, Maps) |
| B3 | enrich-and-route-leads | play | route-and-automate | P2 clusters (~250 combined) | inbound-LE + lead-routing spines · Claybook (Typeform) |
| B4 | clean-and-refresh-contact-data | play | verify-and-clean | Claylist one-pager (July 2026) | full walkthrough PDF + contact-freshness loop |
| B5 | find-decision-makers-at-company | task | find-contact-data | 1,640 + 1,080/mo | Find People at Company fn · buyer-classification page · Claybook |
| B6 | company-research-brief | task | research | 1,640/mo | company-overview page · Claybooks (ICP briefs, account research) |

## Wave C — post-launch / influencer-matched (Sep+)

Motion skills mapped to the creator roster (Phase-1 model: they submit via the upload form,
admin publishes with author attribution — the Claybooks precedent, 27 external authors
already). Candidates: personalize-outbound-from-case-studies (marketing-page-evidence-mining
primitive + Claybook), warm-intros-via-network (Swarm primitive + Claybooks ×3),
competitor-displacement (technographics scenario B), monitor-job-movers-market-wide,
signal-driven-outbound (spine), full-lead-lifecycle (P3 cluster: enrich+score+route),
Salesforce mass-update/hygiene (1,770/mo + GTM Ops patterns), influencer-sourcing
(Claybook ×2), event-signup-enrichment (Claybook).

## Explicitly NOT building (from the SEO sheet's own "No" rows)

Navigational/head terms (`clay workflows`, templates/examples), comparisons (`clay vs n8n`),
documentation intents — tag pages can exist, but no skill.

---

## Calendar fit (work-back plan, launch Thu Sep 10)

- **W1 (Aug 10–14)**: taxonomy v1 → Ploy filters; frontmatter spec updated; A2, A3, A7
  through the factory (task skills, ~1/day once the pattern is warm).
- **W2 (Aug 17–21)**: A4–A6, A11 built; upload path live → factory submits through it;
  influencer invites out Fri with Wave-C menu attached (they pick, we dedupe).
- **W3 (Aug 24–28)**: A8, A10, A12 (the bigger plays); brand review; every Wave-A skill
  through the QA table + eval gate.
- **W4 (Aug 31–Sep 4)**: Wave B as capacity allows (B4 first — the Claylist PDF makes it
  cheap); influencer uploads open Sep 4; white-glove first submissions.
- **W5 (Sep 8–10)**: workflow-surface re-verify pass (A9, A12); freeze; launch with
  18–20 skills, every category ≥2.

Throughput assumption: task skill ≈ 0.5–1 day incl. eval (proven on A1); play skill ≈ 1–2
days (proven on A9). Two skills already done means Wave A needs ~10 build-days across 3
weeks — comfortable for one person + agent, tight if marketplace build competes for the same
person; flag if A8/A10/A12 need to slip to Wave B.
