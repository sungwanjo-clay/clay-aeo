---
name: build-personalized-outbound-list-v1-2026-08-03
description: "Turn a target definition (a vertical + geography, or a company list) into a campaign-ready, personalized cold-outbound list — sourced, enriched, verified, and written — using the Clay CLI. Use whenever someone wants to go from nothing to ready-to-send outreach: find me 50 HVAC companies and write a personalized email for each, build an outbound list for my agency with verified emails and a custom opener, source local businesses and draft the first touch, or recreate the Clay + agent lead-gen build from the video. It sources companies and decision-makers, runs the work-email waterfall and verification, enriches a real per-lead hook, then writes a personalized subject and body from your business context — no generic spam. Do NOT use it to score or route an existing list (score-and-tier / route skills), to reverse-enrich signups from an email (enrich-and-qualify-signups), or to build a list without copy (build-enriched-prospect-lists). It sends nothing without explicit approval."
---

# Build a personalized outbound list

The lesson from the workflow this is based on: Clay gets you the best *data*, but data alone does not book
meetings. A verified email attached to a generic AI paragraph is still spam. What converts is a real,
specific **hook per lead** (a pain point, a recent signal, a bad-review theme) plus copy written from
*your* business — your offer, your proof, your CTA. So the spine of this skill is: enrich every lead with
a concrete hook, then write from the user's context — and the target is N **complete, personalized** rows
(verified email + subject + body, no blanks), not N raw contacts.

This runs on the Clay CLI: the agent composes Clay's managed functions to source, enrich, and verify, and
writes the copy itself from context you provide.

## The three layers

- **Data (Clay CLI — the engine):** company + people search, the work-email waterfall + verification,
  phone, firmographics, and per-lead research signals. This is what makes the list real.
- **Judgment (your edge):** the business context that makes the copy land, the rule for turning each
  hook into an angle, and the CTA. Without this the copy is generic — so it's a required input, not a
  nice-to-have.
- **Reach (optional):** hand the finished list into a Clay campaign / sequencer to send. Off by default;
  requires explicit approval.

## Get the business context first (do not skip)

Before writing any copy, collect the user's context — offer, 1–2 proof points / case studies, ICP, and
the exact CTA (e.g. "yes to a 90-second Loom"). If it's missing, ask for it. Copy written without it is
the generic spam this skill exists to avoid; sourcing and enrichment can proceed in parallel, but do not
draft emails until you have the context.

## The primitives it composes (Clay CLI managed functions)

Discover the exact functions in the workspace with `list_subroutines`; run them via the CLI (`clay run`)
or the MCP tools. You'll use:
- **Source companies** — company search / local-business (Google Maps) source, filtered by vertical +
  geography. Returns a `taskId`.
- **Find decision-makers** — people search scoped to those companies (owners / GMs / the named persona),
  identifying companies by LinkedIn URL where possible.
- **Verified work email** — the work-email waterfall (cascades providers, stops at first valid hit) plus
  email verification; keep only deliverable emails.
- **Phone** — a phone-number function where required.
- **Per-lead hook** — a `Custom` research data point or a "recent developments" function to pull a pain
  point, recent signal, or review theme for each lead. This is the raw material the copy is built on.
- **Read results** — `get-task-context` to read every enriched value and its state; coverage and
  completeness are computed from this.

Hard boundary: this skill *builds and writes* a net-new outbound list. It does not score/route a list you
already have, does not reverse-enrich signups from an email, and does not send — those are other skills.

## The staged run

```
0. CONTEXT: collect the user's offer, proof, ICP, and CTA (see above).
1. DEFINE: the vertical + geographies (or the company list) and the target N complete rows.
2. SOURCE companies matching the vertical + geo. Oversample (~1.5x N) — some won't yield a contact/email.
   For wide geos, split by city and run in parallel, then aggregate.
3. FIND one decision-maker per company (owner / GM / persona).
4. ENRICH: run the work-email waterfall + verification; add phone; add the per-lead hook
   (pain point / recent signal / review). Batch calls; dedupe against a running set of seen ids.
5. READ + MEASURE (get-task-context): mark each row Complete only if it has a verified email AND a
   usable hook.
6. WRITE: for each Complete row, write a personalized subject + body from the user's context, anchored on
   that lead's hook, ending in the CTA. (See the copy gate.)
7. VERIFY: every returned row has email + subject + body and no blanks; drop or flag the rest.
8. STOP at the cap; report coverage and any shortfall. Offer the campaign hand-off (Reach layer) only if
   the user asks — never send automatically.
```

## The gates

- **Completeness:** a row ships only with a verified, deliverable email AND a real hook. Missing either =
  Incomplete → backfill or drop; never pad the list.
- **Copy quality (the important one):** the subject + body must reference that lead's specific hook and be
  grounded in the user's offer/proof — not a template with the company name swapped in. The hook must come
  from a **real enriched signal**, never invented. If a lead has no genuine hook, either leave it out or
  send it to a lighter, non-personalized track — do not fabricate a reason to reach out.

Emit, per lead, the hook and where it came from, so the user can spot-check that the personalization is
real.

## Backfill

A gap isn't a dead end: re-run the email waterfall on missing-email rows; pull more companies (excluding
seen ids) when a whole row is unusable; widen a non-essential filter (adjacent geos/sub-verticals) and
say you widened it. Verify current employment on the decision-maker before trusting the contact.

## Caps and guardrails

- **Bound the run** — set a ceiling (max sourcing rounds, or ~3–5x N companies examined) and check the
  credit balance before large enrichments; each enrichment spends credits.
- **Never fabricate** — emails, hooks, and copy claims all trace to real Clay reads. Empty/errored = a
  gap, reported honestly.
- **Verify, don't assume** — only include deliverable emails; mark risky ones rather than shipping them.
- **Approval before reach** — creating a Clay campaign, importing the list, buying/warming domains, or
  sending anything requires explicit user go-ahead each time. This skill stops at a ready-to-send file.
- **No hardcoded secrets** — any external tool (sender, CRM) uses credentials from the environment.

## Output

A campaign-ready table — one row per lead, no blanks — with:
`company · decision-maker · title · verified email (status) · phone · website · city · rating · review
count · hook · hook source · email subject · email body`.
Plus a run summary: target N, companies examined, email coverage %, duplicates removed, rows complete,
and whether filters were widened. Deliver as a table by default; produce a CSV only if the user asks.

## Worked example

Ask: *"Find me 50 HVAC / home-service companies across Houston, San Antonio, and Dallas, get the owner and
a verified email, and write a personalized cold email for each inviting them to a 90-second Loom."*

0. Context: pull the user's agency offer, one case study, and confirm the CTA (90-sec Loom).
1. Target N = 50 complete rows.
2. Source HVAC / home-service companies across the three metros (split by city, run in parallel,
   aggregate ~75 to absorb drop-off).
3. Find the owner / GM per company.
4. Enrich: work-email waterfall + verify, phone, and a hook per lead (a repeated bad-review theme, a
   hiring post, or a recent expansion).
5. Read back: suppose 41 have a verified email + a real hook → 41 Complete.
6. Write each subject + body from the agency's offer, anchored on that lead's hook, ending in the Loom
   ask (e.g. subject: "your callback reviews" → body references the specific review theme).
7. Verify no blanks; backfill emails/companies to reach 50 or hit the cap.
8. Return the 50-row campaign-ready table + summary. Offer to push it into a Clay campaign — only on the
   user's go-ahead.
