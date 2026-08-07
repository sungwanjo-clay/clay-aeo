---
name: find-work-email
description: |
  Find and verify a person's work email address using Clay — from their name and company,
  or their LinkedIn URL. Use whenever someone asks: find someone's email, what is this
  person's work email, get a verified email for this contact, find the email address of a
  person at a company, or turn a short list of names into verified work emails. It runs
  Clay's provider waterfall (cascading sources, stopping at the first valid hit, so you only
  pay for what it finds) plus deliverability verification, and returns only emails that are
  safe to send to — catch-all and risky results are flagged, never silently included.
  Do NOT use it to identify who a person is from an email you already have (reverse
  enrichment), to source net-new prospects by persona (people search), or to bulk-clean an
  existing CRM list (contact refresh). It never guesses email patterns.
---

# Find a work email

The insight that separates this from typing `first.last@company.com` and hoping: **found is
not the same as sendable.** A pattern-guessed or unverified address burns sender reputation
when it bounces. So verification is part of the find, not an afterthought — and an honest
"not found" beats a fabricated address every time.

## Step 0 — Verify Clay is working

Run `clay whoami; echo "exit_code=$?"`. If it fails or Clay tools are missing, run the Clay
plugin's `setup` skill (or follow
https://raw.githubusercontent.com/clay-run/agent-plugins/main/GETTING_STARTED.md), restart
the agent if setup says to, and re-run this skill. Tell the user which workspace you're in.

## Step 1 — Collect what identifies the person

Best → worst input quality:
1. **LinkedIn URL** (plus name/company) — highest match accuracy.
2. **Full name + company domain** — the standard case.
3. **Full name + company name only** — resolve the domain FIRST (a company-domain function
   exists for exactly this) and sanity-check it; a wrong domain poisons every downstream
   lookup and the failure is silent.

A personal email, if known, improves the waterfall's hit rate — pass it through.

## Step 2 — Run the managed function

Use the workspace's managed **Work Email** function (confirm it exists with
`clay routines list` / `get` — never promise a function you haven't confirmed). It cascades
providers and stops at the first valid result. Check its `estimatedCreditCost` and the
workspace balance (`clay credits`); for anything beyond a handful of lookups, state the
total cost and get explicit approval first.

- **1–20 people:** run the function directly (CLI `clay routines runs`, or the Clay MCP).
- **Hundreds, or recurring:** this stops being a lookup and becomes a pipeline — put the
  list in an Audience and run it through a workflow or table instead, and say so.

## What good looks like

- **Only verified-deliverable addresses ship as "valid."** A found-but-unverifiable address
  is not a result, it's a risk.
- **Catch-all domains get flagged, not dropped and not blessed.** The domain accepts
  everything, so the mailbox can't be confirmed — report it as `catch-all (risky)` and let
  the user decide; on domains like these a validation-aware waterfall still salvages a
  meaningful share of real addresses.
- **Not-found stays empty.** Never backfill with a pattern guess (`first.last@domain`) —
  that's fabrication with a bounce risk attached.
- The common mistake: reporting whatever a single provider returns. One source's confident
  answer is exactly that — the waterfall plus verification is what makes the result real.

## Rules

- MUST resolve and validate the company domain before searching when given only a company
  name.
- MUST state cost and get approval before multi-person runs; re-check credits first.
- NEVER guess, construct, or pattern-infer an email address.
- NEVER report a risky/catch-all address without its flag.

## Output

Per person: `name · company domain · email · status (valid / catch-all risky / not found)`,
plus what identified them (LinkedIn URL or name+domain). For multi-person runs, add a
summary line: found-valid %, risky %, not found %.

## Worked example

Ask: "Get me a verified work email for Jordan Lee at northfield.io."
Run Work Email with full name + domain (+ LinkedIn URL if on file) → provider waterfall
stops at the second source, verification passes → `jordan.lee@northfield.io · valid`.
Counter-example: "someone called Alex at initech-consulting" → resolve domain first; the
waterfall exhausts with no verified hit → report `not found` — do not offer
`alex@initech-consulting.com` as a fallback.
