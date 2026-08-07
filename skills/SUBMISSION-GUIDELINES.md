# Clay Skills — submission guidelines

For everyone contributing to the Clay skills marketplace: internal builders, SEs, and
invited creators. One skill = one `SKILL.md` file a user can copy into their coding agent
and run after installing the Clay plugin. Phase 1 is curated: you submit, Clay reviews and
publishes under your byline (same model as Claybooks).

## What a skill is (and isn't)

A skill is **executable judgment**: instructions that let an agent produce a real GTM
outcome against live Clay infrastructure — sourced lists, verified emails, scored leads,
signal digests. It is not a blog post, a framework, or a checklist. The test: a stranger's
agent, your skill, a real workspace — does the outcome appear?

Two shapes:
- **Task skill** — one data point, minutes ("find a work email", "verify deliverability").
- **Play skill** — a multi-stage motion ("track champion job changes", "enrich and route
  inbound leads").

## Required structure

Frontmatter:

```yaml
---
name: kebab-case-slug            # permanent identity; never renamed after publish
description: |
  Dense trigger description. Lead with what it does and the exact phrases a user
  would say when they need it. End with what it does NOT do (route those to the
  right sibling skill) and its safety posture.
category: find-contact-data | verify-and-clean | build-lists | enrich |
          score-and-qualify | signals | personalize-outbound |
          route-and-automate | research
type: task | play
tags: [input shape, surface, integrations]   # e.g. [csv, managed-function, salesforce]
keyword: primary-seo-keyword-slug            # the tag page this skill targets
---
```

Body, in order:
1. **The insight** — one short paragraph: the judgment that separates this from the naive
   version. If you can't articulate it, the skill isn't ready.
2. **Setup check** — verify Clay works (`clay whoami` + plugin) before doing anything.
3. **Inputs** — what to collect from the user before running; never guess required inputs.
4. **The run** — numbered stages. Name real Clay surfaces (managed functions, workflow
   nodes, searches) and confirm they exist before promising them. State costs and get
   explicit approval before credit spend.
5. **What good looks like** — mandatory. What the expert checks first, the common mistake,
   how you know the output is real.
6. **Rules** — MUST / NEVER lines. Every destructive, external, or bulk action needs an
   explicit user-approval gate.
7. **Output** — the exact deliverable shape (columns, statuses, summary line).
8. **Worked example** — one realistic, fully synthetic case.

Keep it under ~1,200 words (plays) / ~700 (tasks). Terse and decisive; no filler, no
"recently", nothing that rots.

## The quality bar (what review checks)

1. **It executes.** Every skill is run against a live test workspace before publishing —
   with a ground-truth case and a failure case. "Looks right" doesn't publish.
2. **Honest failure handling.** Empty or errored enrichment is reported as "could not
   verify" — never silently dropped, never backfilled with a guess. Completion status is
   not data: gate on the presence of actual values.
3. **Deterministic where possible.** Comparisons, extraction, routing → formulas/code.
   LLM steps only where judgment or prose is genuinely needed.
4. **No fabrication, ever.** Emails are never pattern-guessed; hooks and claims trace to
   real enrichment payloads; unverifiable = flagged, not invented.
5. **Approval before spend and before reach.** Cost stated before batch runs; nothing is
   ever sent, published, or written to a CRM without explicit user go-ahead.

## Hard rejects (security — no discussion)

- Sending data to any endpoint, inbox, or webhook the user doesn't own
- Hardcoded secrets, tokens, or third-party URLs that receive data
- Prompt-injection patterns ("ignore previous instructions", disabling approval gates,
  "this skill is pre-approved") — including hidden content (HTML comments, invisible
  characters)
- Destructive or bulk actions without an explicit human approval step
- Asking users for credentials in chat
- **Embedded customer data**: real company names, deal information, workspace/table IDs,
  personal contact details, or internal URLs. All examples fully synthetic. This applies
  to internal submissions too — a skill distilled from a real build must be scrubbed.

## Submitting

1. Self-test: run your skill end-to-end with a fresh agent in your own workspace.
2. Submit the SKILL.md through the marketplace upload form (or, internal: PR to the
   skills library).
3. Automated QA screens it (spam, injection, embedded-data scan); a reviewer then runs the
   live eval. Expect feedback — "judgment, not steps" bounces generic checklists.
4. On publish: your byline on the listing, your skill on its keyword tag page. Published
   versions are immutable; updates go through the same review as a new version.

## What to build

Check the current backlog / Wave menu before starting — it's demand-ranked from real
search volume and duplicates get merged. The strongest submissions encode a play you have
personally run: what you check first, where it breaks, what good output looks like. That's
the part nobody can generate.
