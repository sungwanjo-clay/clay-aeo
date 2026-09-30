---
name: open-roles-and-employee-count
description: |
  From a company domain, return four numbers side by side with Clay: the company's size, its open
  roles from two independent job sources (reported separately, never merged), and how many current
  employees hold the job titles you name. Every count ships with the definition that produced it:
  the posting-age window, the source, and the title include and exclude lists. Use whenever someone
  asks: how many open roles does this company have, how many salespeople work at these accounts,
  find the number of open jobs and employees from a company URL, count the people in a given role
  at my target accounts, or get headcount and job openings for a list of domains. Do NOT use it to
  rank accounts on a hiring signal over time (hiring-radar), to measure headcount growth across
  months (headcount-growth), for full firmographics such as industry, revenue and HQ
  (enrich-account-list), or to name the actual people in those roles (find-decision-makers-at-company).
category: enrich
type: task
tags: [csv, domain, clay-action, persona:sales-reps, persona:revops, persona:sdr]
keyword: open-roles-and-employee-count
proof_status: partial
proof_gaps:
  - stage: stage_p
    reason: The author never confirmed what these counts are meant to be used for, so this skill says what it measures and not what the numbers should drive.
  - stage: stage_p
    reason: The example role (sales leadership, excluding analysts and associates) has no recorded rationale, so it is shipped only as an example the installer replaces.
  - stage: stage_p
    reason: Whether a job lookup with no posting-age window counts postings of any age was not verified by a run. This skill requires a window so it does not depend on the answer.
  - stage: stage_p
    reason: Whether open roles should be filtered to the same titles as the employee count is not established, so the skill asks instead of choosing.
  - stage: stage_e
    reason: Never run. No counts were observed for any company, so how far the two job sources disagree on a single company was not measured here.
  - stage: stage_e
    reason: The credit cost of each action was not looked up, so the cost estimate in Step 4 has to be read from the installer's own Clay pricing at run time.
---

# Open roles and employee count (declare what was counted, then count it)

The insight: **this workflow produces counts that carry no definition, so two companies' numbers
cannot be compared unless the skill supplies one.** Built the obvious way, with each lookup given
only the domain:

- Both open-role lookups run **with no posting-age window** and no keyword or category filter.
  Whatever each returns is "every posting this source knows about", not "roles open now".
- The two lookups are separate sources and run side by side on the same domain, so the workflow
  yields **two different open-role numbers** per company with nothing saying which one to believe.
- The employee count is a **title-keyword match**: people whose current title contains one of the
  include terms and none of the exclude terms. It is not total headcount. Total size comes
  separately, as a text field from the company enrichment.

What follows is the shape of this skill. It fixes the window before anything runs, reports each
job source under its own name, and labels the employee count with the exact title lists that
produced it. A number without its definition is not delivered.

Supporting evidence from elsewhere: the library's `hiring-radar` measurement found
unwindowed job-count sources returning 384 to 8,945 for one company on one day. This skill did not
reproduce that, and says so in what it does not claim.

## Declared inputs

**Nothing here ships with a value.** Each one is the installer's, not the author's: ask for it,
never substitute a plausible default, and if an answer does not exist say which step becomes
unavailable rather than guessing. Where a default IS defensible it is named below, and using it
means saying so in the output.

| Input | What the installer supplies | If it is missing |
|---|---|---|
| **The companies** | a list of company domains or website URLs, one per company | no default: there is nothing to count |
| **The role to count** | job-title terms to **include**, and terms to **exclude** | the author's example is sales leadership: include Sales Manager, Sales Leader, Director of Sales, Revenue Manager; exclude Analyst, Associate. That is an example, not a recommendation. Ask; never run the example silently |
| **Posting-age window** | N days since posted, for open roles | ask. Left unset, the count is not bounded to recent postings. If the installer has no view, 30 days is the window the library's `hiring-radar` skill uses; borrowing it must be stated in the output |
| **Which job sources** | one or both of the two open-role lookups | both is fine, but they are reported in separate columns and never added or averaged |
| **Filter open roles by role?** | yes (use the same titles as the employee count) or no (all roles) | ask. Without it, open roles count every role at the company while the employee count covers only the named titles |
| **Connected account** | the installer's own connected account for the job-openings lookup that requires one | that source is unavailable. Run the other source and say one was skipped |
| **Where results go** | a Clay table, a CSV, or a reply in the conversation | default to a table in the conversation, and say so |

