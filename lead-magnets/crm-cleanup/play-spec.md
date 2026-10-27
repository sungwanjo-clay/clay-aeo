# CRM Cleanup: Play Spec

**Version:** `crm-cleanup@1`

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

## Input

A list of email addresses. Only the first 25 are checked on the page. In Clay, the agent checks
every email the visitor gives it. For the first 25, its counts must match the page.

## Steps

Run these in order. Each email lands in exactly one bucket, at the first step that catches it.

| # | Step | Rule | Bucket |
|---|---|---|---|
| 1 | Normalise | Trim whitespace and lower-case. Compare on the normalised value. | — |
| 2 | Duplicates | An email already seen earlier in the list | `duplicates` |
| 3 | Format | Must match `^[^@\s]+@[^@\s]+\.[^@\s]+$` | `invalid` |
| 4 | Disposable | Domain is in the disposable list below | `disposable` |
| 5 | Role inbox | Local part (anything before a `+` is used) is in the role list below | `role_inboxes` |
| 6 | Personal | Domain is in the personal-provider list below | `personal` |
| 7 | Mailbox check | Everything left over is checked with **ZeroBounce → Verify email** (`validate-email`), with "Only safe to send" turned off | see the mapping below |

**Mailbox check mapping.** Statuses are compared lower-case, with `-` treated as `_`.

| ZeroBounce result | Bucket |
|---|---|
| `status` is `invalid`, `spamtrap`, `abuse` or `do_not_mail` | `invalid` |
| `status` is `catch_all`, or `sub_status` is `catch_all` | `risky_catch_all` |
| `status` is `valid` (and not catch-all) | `clean` |
| Anything else (`unknown`, no result, an error) | `unverified` |

**Totals**

- `total` is the number of emails checked.
- `needs_cleanup` = `duplicates` + `invalid` + `disposable` + `role_inboxes` + `personal` + `risky_catch_all`
- `unverified` is not counted as needing cleanup.
- Headline:
  - "{needs_cleanup} of {total} contacts need cleanup"
  - "All {total} contacts look clean" when `needs_cleanup` is 0

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
results.

| List | Emails | Expected |
|---|---|---|
| A | `Jane@Acme.com, jane@acme.com, info@clay.com, bob@gmail.com, sam@stripe.com, not-an-email` | total 6 · duplicates 1 · invalid 2 (1 format + `jane@acme.com` mailbox not found) · role 1 · personal 1 · clean 1 → **"5 of 6 contacts need cleanup"** |
| B | `info@clay.com, bob@gmail.com, bad-email` | total 3 · role 1 · personal 1 · invalid 1 → **"3 of 3 contacts need cleanup"** |
| C | `Sales+eu@acme.com, temp@mailinator.com, x@yopmail.com, a@b, " ops@stripe.com ", Ops@Stripe.com` | total 6 · duplicates 1 · invalid 1 · role 2 · disposable 2 → **"6 of 6 contacts need cleanup"** |

Mailbox results can change over time, for example if a company deletes an inbox. When that
happens, the agent should say so: "On clay.com this showed as valid; it now bounces."
