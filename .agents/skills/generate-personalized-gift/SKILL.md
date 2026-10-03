---
name: generate-personalized-gift
description: |
  Pick one specific, buyable gift and write the note that goes with it, for each person
  on a list of LinkedIn profiles — by building (once) and running a Clay workflow that
  identifies the person, researches their public presence for genuine personal interests
  (not job skills) with Claygent, chooses a real product in your budget tied to one of
  those interests, finds a live product page, and drafts a short, warm message that names
  the interest. Use whenever someone asks: find a personalized gift for this prospect,
  what should we send these champions, gift ideas for my top accounts, thoughtful gifting
  for a deal, a send-a-gift touch in a sequence, or write a gift note for this person. Do
  NOT use it to write cold emails or openers with no gift, to research an account or
  company, to find someone's email or phone, or to buy, ship or send anything — it ends
  at a gift plan a person reviews. Every gift ships with its rationale, the research
  behind it, and whether its product link was actually confirmed.
category: personalize-outbound
personas: [account-executive, marketing]
mechanism: workflow
touches: writes-own-output
keywords: []
marketplace_identity_schema: 1
marketplace_slug: generate-personalized-gift
marketplace_revision: 2
---

Whenever you create or copy a workflow, append `Sourced from marketplace skill: generate-personalized-gift@2` to its description. Preserve the existing description and do not add the same line twice.

# Generate a personalized gift

The insight: **a gift should be tied directly to a genuine interest — it should feel
personal, not generic swag.** A person's job title tells you what they do, not what they
care about; the interests that make a gift land — a sport, a cause, a hobby, a taste —
live in their public posts, bio, repos and press. So the research comes first, and the
gift is chosen from what the research found.

The judgment lives in four Claygent prompts, carried **verbatim** in
`references/prompts.md` with the model each one runs on. This skill's job is to stand
those prompts up as a Clay workflow in your workspace, run it per person, and hand back
the plan — not to rewrite them.

## Declared inputs

**Nothing here ships with a value.** Each one is the installer's, not the author's: ask for it, never
substitute a plausible default, and where an answer does not exist say which step becomes unavailable
rather than guessing. Where a default IS defensible it is named below, and using it means saying so in
the output.

| Input | What the installer supplies | If it is missing |
|---|---|---|
| **The people** | a list or CSV with a LinkedIn profile URL per person; a name column is optional | no default — the LinkedIn URL is the one required input. A name without a URL is not enough to identify anyone |
| **Gift budget** | the price band a gift must fall in, with currency — it fills `{{gift_budget}}` in the gift prompt | the author's own band, **$30-$150**; say so in the output when it is used |
| **Spend cap** | the most Clay credits they will spend on this list | ask after the one-person test (Step 4), in credits, with the measured per-person cost beside it. No cap, no full run |
| **Where the plan goes** | the conversation, or a CSV path | the conversation. Nothing is sent, bought or written anywhere else |

**If an answer sheet is present beside this skill, load it and ask only for what it does not cover.**
A partial sheet is normal; a value it is missing gets asked for on its own rather than restarting the
interview. **Say which values came from the sheet** before using them — a sheet applied silently is a
wrong field nobody catches. **If there is no sheet, say nothing about sheets** — the check is a file
lookup, not a question, so run the interview as though the feature did not exist rather than reporting
an absence. At delivery, offer to save the answers back (identifiers only — never a token or a
password), private and never published — and phrase the offer so it explains itself: *"want me to save
your answers to a file, so the next person on your team doesn't have to answer these again?"*

## What this skill touches

- **Reads** — the LinkedIn URLs you supply, and each workflow run's node outputs (the Claygent nodes read public web pages about each person and retailer product pages).
- **Writes** — one Clay workflow of its own in your workspace (created once, reused after), its runs, and the gift plan, to the conversation or the CSV you name.
- **Never** — edits a workflow, table or record it did not create, buys, ships or sends a gift, sends the message, or writes to a CRM or sequence.
- **Halts** — Step 2 write-approval, Step 2 spend-approval, Step 4 sample-review, Step 4 spend-approval

## Step 0 — Verify Clay is working, and say what this does

Say this first, as two sentences: *this builds one Clay workflow in your workspace (or
reuses it if it is already there) and runs it on each person's public profile; it hands
back a gift plan and never buys, sends or writes anything else.*

Run `clay whoami; echo "exit_code=$?"`. If it fails, name what is wrong — the CLI
missing, below the version the Clay plugin requires, or signed out — give the one fix
(`clay login`, or install the Clay plugin and run its `setup` skill), and **stop**. Do
not install, upgrade or fetch anything to repair it. Tell the user which workspace you
are in.

