---
name: account-priority-buckets
description: |
  Decide which accounts to work this week with Clay. Takes an account list plus your ICP band and
  grades every account on FIT, PAIN, MOMENT and CONFIDENCE, then sorts it into five buckets: Action
  Priority high, Action Priority standard, Research Priority, Monitor, Deprioritize. Each account worth
  working gets an Account Context: verified pain in the buyer's own words with its source, recent
  changes, a confidence tag on every piece of evidence, a hypothesis, why we might be wrong, and a
  Signal, Pain, Consequence, Value, Proof, Action message draft for a human to review. Use whenever
  someone asks: which accounts should we work this week, prioritize my target accounts, sort my
  account list into action and research buckets, why now for these accounts, score FIT and MOMENT,
  build account context before outreach, or who is ready for personal outbound. PAIN counts only
  with a quotable buyer statement; everything else is a MOMENT signal or a firmographic guess. Do NOT
  use it to build a list from scratch, to fill missing firmographics on a list, to score inbound
  leads or individual people, to send or sequence outreach, or to write scores back into a CRM.
category: score-and-qualify
personas: [revops, sales-leader]
mechanism: functions
touches: writes-own-output
keywords: [lead-scoring]
---

# Account priority buckets (no quote, no PAIN)

The insight: **PAIN signals require a verified buyer quote. If you can't quote them, you don't have a
PAIN signal. You have a MOMENT signal or a firmographic guess.** Most account scoring blends
firmographics, activity and inferred intent into one number, and reps then personalize outreach
around pain nobody said out loud. Buyers answer with "how did you get that idea?" This skill keeps the
four questions apart: FIT decides whether to pursue, MOMENT and CONFIDENCE decide how urgently, and
PAIN decides readiness. Priority = FIT × MOMENT × CONFIDENCE. PAIN determines readiness state.

What follows from it: an account with a new executive, fresh funding and a strong fit but no quote
goes to **Research Priority**, never to Action. The job there is to find the pain before anyone
sends. And every Account Context carries a written reason the account might not buy, because a
hypothesis without one is a sales pitch.

AI proposes. Evidence supports. Humans govern. Outcomes teach. This skill proposes and shows its
evidence. A human decides whether to act on any of it.

## Declared inputs

**Nothing here ships with a value except where a default is named.** Each input is the installer's.
Ask for it, never substitute a plausible default, and where an answer does not exist say which step
becomes unavailable rather than guessing. Where a default is used, say so in the output.

| Input | What the installer supplies | If it is missing |
|---|---|---|
| **Account list** | CSV, table or pasted list; minimum one company domain per row | no default; there is nothing to grade |
| **ICP band** | employee band (floor and ceiling), revenue band, top industries, regions, replacement targets (tools you displace) | FIT cannot be scored; stop and ask. If they have no evidence-based ICP yet, say that building one comes first and do not grade |
| **Firmographic gate** | which ICP dimensions must be true for an account to count at all (for example employee band and region) | treat no dimension as a gate and say so in the output |
| **FIT weights** | relative weight of each ICP dimension | propose equal weights, get approval, and label them as unapproved defaults if the installer declines to set them |
| **High FIT cutoff** | the Fit Score (0 to 10) at or above which an account counts as High FIT | no default; ask. Without it no account can leave Deprioritize |
| **Personas** | the champion and economic-buyer titles per motion (for example VP Analytics, CTO) | the new-executive signal cannot run; its weight stays in the output as unobserved |
| **MOMENT window** | how many days back a change still counts as "recent" | no default; ask. Undated events never count, whatever the window |
| **MOMENT weights** | points per signal type | default is the GTM AI OS signal library: public pain quote 10, competitor dissatisfaction 8, new executive 6, job posting 5, tech installed 4, funding 3, engagement 3. Say the default is in use |
| **First-party evidence** | anything the installer already holds per account: call quotes, CRM notes, review excerpts, web visits, content downloads, webinar attendance | PAIN can only come from public statements found in Step 5; engagement scores as unobserved |
| **Where the evidence lives** | which system holds call notes and engagement (CRM, call recorder, marketing automation, a spreadsheet) and how to export it | ask; never assume a CRM |
| **Credit ceiling** | maximum Clay credits this run may spend | ask before Step 4; stop at the ceiling |