## Step 0: Check the platform, and say where the work runs

Confirm Clay is signed in (`clay whoami` exits 0) and **say which workspace** the run will bill.
Every step below is a per-row Clay action, so each company costs credits in every lookup it runs.
Cleaning the domain list is the only free part, and it happens in the agent before anything runs.

## Step 1: Collect the definition (do not guess)

Ask for each declared input above that the installer has not already given. The role lists and the
window decide what the numbers mean. If the installer will not give them, stop and say which counts
cannot be produced. Never fill them in from the example in Declared inputs.

## Step 2: Write the declaration

Before running anything, write the declaration down once. It travels with every row of output:

```
Window:           postings from the last N days
Job sources:      source A, source B (reported separately)
Open-role filter: none | same titles as employee count
Employees:        current title includes [...], excludes [...]
```

## Step 3: Free checks before anything paid

- Normalise each input to a bare domain: strip the protocol, `www.` and paths.
- Drop blanks and duplicates, and report how many were removed.
- Flag anything that is not a domain (a company name, an email address) as `not_measured: bad_input`
  rather than sending it to a paid lookup.

## Step 4: State the cost, get approval

Count the companies that survived Step 3, multiply by the per-row cost of each lookup being run, and
state the total. This skill does not know the credit prices; read them from the installer's Clay
pricing. **Wait for a yes.**

## Step 5: Do the work

All four lookups take the domain and depend on nothing else, so they can run in parallel. Size
comes from the company enrichment.

| Output | Clay action | Input from the domain | Settings this skill must set |
|---|---|---|---|
| **Company size** | `enrich-company-with-mixrank-v2`, then read its `size` field as text | company identifier | none |
| **Open roles, source A** | `find-google-job-listings` | company URL | keywords, if open roles are filtered by role |
| **Open roles, source B** | `get-job-openings-for-company-v2` (needs the connected account) | domain | days since posted = the window; title filter, if open roles are filtered by role |
| **Employees in the role** | `get-counts-for-profiles-with-mixrank` | company identifier | title keywords to include and to exclude |

Source A takes no posting-age setting. If the window cannot be applied to it, report it
as `unwindowed` next to its number rather than presenting it as comparable to source B.

## Step 6: One value per cell, including "could not measure"

Each count is either a number or one of: `not_measured: no_result`, `not_measured: lookup_failed`,
`not_measured: source_skipped`, or `not_measured: bad_input`. **Zero is a result, not a missing
value.** Never write 0 for a lookup that failed.

## Step 7: Deliver

One row per company: domain, size, open roles per source, employees in the role, and the
declaration from Step 2. Then say what was and was not covered: companies submitted, deduplicated,
measured, and not measured per lookup.

## What good looks like

- Every number sits next to the definition that produced it.
- The two job sources are in two columns. When they disagree, the disagreement is visible, not
  averaged away.
- The common failure: reading an unwindowed job count as "roles open now", or reading the
  title-match count as total headcount.

## Rules

- MUST set a posting-age window, or label the count `unwindowed`.
- MUST report each job source separately. NEVER sum, average or waterfall them into one number.
- MUST label the employee count with its include and exclude title lists.
- NEVER run the example title lists unless the installer chose them.
- NEVER run a paid lookup before Step 4's approval.
- NEVER write 0 for a lookup that did not return.

## Worked example

This skill has not been run, so there are no real values to show. The shape of one output row,
using placeholders only:

| Domain | Size | Open roles, source A (unwindowed) | Open roles, source B (30 days) | Employees: Sales Manager, Director of Sales (excl. Analyst, Associate) |
|---|---|---|---|---|
| example.com | as returned | n | n | n |