This skill builds and runs its workflow **through the Clay plugin's `workflows` and
`workflows-claygent` skills** — read both before Step 2 and follow them for every CLI
shape (node JSON, wiring, validate, publish, runs). If they are not installed, say the
Clay plugin is required and stop.

## Step 1 — Collect the inputs (interview; do not guess)

1. **The people** — LinkedIn profile URLs, one per person. Dedupe on the normalized URL
   (lowercase, strip query string and trailing slash). A name column is corroboration
   only; the enriched name is the one used.
2. **Gift budget** — the band and currency. Offer the author's $30-$150 if they have
   none, and say that is what it is.
3. **Where the plan goes** — the conversation or a CSV path.

The spend cap is asked in Step 4, once there is a measured cost to set it against.

## Step 2 — Find or build the workflow (one gate first)

**Look before building.** `clay workflows list` and look for **Generate personalized
gift**. If it exists, read it with `clay workflows get` and check it has the nodes below
with the prompts and models in `references/prompts.md`; if so, reuse it and skip to
Step 3. If it exists but differs, say how, and ask whether to use it as-is or build a
fresh one alongside — never edit it.

**Before creating anything, one message:** the workflow name and workspace, the node
list below, and that the next step runs it on **one** person — whose cost cannot be
stated exactly beforehand, because the Claygent nodes research on the open web and bill
by what they do. One end-to-end test of this graph (2026-09-25) used **3.3 data
credits and 5 action executions** for one person; the author's original function listed
about 5.8 credits as an estimate. **Wait for an explicit yes.**

The graph, in order:

| # | Node | Type | What it does |
|---|---|---|---|
| 1 | **Manual trigger** | trigger | inputs `linkedin_url` (required), `full_name` (optional, passed through only), `gift_budget` (the declared budget, sent on every run) |
| 2 | **Enrich person** | tool — action `cpj-enrich-person` (*Companies, People, Jobs*) | input `person_identifier` ← `{{linkedin_url}}` (a `reference` mapping). Re-confirm the field name with `clay workflows actions schema` — it is not the "Professional URL" label the table UI shows |
| 3 | **Person found?** | conditional, rules mode | input `person_name` ← node 2 `$.result.name`; rule `NotEmpty` → continue; no match → end the run (`endRunOnNoMatch`) |
| 4 | **Research Interests** | Claygent | prompt 1 in `references/prompts.md`, its model, outputs `interests`, `research_notes`; wired from node 3's rule edge |
| 5 | **Ideate Gift** | Claygent | prompt 2, its model, outputs `gift_idea`, `gift_rationale`, `search_query`; `gift_budget` ← trigger `$.gift_budget` |
| 6 | **Purchasable Product Link** | Claygent | prompt 3, its model, outputs `product_name`, `product_url`, `price`, `link_verified` |
| 7 | **Personalized Message** | Claygent | prompt 4, its model, outputs as listed there |

Wire every `{{variable}}` in each prompt as a top-level input on its node, from the
node named in `references/prompts.md`. Pin paths that worked in the test: trigger
inputs at `$.<input>`; Enrich person fields at `$.result.name`, `$.result.title`,
`$.result.org` (also `$.result.url`, `$.result.current_experience[0].company_domain`);
Claygent outputs at `$.<field>`. Give every output field a description — the write is
rejected without one. After creating the Claygent nodes, `nodes get` each one and
confirm the prompt is not blank and the model is the one listed. Validate the graph. A
manual test run uses the draft, so no publish is needed to run this skill.

## Step 3 — Test on one person

Take one person from the list and start one run with `clay workflows runs test` and
the three trigger inputs; wait with `clay workflows runs get <wf> <run> --wait`. Then
read `clay workflows runs get <wf> <run> --verbose`:

- **cost** — the top-level `dataCreditsUsed` and `actionCreditsUsed` are this run's
  actual spend. Use them, **never the workspace balance**: in a shared workspace the
  balance moves with everyone's work (the test that measured 3.3 credits saw the balance
  fall by about 3,200 in the same minutes).
- **values** — each node is in `.nodes[]` by `nodeName`; Enrich person's fields are at
  `.outputs.result.<field>`, each Claygent's at `.outputs.structuredOutputs.<field>`.
  Check values, not status — a node can complete around an empty result.

If any node errored or returned empty fields, fix the build (wiring, output schema,
model) and re-test — never the prompt wording.

## Step 4 — Show the test, set the cap, then run the rest