**If an answer sheet is present beside this skill, load it and ask only for what it does not cover.**
A partial sheet is normal; a value it is missing gets asked for on its own rather than restarting the
interview. **Say which values came from the sheet** before using them. A sheet applied silently is a
wrong field nobody catches. **If there is no sheet, say nothing about sheets.** Run the interview as
though the feature did not exist. At delivery, offer to save the answers to a file beside the skill:
it is not part of the skill, it holds their ICP band, cutoffs, windows and weights, it means they never
answer these questions again, and a teammate given the file is asked only what it does not cover. It
stays with them, is never submitted or published, and holds no passwords or API keys.

## What this skill touches

- **Reads**: the account list and first-party evidence you supply, plus Clay enrichment per account: firmographics, tech stack, funding and news, executive hires, job postings, and any public page URL you name.
- **Writes**: its own output only. A priority board and Account Context drafts, handed back to you in this session.
- **Never**: writes to a CRM, enrolls anyone in a sequence, sends a message, or treats an Inferred or Unknown signal as PAIN.
- **Halts**: Step 4 sample-review, Step 4 spend-approval.

## Step 0: Check the platform, and say where the work runs

Say this to the installer before anything else: *"This reads your account list and Clay enrichment.
It writes a priority board and Account Context drafts here in the session. It never touches your CRM
and never sends anything."*

Run `clay whoami; echo "exit=$?"` and `clay --version`. If either fails, name the component, the
version required, and the one command that fixes it (`clay login`, or the Clay plugin's `setup`
skill), then stop. Do not install, upgrade or fetch anything to repair the platform. Name the
workspace `clay whoami` reports.

Where the work runs decides what it costs: the scoring, bucketing, hypotheses and message drafts run
**in this agent, at zero Clay credits**. Only Step 5's enrichment calls spend credits.

Do not start a step before the steps above it have their answers. If a declared input is missing, ask
for it. Never assume a default and continue.

## Step 1: Collect the definition (interview; do not guess)

1. **The account list.** Normalize domains (lowercase, strip protocol, `www.` and paths) and dedupe.
   Report how many rows collapsed.
2. **The ICP band, firmographic gate and FIT weights.** Take their words. If they cannot state an
   employee band with a floor and a ceiling, stop: the ICP comes before the list, and grading against
   a guessed ICP produces confident noise.
3. **The High FIT cutoff, the MOMENT window and the personas.** Ask each on its own. No defaults.
4. **The MOMENT weights.** Show the default library above and ask whether they have weights from
   their own win/loss data. Theirs replace the default outright.
5. **First-party evidence.** Ask where it lives and have them export it: verbatim call quotes with
   speaker and date, review excerpts they have collected, and engagement events with dates. Tag each
   item's confidence at intake (Step 2's table).
6. **Credit ceiling.**

## Step 2: The decision model (stated to the installer before scoring)

**FIT** answers "should we pursue them?" Score each ICP dimension 0 or 1 (a band match is 1 inside the
band, 0 outside), weight it, and renormalize over observed dimensions:

```
Fit Score = 10 × Σ(wᵢ × sᵢ) / Σ(observed wᵢ)
```

- An observed `0` or `false` is evidence of failure and stays in both sums. Never test presence by
  truthiness.
- A gate dimension that is observed and fails puts the account in Deprioritize whatever else is true.
- A gate dimension that is unobserved means **FIT cannot be scored**: the account goes to its own
  "cannot score" list with the missing fields named. It is never ranked with an asterisk.
- Round to one decimal, half-up, before comparing against the High FIT cutoff.

**PAIN** answers "do they have a problem you solve?" It is **Verified** only when there is a verbatim
statement from a named person at the account, with a source and a date: a call quote, a review, a
post, a public statement. A paraphrase, a model's summary, or an article about the account is not
PAIN.

**MOMENT** answers "why now?" Sum the weights of the signals that fired inside the window. Each signal
type counts once per account however many times it fired; the evidence line lists every instance.

**CONFIDENCE** answers "how sure are we?" Every signal carries one tag:

| Level | Meaning |
|---|---|
| Verified | direct source, primary record: a recorded call quote, a review, a tech-stack detection |
| Supported | reliable secondary source: a news report, analytics, a provider's structured record |
| Inferred | pattern-matched or AI-generated: a title guess, a stack guess, a model's reading of a page |
| Unknown | no confidence claim possible |

