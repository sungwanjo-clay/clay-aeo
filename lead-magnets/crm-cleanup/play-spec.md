# CRM Cleanup: Play Spec

**Version:** `crm-cleanup@3`

**Changes from `crm-cleanup@2`:** personal-provider emails are a **label, not a bucket**. They're
counted as `personal` but still go to the mailbox check, and the result decides their bucket: a
valid personal email is `clean`. `needs_cleanup` no longer includes `personal`. Requested by the
GTM agent.

(v2 notes follow.)

**Changes from `crm-cleanup@1`:** only the headline. A list is never called clean while any
address is unverified, and the number that couldn't be verified is added to the headline. No
bucket, check order, list or mailbox setting changed. Proposed by the GTM agent.

This is the single source of truth for what "cleaning a list" means in the CRM Cleanup lead
magnet. Two things must follow it exactly:

1. **The pre-signup workflow** that powers the clay.com page
   ([Lead Magnet – CRM Cleanup](https://app.clay.com/workspaces/4515/terracotta/tc-workflows/wf_0tnl82wiyc7iywPb4Rp),
   with its code in `workflow/`).
2. **What the GTM agent builds** in the visitor's own workspace after they click through.

If the two disagree, the visitor sees one number on clay.com and a different one in Clay, and
we lose their trust at the moment they sign up. So the rule is simple: **any change to this
spec gets a new version number, and the workflow, the GTM agent prompt and the golden tests are
updated together.**

## Inputs

These are the exact fields the page asks for. Ploy builds the form from this table, and nothing
else goes to the workflow.

| Field | Required | Sent to | Format and limits | Why we ask |
|---|---|---|---|---|
| `emails` | **Yes** | Workflow and deep link | 1–25 email addresses, as an array or one string separated by new lines, commas, semicolons or spaces. Each email is at most 254 characters. Anything over 25 is dropped and reported as `truncated`. | The list being cleaned |
| `crm` | No | Deep link only | One of `hubspot`, `salesforce`, `spreadsheet` or `other` | Lets the GTM agent offer the right sync in step two, and lets the CTA say "Clean and sync to HubSpot" |

**How to get the best results** (Ploy should turn these into helper text under the input)

- **Paste real contacts from the visitor's own CRM or a recent export.** Hand-typed or made-up
  addresses mostly come back invalid, which says nothing about the visitor's actual list.
- **Paste the full 25 if they can.** A small sample gives a noisy result, and 25 gives a
  meaningful ratio.
- **Paste the raw list, messy as it is.** Duplicates, info@ addresses and typos are exactly what
  the check catches, so don't let visitors tidy it first.
- **Use business lists.** The check is set up for B2B outreach, so personal addresses (Gmail,
  Outlook and so on) count as needing cleanup.

**Not asked:** names, company, job title, the visitor's own email, or any login. None of them
change the result, and each one would add friction before the first result.

If an input is added later, for example a purpose choice such as "cold outreach" or "CRM
refresh" that changes which buckets count, it must be added to this table and the spec version
bumped.

In Clay, the agent checks every email the visitor gives it. For the first 25, its counts must
match the page.

## Steps

Run these in order. Each email lands in exactly one bucket, at the first step that catches it.

| # | Step | Rule | Bucket |
|---|---|---|---|
| 1 | Normalise | Trim whitespace and lower-case. Compare on the normalised value. | — |
| 2 | Duplicates | An email already seen earlier in the list | `duplicates` |
| 3 | Format | Must match `^[^@\s]+@[^@\s]+\.[^@\s]+$` | `invalid` |
| 4 | Disposable | Domain is in the disposable list below | `disposable` |
| 5 | Role inbox | Local part (anything before a `+` is used) is in the role list below | `role_inboxes` |
| 6 | Personal (label) | Domain is in the personal-provider list below. Count it as `personal`, then **continue to step 7**. | label only |
| 7 | Mailbox check | Everything left over, personal addresses included, is checked with **ZeroBounce → Verify email** (`validate-email`), with "Only safe to send" turned off | see the mapping below |

**Mailbox check mapping.** Statuses are compared lower-case, with `-` treated as `_`.

| ZeroBounce result | Bucket |
|---|---|
| `status` is `invalid`, `spamtrap`, `abuse` or `do_not_mail` | `invalid` |
| `status` is `catch_all`, or `sub_status` is `catch_all` | `risky_catch_all` |
| `status` is `valid` (and not catch-all) | `clean` |
| Anything else (`unknown`, no result, an error) | `unverified` |

**Totals**

- `total` is the number of emails checked.
- `needs_cleanup` = `duplicates` + `invalid` + `disposable` + `role_inboxes` + `risky_catch_all` (v3: `personal` is not included)
- `unverified` is not counted as needing cleanup.
- `total` = `needs_cleanup` + `clean` + `unverified`. Every checked email lands in exactly one
  of these.
- Diagnostics, which are not extra buckets:
  - `format_invalid`: format failures
  - `mailbox_invalid`: mailbox results mapped to invalid
  - `to_verify`: emails that reached the mailbox check
  - `invalid` = `format_invalid` + `mailbox_invalid`
- Headline, with the numbers filled in:
  1. If `needs_cleanup` is 0 and `unverified` is 0: "All {total} contacts look clean"
  2. Otherwise: "{needs_cleanup} of {total} contacts need cleanup"
  3. If `unverified` is above 0, append "; {unverified} could not be verified"

**Lists** (copied from `workflow/free_checks.py`, which is the canonical copy)

- **Role:** abuse, accounting, accounts, admin, administrator, billing, careers, contact,
  donotreply, enquiries, feedback, finance, hello, help, hiring, hr, info, inquiries, jobs,
  legal, marketing, media, news, newsletter, no-reply, noreply, office, ops, orders, partners,
  postmaster, press, privacy, recruiting, sales, security, service, support, team, webmaster
- **Disposable:** 10minutemail.com, burnermail.io, dispostable.com, emailondeck.com,
  fakeinbox.com, getnada.com, guerrillamail.com, guerrillamail.net, maildrop.cc, mailinator.com,
  mintemail.com, mohmal.com, sharklasers.com, spamgourmet.com, temp-mail.org, tempinbox.com,
  tempmail.com, throwawaymail.com, trashmail.com, yopmail.com
- **Personal:** 163.com, aol.com, att.net, comcast.net, gmail.com, gmx.com, gmx.de,
  googlemail.com, hotmail.com, icloud.com, live.com, mac.com, mail.com, me.com, msn.com,
  outlook.com, proton.me, protonmail.com, qq.com, verizon.net, web.de, yahoo.com, yandex.com,
  yandex.ru, ymail.com, zoho.com

## What the agent adds after signup (step two)

The page stops at the counts. In Clay, the agent shows the same counts first, then delivers what
the page locked:

1. **Every email with its bucket and the reason**, for example "mailbox not found" or "role
   inbox".
2. **A keep list** containing the `clean` emails.
3. **An offer of next steps:** replacement work emails for the invalid ones, and a sync of the
   clean list to their CRM.

None of step two may change the step-one counts.

## Golden tests

Both the page endpoint and the GTM agent build must produce these numbers. Lists B and C never
reach the mailbox check, so their results are fully fixed. List A depends on two live mailbox
results. Pass C as an array, so the padded fifth entry keeps its spaces.

| List | Emails | Expected (v3, run on the published workflow 28 Oct 2026) |
|---|---|---|
| A | `Jane@Acme.com, jane@acme.com, info@clay.com, bob@gmail.com, sam@stripe.com, not-an-email` | Fixed: duplicates 1, format 1, role 1, personal 1 (label), to_verify 3. Live: `jane@acme.com` and `bob@gmail.com` invalid, `sam@stripe.com` clean, giving **"5 of 6 contacts need cleanup"** |
| B | `info@clay.com, bad-email, temp@mailinator.com` (replaces v2's B, which now needs a paid check) | role 1 · invalid 1 · disposable 1 → **"3 of 3 contacts need cleanup"** |
| C | `Sales+eu@acme.com, temp@mailinator.com, x@yopmail.com, a@b, " ops@stripe.com ", Ops@Stripe.com` | duplicates 1 · invalid 1 · role 2 · disposable 2 → **"6 of 6 contacts need cleanup"** |

**Headline fixtures** (synthetic, all passing in the workflow code):

| total | needs_cleanup | unverified | Headline |
|---|---|---|---|
| 3 | 0 | 0 | All 3 contacts look clean |
| 3 | 0 | 3 | 0 of 3 contacts need cleanup; 3 could not be verified |
| 3 | 0 | 1 | 0 of 3 contacts need cleanup; 1 could not be verified |
| 6 | 4 | 2 | 4 of 6 contacts need cleanup; 2 could not be verified |
| 6 | 5 | 0 | 5 of 6 contacts need cleanup |

**Parity runs on the saved workflow** (`crm-cleanup@2`, 28 Oct 2026):
- **B and C** matched the expected numbers exactly.
- **A** matched every free check: duplicates 1, format 1, role 1, personal 1, to_verify 2.
  `jane@acme.com` came back mailbox not found, as before. The ZeroBounce call for
  `sam@stripe.com` failed with a provider error, so it counted as unverified. The headline was
  "5 of 6 contacts need cleanup; 1 could not be verified".

Results for A therefore depend on live mailbox checks. Never force them to the example.

Mailbox results can change between the page and the agent's recheck. Only say a particular
mailbox changed when row-level evidence from both runs supports it. Aggregate counts alone
don't show the cause.