**One message:** the test person's full plan in the output shape below, the measured
cost for one person, that cost × the remaining people, and one question: *what is the
most you want to spend on this list?* Say plainly that research depth varies, so later
people can cost more or less than the first. **Wait** — this is the look at gift taste
no estimate reveals, and the spend decision in the same breath.

Then start one run per remaining person, a few at a time. Keep a running total of each
finished run's `dataCreditsUsed`; **stop before the next batch would pass the cap** and
say how many people remain.

## Step 5 — Assemble the plan from the node outputs

Build each row **from the node that produced each field** — name, title and company
from *Enrich person*; interests and research notes from *Research Interests*; gift and
rationale from *Ideate Gift*; product name, URL, price and `link_verified` from
*Purchasable Product Link*; only the message from *Personalized Message*. Never take a
URL or price from the message node's copies.

Compare each price to the budget band in code, not by eye; outside it → flag
`over-budget` or `under-budget` in the price cell. A run that ended at **Person found?**
goes under *Could not identify*. A failed run is listed with its error, never dropped.

## Representative output

### Gift plan per person

| Person | Title · Company | Interests | Research notes | Gift | Why it fits | Price | Product link | Link verified | Message |
|---|---|---|---|---|---|---|---|---|---|
| Dana Whitfield | VP Marketing · Northwind | trail running, specialty coffee | Posted about a Big Sur marathon PR (Mar); bio mentions "pour-over snob" | Fellow Stagg EKG kettle | Turns her pour-over habit into a ritual | $165 · over-budget | fellowproducts.com/… | true | "Dana — congrats again on Big Sur…" |
| Sam Ortiz | Head of Data · Contoso | chess, sci-fi | Inferred from title and bio; no public posts found | Chess.com Diamond, 1 year | Fits a strategy-minded data lead | $70 | chess.com/… | false | "Sam — a little something for your next rapid game…" |

### Could not identify

| LinkedIn URL | Reason |
|---|---|
| linkedin.com/in/… | Enrich person returned no person; the run stopped before any research |

Plus a summary: people in, identified, gifts planned, links verified vs not, gifts
outside the budget band, the band used (and whether it was the author's default),
failed runs, and credits spent (the sum of each run's reported `dataCreditsUsed`) against
the cap.

## What this skill does not claim

- How often a gift chosen this way is well received has never been measured.
- A gift based on inferred interests sits in the same list as one based on found interests; the only marker is the research note.
- This graph has been run end to end once, on one person (3.3 data credits, 5 action executions). Cost varies with how much research each person needs, and nothing has measured the spread across a list.
- Prices and stock are as listed when the page was checked; shipping to the recipient's country is not checked.
- It does not check whether the recipient's employer limits the gifts they may accept.
- Public interests can be stale — a post from years ago may not reflect what the person cares about now.
- Why the budget band is $30-$150 was never established — it is the author's default, not a tested figure.

## What good looks like

- The workflow is built once and reused; the second list costs no build time.
- Every gift traces back to an interest, and every interest to a source — or a research note that says it was inferred.
- A sender can tell at a glance which product links were confirmed and which gifts fall outside the budget.
- People Clay could not identify cost one enrichment and nothing more — no research ran on a blank name.
- The common mistake: rewording the prompts "to fit the skill". They are the product; the skill is the wiring.

## Rules

- MUST use the four prompts in `references/prompts.md` verbatim, on the models listed there; NEVER reword, merge or substitute a model silently.
- MUST look for an existing **Generate personalized gift** workflow before building, and NEVER edit a workflow, table or record this skill did not create.
- MUST get explicit approval (Step 2) before creating the workflow or running it, and a spend cap (Step 4) before running more than one person.
- MUST end the run when Enrich person returns no `name`; NEVER research or gift for an unidentified person.
- MUST assemble each field from the node that produced it and show `Link verified` for every row; NEVER put the link in the message.
- NEVER buy, ship or send a gift or a message, or write to a CRM or sequence — this ends at the plan.

## Worked example

Ask: "Gift ideas for these 25 champions, budget $50-$120." Step 0: signed in, Clay
plugin present. Step 1: 25 URLs → 24 unique; budget theirs. Step 2: no existing
workflow; the seven-node graph and the one-person test are approved; built, validated.
Step 3: test on one person — every node filled; the run reports 3.3 data credits. Step
4: the test plan is shown with "3.3 credits for one person, about 76 for the other 23 —
what's the most you want to spend?"; cap set at 100. Step 5: 23 runs, totalling each
run's reported credits between batches; 21 identified, 2 stopped at *Person found?*, 0
failed. Summary: 24 in · 22 identified · 22 gifts planned · 19 links verified · 2 outside
the budget · budget $50-$120 (theirs) · 74.6 credits spent of a 100 cap.