**Every signal counts toward MOMENT at full weight, whatever its tag.** CONFIDENCE controls what a
human may act on, not the score: Inferred and Unknown signals never go into personalized outreach or a
message draft without human verification, and the board shows how many of each account's MOMENT points
rest on Inferred or Unknown evidence, so a reader can see when a bucket depends on unverified signals.

**Buckets.** Evaluate in this order; the first match wins.

| Bucket | Definition | SLA |
|---|---|---|
| Deprioritize | Fit Score below the High FIT cutoff, or a failed gate | remove from the working list |
| Action Priority, high | High FIT + Verified PAIN + MOMENT 15 or more | same business day outreach |
| Action Priority, standard | High FIT + Verified PAIN + MOMENT 10 to 14 | within 48 hours |
| Research Priority | High FIT + MOMENT 10 or more + no Verified PAIN | investigate to find PAIN, then reclassify |
| Monitor | High FIT + MOMENT below 10, with or without Verified PAIN | nurture, watch for MOMENT; the board shows which Monitor accounts already have Verified PAIN |

Within a bucket, sort by Fit Score × MOMENT, highest first, ties broken by the most recent
signal date.

## Step 3: Free checks before anything paid

1. **Pre-grade on what the list already carries.** If the installer's list includes employee count,
   industry or region, score FIT from those first. Accounts that fail a gate on supplied data go to
   Deprioritize now and cost nothing.
2. **Load first-party evidence.** Attach quotes and engagement to their accounts by domain. A quote
   that cannot be matched to a domain is reported, not guessed.
3. **Liveness.** A dead or acquired company enriches perfectly well on last-known data. If the free
   status probe (`http-api-v2` with a `User-Agent`) fails on a domain, flag the account "liveness
   doubt" and exclude it from paid calls.

Report what the free pass eliminated before any credit is spent.

## Step 4: Small batch, then ONE gate: the batch, the cost, the ask

Every call in this skill reads; nothing it does can mutate the installer's systems, so a real batch is
safe.

1. Confirm each function Step 5 names against the live catalogue: `clay routines list --limit 100`,
   `clay routines get <id>` for `estimatedCreditCost` (the list call omits it), and
   `clay workflows actions schema <packageId> <actionKey>` for real inputs and any per-unit billing in
   the parameter descriptions. Record the `(packageId, actionKey)` pair you resolved. **If a named
   function is absent, say so and leave that signal unobserved. Never substitute the nearest thing.**
2. Run Step 5 on **10 accounts** that survived Step 3. Read the reported cost off each response
   (`metadata.upfrontCreditUsage.totalCost`), never the balance delta.
3. Send **one message** with: the 10 rows as they would appear on the board, anything that looks
   wrong (a wrong-entity match, an empty arm), the actual credits spent, the projected total for the
   remaining accounts in the unit the installer thinks in, whether it fits the credit ceiling, and the
   ask. Any step priced per result found is stated as "charges for each one it finds, so I cannot give
   a total before it runs", with the per-result price and a cap. Then stop and wait.

## Step 5: Enrich, one signal at a time

For every call: gate on payload values, never on run status. A `complete` run with an empty or absent
field is a miss, and a miss can still bill. Enforce the MOMENT window on every dated fact; an undated
event does not count.

| Signal | What runs | What goes in | What to verify | Confidence |
|---|---|---|---|---|
| FIT firmographics | managed **Enrich Company** function | domain | exact headcount where present, else the band string compared as a band; industry; HQ region; read `website`, not `domain`, for identity | Supported |
| Tech installed | managed **Website Technology Stack** function | domain | one of the installer's replacement targets appears in the returned string; drop metadata pseudo-entries; flag an exactly 8,192-character result as truncated | Verified, noted "may be historical" |
| New executive | people-index new-hire lookup, filtered to the installer's persona seniority and titles | domain, persona titles | a start date inside the window, title matches a persona | Supported |
| Job posting | a job-postings action that filters by seniority or department at the source and returns a true total (`jobCount`) | domain, persona function, window | at least one posting inside the window matching the persona function; record it as yes/no with the posting as evidence, never as a count | Supported |
| Funding | funding waterfall normalized through the typed `company/fundingRound` output | domain | a dated round inside the window where the account raised the money; an investment the account made in another company is not its funding | Supported |
| Public pain or competitor dissatisfaction | **no Clay function discovers these.** Two sources only: the installer's first-party evidence, and a public URL the installer names, fetched with `scrape-website` (`outputFields: bodyText`) after a free `http-api-v2` status probe | the URL | a verbatim quote from a named person at the account, with a date; a 404 or soft-404 is a miss | Verified if the page is the speaker's own post or review, otherwise Supported |
| Engagement | installer's first-party data only; Clay has no identified-visitor function | the export from Step 1 | a dated event inside the window | Verified |

