# Output templates and worked examples

One template per mode. The shapes matter less than the two habits they enforce: lead with the finding that changes the decision, and attach a number to every claim.

## Contents

1. [Mode A — full brief](#mode-a--full-brief)
2. [Mode B — metadata only](#mode-b--metadata-only)
3. [Mode C — discovery](#mode-c--discovery)
4. [Worked example: Account Agents](#worked-example-account-agents-mode-a)
5. [Worked example: Clay Workflows](#worked-example-clay-workflows-mode-a)

---

## Mode A — full brief

```markdown
# SEO Brief — [Product] Landing Page ([url])

**Quick finding:** [2-4 sentences. Lead with the single most surprising data
point. Name the one thing that changes what they'd otherwise do.]

🚨 Launch blocker #N — [only if something will actively break]
⚠️  [Collision / cannibalization / conflict flags]
📉 [Anomalies worth a separate workstream]

## Recommended keywords
**Primary (own the page around):** [branded term] + [category term]

**Context:** [DR. What the domain already ranks for, with positions and click
numbers. Cannibalization risks with specific URLs. Internal link sources.]

## Recommended metadata
Title tag (~N chars): `...`          ← "why" beneath, quoting their draft
Meta description (~N chars): `...`
URL slug: `...`
H1 / eyebrow: ...

## Organic SERP teardown
[the two blocks from references/serp-teardown.md]

## Topics to cover (matches your current draft structure)
- [Their section header] → *target keyword*    [+ gap flags from the teardown]

| Keyword | Volume/mo | CPC | Difficulty | Note |
|---|---|---|---|---|

## Do not target
| Keyword | Volume/mo | Why not |
|---|---|---|

## Decisions blocking launch
1. ...
```

The "Note" column in the keyword table is where the brief earns its keep — it's not a description of the keyword, it's the reason to target it or not, with the SERP evidence in it. See the worked examples.

## Mode B — metadata only

Short by design. Someone asking about a title tag wants an answer, not a research report — the evidence is there to justify the change, and nothing more.

```markdown
# Metadata recommendation — [url]

**Live performance (GSC, trailing 90d):** [clicks, impressions, avg position,
CTR]. [One line: is this a ranking problem or a metadata problem?]

**Currently ranking for:** [top queries with position + CTR]

## Title
Current (N chars):     `...`
Recommended (N chars): `...`
Why: [specific defect — missing a term the page already ranks for, jargon in
the opening pixels, plural/singular against the click data]

## Description
Current (N chars):     `...`
Recommended (N chars): `...`
Why: ...

[Page-one title patterns, if the teardown ran: what the ranking pages do]

**Change scope:** [minimal / moderate / rewrite] — [why]
```

If CTR is already strong, say so and recommend the smallest possible edit. `/claygent` converted at 48.6% and the correct answer was a one-word change; a full rewrite there would have destroyed value while looking like diligence.

## Mode C — discovery

No page, no draft. The job is to make the conversation better-informed, so the output is oriented around options and open decisions rather than recommendations.

```markdown
# SEO discovery — [product/topic]

**Quick finding:** [the most surprising thing in the data]

## Is there demand?
| Keyword | Volume/mo | TP | KD | CPC | Read |
|---|---|---|---|---|---|
[TP vs volume disagreements called out explicitly]

## What the SERP looks like
[type mix, incumbent DRs, intent pollution, AI Overview presence]
[teardown blocks if the SERP is teardownable]

## What this domain already has
[existing rankings, stranded pages, cannibalization risk, the queries we
already earn that nobody built a page for]

## Positioning options
### Option 1 — [angle]
Targets: ... | Upside: ... | Cost: ... | Risk: ...
### Option 2 — [angle]
### Option 3 — [angle]

## Proposed page skeleton (if we build it)
[sections derived from the teardown's table-stakes + wedge buckets]

## Do not target
| Keyword | Volume/mo | Why not |

## Decisions to make
1. ...
```

Three options is usually right. One reads as a recommendation you haven't earned yet; five is abdication.

---

## Worked example: Account Agents (Mode A)

Note how the quick finding delivers *bad* news first — no SERP exists for the product name — and then immediately reframes it into the play. That's the shape to aim for.

> **Quick finding:** "Account Agents" itself — along with "AI account research agent," "account research agent," "signal-triggered workflows," and "account-based AI" — are all confirmed zero-measurable-volume branded/emerging phrases in Ahrefs. There's no organic SERP to chase for the exact product name. The play is the same as Workflows: own the branded term editorially, and target the real feature-intent categories buyers actually search — several of which are genuinely low-competition white space right now.
>
> **Primary:** Account Agents (branded/product term — zero measurable volume, high purchase intent, no competition)
>
> **Context:** clay.com already ranks #1 for "claygent" (250/mo, KD 0) via its glossary page — link to it directly from the "How are Account Agents different from a Claygent" FAQ. Outside of that, clay.com has no existing rankings for any "agent" query — genuinely new ground for the domain, so no cannibalization risk, but no existing authority to lean on either. DR 79 helps entering moderate-difficulty terms.
>
> **Title tag (~58 chars):** `Account Agents by Clay | AI Agents for Every Account`
> **H1:** Keep "Put an expert agent on every account" for brand voice, but add "AI" once nearby — "agent" appears 15+ times on the page without "AI" until deep in the FAQ, which is the single biggest on-page gap.

| Keyword | Vol/mo | CPC | KD | Note |
|---|---|---|---|---|
| ai sales agent | 1,900 | $9.00 | 43 (high) | Highest volume, but SERP owned by dedicated AI SDR tools (Artisan, SalesCloser, Salesforce) — off-target for this page. Better as an adjacent blog/glossary term linking back here. |
| ai agent observability | 350 | $12.00 | 16 (low) | **Best opportunity.** SERP is 100% generic dev-tool observability (LangChain, Arize, Splunk, Dynatrace) — nobody owns the sales/GTM angle. Prioritize for the Observability section. |
| agentic ai for sales | 250 | — | n/a (no fixed SERP) | Emerging category, no entrenched competitors — strong hero/umbrella phrase to plant a flag on early. |
| signal based selling | 90 | $9.00 | 8 (very low) | Established term (Cognism, Demandbase, Apollo, ZoomInfo rank) but low difficulty. Direct match to the Next Best Action framing. |
| next best action ai | 80 | $6.00 | 4 (near zero) | Easiest win in the set — reinforces the section header verbatim. |
| ai agents for sales teams | 70 | — | n/a | Low volume, supporting phrase only — body copy, not a target. |

The `ai agent observability` row is the whole method working: a mid-volume keyword with a low KD *and* a SERP teardown showing every incumbent is solving a different problem. Neither number alone would have surfaced it.

## Worked example: Clay Workflows (Mode A)

> **Quick finding:** "clay workflows" itself is a near-zero-volume branded term (~20/mo) with no real organic SERP yet — not something to chase alone. The play is to own that branded phrase while targeting the higher-volume feature-intent terms people actually search when evaluating this category.
>
> **Context:** clay.com already ranks **#41 for "workflow automation" (74K/mo** — currently underperforming, big upside if this page is well-optimized) and top 10 for "sales workflow" / "sales workflows" via glossary pages. This landing page should reinforce those rankings rather than compete with them — link to and from the glossary pages.
>
> **Title tag (55 chars):** `Clay Workflows: AI-Powered Workflow Automation for GTM`
> **Terms to weave naturally:** workflow automation, AI workflows, no-code, lead enrichment, lead routing, GTM automation, integrations, templates — avoid stuffing "clay workflows" itself since demand for that exact phrase is minimal; let the brand carry it.

| Keyword | Vol/mo | CPC | Competition | Note |
|---|---|---|---|---|
| workflow automation software | 3,600 | $31.68 | 0.09 (low) | Best volume/competition ratio — prioritize |
| ai workflow automation | 4,400 | $17.03 | 0.36 | Highest volume; broader intent |
| sales automation software | 1,300 | $19.22 | 0.03 (very low) | Easy-win adjacent term |
| automated lead routing | 110 | $0 | 0.01 (near zero) | Very on-brand for Clay, easy win |
| no-code workflow automation | 110 | $20.83 | 0.07 | |
| ai agent workflows | 260 | $10.42 | 0.54 | Trend-relevant, more competitive |
| sales workflow automation | 140 | $29.80 | 0.11 | Direct phrase match to page topic |
| crm workflow / crm workflows | 320 each | $14.82 | 0.56 | Good for an integrations section |

The `#41 for "workflow automation" (74K/mo)` line is the finding — an existing stranded ranking on a huge term, which reframes the page from "new launch" to "consolidation opportunity". It came from Phase 3, the step that's easiest to skip.