News results are topical, not evidence. Before any news item counts, check that it names the account
as the subject (not a same-name company, a former executive's new venture, or a supplier), that the
event date sits inside the window (a crawl date is not an event date), and dedupe one event reported
by several outlets.

If a signal's function is unavailable, keep its weight visible as unobserved in the output. Dropping it
quietly makes every MOMENT score look complete.

After the run, report credits actually spent against the estimate. If they differ, say by how much and
why.

## Step 6: Grade and bucket

Apply Step 2 exactly. Each account ends in exactly one of: the five buckets, cannot score,
or liveness doubt.

Check before delivering: **any account whose evidence line names a mismatch with the ICP or gate is
rescored or moved, never left in Action with a caveat.** A reader acts on the order of the board. If
the top account needs an explanation for why it does not fit, that is a scoring bug.

## Step 7: Write the Account Context and deliver

For every Action Priority and Research Priority account, write an Account Context with these fields:
company and Fit Score with component scores; Verified PAIN in the buyer's words with speaker, source
and date (or "none found" for Research); MOMENT changes and intent with dates and points; the
confidence tag on every item; **the hypothesis** (why this account should care, which motion, which
persona is champion and which is economic buyer); **why we might be wrong** (at least two concrete
reasons: incumbent contract, no exec sponsor, recent budget cut, prior failed implementation, a signal
that may be diligence rather than intent); the **next action** with its SLA.

For Action Priority accounts only, add a message draft in the architecture **Signal → Pain →
Consequence → Value → Proof → Action**, built only from Verified and Supported evidence. The Value and
Proof lines use the installer's own claims and case studies; if they supplied none, leave those lines
as marked gaps rather than inventing a stat or a customer. One ask per message. Label every draft
"for human review; not sent".

Deliver: the priority board, the Account Context files, the cannot-score list, the
liveness-doubt list, the weights, windows and cutoffs used, and actual credits spent.

## Representative output

### Priority board

| Bucket | Account | Fit | MOMENT (Inferred/Unknown share) | PAIN | Top evidence | Next action |
|---|---|---|---|---|---|---|
| Action, high | northwind.example | 8.7 | 19 (3 of 19) | Verified | VP Analytics, 12 days ago: "spending 30% of our data team's time on reconciliations" | outreach today |
| Research | contoso.example | 8.1 | 11 (0 of 11) | none found | new Head of Data 38 days ago; Director of Data Engineering posting 9 days ago | find the pain, then reclassify |
| Deprioritize | fabrikam.example | 3.2 | n/a | n/a | 140 employees, below the 500 floor (gate) | remove from list |

### Account Context

**Northwind Fintech (northwind.example)**. Fit Score 8.7/10 on weights band 35, industry 30, region 22,
replacement target 13: employee band 1 (1,200, exact count), industry 1 (fintech), region 1 (Canada),
replacement target 0 (none detected). **PAIN, Verified:**
VP Analytics, LinkedIn post, 12 days ago: "We're spending 30% of our data team's time on spreadsheet
reconciliations. That is not why I hired them." **MOMENT 19 (3 points Inferred):** public pain quote 10 (Verified); new
Head of Data 44 days ago, joined from a data-warehouse vendor, 6 (Supported); Series C 97 days ago, 3,
not counted, outside the 90-day window. Two pricing-page visits from the CTO, 3, Inferred from an IP
match: counted, kept out of the draft until a human verifies it. **Hypothesis:** the new Head of Data brings modern infrastructure
experience and the VP Analytics has named the pain in public; Analytics Modernization motion, VP
Analytics as champion, CTO as economic buyer. **Why we might be wrong:** a new data leader may already
have a preferred vendor from their last company; post-funding scaling often freezes new evaluations;
the pricing visits are unverified and may be diligence. **Next action:** personal outreach to the VP
Analytics today, multi-thread to the CTO and Head of Data within 14 days. **Draft (for human review;
not sent):** Signal: your post about the team spending 30% of its time on reconciliations. Pain: that is
the loss data teams describe before they switch. Consequence: board dashboards go stale and trust in
the numbers erodes. Value: [installer's claim, not supplied]. Proof: [installer's case study, not
supplied]. Action: worth 20 minutes next week to compare notes?

## What this skill does not claim

- Its logic comes from the author's written GTM AI OS framework and this interview. It has never run end to end, so nothing here has been checked against accounts that were worked and won.
- The default MOMENT weights are the author's signal library; they have not been fit to any installer's close rates, and the framework itself says weights should come from your own win/loss data.
- The function names in Step 5 were taken from observations dated August 2026 and were not confirmed against a live catalogue while writing this; Step 4 confirms them at runtime and the live catalogue wins.
- Clay has no function that discovers public pain statements, reviews or identified website visitors, so PAIN and engagement are only as complete as the evidence and URLs the installer supplies.
- A tech-stack detection can be historical, so "tech installed" may count a tool the account has already replaced.
- Inferred and Unknown signals count toward MOMENT at full weight by the author's choice, so an account can move up a bucket on unverified intent; the board shows that share, and nothing here tests whether it predicts outcomes.
- Credit cost per account is unmeasured; Step 4 measures it on 10 accounts before anything larger runs.

## What good looks like

- Every account in Action Priority has a quote a rep could read aloud to the buyer without embarrassment.
- Research Priority is not empty. A board with zero Research accounts usually means inferred signals were counted as PAIN.
- Anyone can answer "why is this account Action, high?" from the row: Fit components, MOMENT signals with dates and confidence tags, the quote and its source.
- Every Account Context has a "why we might be wrong" line that a skeptical manager would recognize as real.
- The common mistake: one AI pass that reads an account's news and returns a priority and a paragraph. It cannot be audited, it counts topical text as evidence, and it puts guessed pain into outreach.

## Rules

- MUST keep PAIN to verbatim statements from a named person at the account, with source and date; NEVER promote a paraphrase, a summary or an inference to PAIN.
- MUST tag every signal with a confidence level and count every signal toward MOMENT at full weight; Inferred and Unknown signals NEVER appear in a message draft or personalized outreach until a human verifies them.
- MUST enforce the MOMENT window on every dated fact; an undated event never counts.
- MUST keep the arithmetic deterministic in the agent; judgment writes hypotheses, risks and drafts, never the scores.
- MUST confirm each named function against the live catalogue and leave a signal unobserved rather than substitute a different one.
- MUST run the 10-account batch and wait at the single gate before spending past it.
- NEVER write to a CRM, enroll a contact, or send a message. The board and the drafts are the deliverable; a human decides.

## Worked example

Ask: "Which of our 400 prioritized accounts should the team work this week?" Interview: employee band
500 to 2,500 (gate), regions US, Canada, UK (gate), industries SaaS, fintech, healthtech, replacement
targets a legacy data platform and spreadsheet processes; High FIT cutoff 7.5; MOMENT window 90 days;
personas VP Analytics and Head of Data (champion), CTO (economic buyer); default MOMENT weights; call
quotes exported from their call recorder for 31 accounts; credit ceiling set by the installer.

Free pass: 400 rows, 6 duplicate domains collapsed to 394; 22 fail a gate on supplied headcount and go
straight to Deprioritize; 3 fail the status probe and go to liveness doubt. 369 go to the batch. The
10-account batch shows one wrong-entity funding match (a same-prefix real-estate firm), which the
entity check caught; the gate message carries the actual credits for 10 and the projection for 359.
Approved.

Result: 11 Action high, 19 Action standard, 64 Research, 81 Monitor (23 with Verified PAIN), 188 Deprioritize,
6 cannot score (region unobserved). The 30 Action accounts each get an Account Context and a draft;
the 64 Research accounts get an Account Context with "PAIN: none found" and the MOMENT evidence a rep
should start from.
