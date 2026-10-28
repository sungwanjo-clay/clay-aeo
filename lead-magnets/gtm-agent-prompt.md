# GTM agent: CRM Cleanup handoff prompt

## What we need from you

**Write the prompt template that the clay.com CRM Cleanup page sends to you.** You know best how
to phrase it so you build the right thing. Make it as short as it can be while still working.

## Context

A free page at makes.clay.com/tools/crm-cleanup lets a visitor paste up to 25 emails. A Clay
workflow checks them, and the page shows **counts only**, for example "5 of 6 contacts need
cleanup: 2 invalid, 1 role inbox, 1 duplicate, 1 personal". The visitor never sees which emails
are which.

The CTA, "Clean all 5 in Clay", opens Clay signup and drops the visitor into you with your
prompt prefilled. From there, you should:

1. **Build the same check** on the same emails and **reach the same counts** the page showed.
   This is the critical part: if your numbers differ, the visitor's first impression of Clay is
   that it contradicts itself.
2. **Show what the page held back:** every email with its bucket and the reason, and a keep list
   of the clean ones.
3. **Offer the next step:** find replacement work emails for the bad ones, and sync the clean
   ones to the visitor's CRM. Don't delete, overwrite or send anything without their approval.

## The check the page runs (crm-cleanup@2)

Your build must follow this exactly to match the counts. Each email lands in the **first**
bucket that matches:

1. **Normalise:** trim whitespace and lower-case. Skip blank entries.
2. **Duplicates:** an email already seen earlier in the list.
3. **Invalid (format):** doesn't match `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
4. **Disposable:** the domain is in the disposable list below.
5. **Role inbox:** the part before `@`, cut at the first `+`, is in the role list below.
6. **Personal:** the domain is in the personal list below.
7. **Mailbox check:** everything left goes to **ZeroBounce → Verify email**, with "Only safe to
   send" **off**. Map the result, in this order:
   - status `invalid`, `spamtrap`, `abuse` or `do_not_mail` → **invalid**
   - status or sub_status `catch-all` → **catch-all**. Check this before valid, because
     ZeroBounce reports catch-alls as `valid` with sub_status `catch-all`.
   - status `valid` → **clean**
   - anything else, including an error → **unverified**

**Totals and headline:**
- **needs cleanup** = duplicates + invalid + disposable + role + personal + catch-all
- **Headline:**
  - "All N contacts look clean" only when needs cleanup and unverified are both 0.
  - Otherwise "X of N contacts need cleanup".
  - If any are unverified, add "; U could not be verified".

**Lists:**
- **Role:** abuse, accounting, accounts, admin, administrator, billing, careers, contact, donotreply, enquiries, feedback, finance, hello, help, hiring, hr, info, inquiries, jobs, legal, marketing, media, news, newsletter, no-reply, noreply, office, ops, orders, partners, postmaster, press, privacy, recruiting, sales, security, service, support, team, webmaster
- **Disposable:** 10minutemail.com, burnermail.io, dispostable.com, emailondeck.com, fakeinbox.com, getnada.com, guerrillamail.com, guerrillamail.net, maildrop.cc, mailinator.com, mintemail.com, mohmal.com, sharklasers.com, spamgourmet.com, temp-mail.org, tempinbox.com, tempmail.com, throwawaymail.com, trashmail.com, yopmail.com
- **Personal:** 163.com, aol.com, att.net, comcast.net, gmail.com, gmx.com, gmx.de, googlemail.com, hotmail.com, icloud.com, live.com, mac.com, mail.com, me.com, msn.com, outlook.com, proton.me, protonmail.com, qq.com, verizon.net, web.de, yahoo.com, yandex.com, yandex.ru, ymail.com, zoho.com

## What the page can put in your prompt

Use any of these as `{{placeholders}}`:

| Placeholder | Example |
|---|---|
| `emails` | The exact emails checked, in order, duplicates included (up to 25) |
| `headline` | 5 of 6 contacts need cleanup |
| `total`, `needs_cleanup`, `clean`, `invalid`, `risky_catch_all`, `role_inboxes`, `duplicates`, `personal`, `disposable`, `unverified` | Numbers |
| `truncated` | How many more emails the visitor pasted beyond 25. They were not sent. |
| `crm` | hubspot, salesforce, spreadsheet, other, or empty |
| `run_id` | A unique id for the page check |
| `spec_version` | crm-cleanup@2 |

## Constraints

- The prompt travels in a URL:
  `https://app.clay.com/signup?redirect_to=chats%3FsculptorPrompt%3D<prompt>%26oneShot%3Dtrue`.
  The prompt is URL-encoded twice, so every character costs about double. With 25 emails, keep
  the template under about 2,000 characters. Skip anything you don't need. You don't have to
  repeat the rules above if you can reproduce them from a shorter instruction, as long as the
  counts still match.
- Assume the visitor has never used Clay and has just signed up.

## Please send back

1. **The prompt template,** with placeholders from the table above.
2. **A test:** run your template with these emails and report the counts you get:
   - `info@clay.com`, `bob@gmail.com`, `bad-email`. Expect "3 of 3 contacts need cleanup": role 1,
     personal 1, invalid 1.
   - `Sales+eu@acme.com`, `temp@mailinator.com`, `x@yopmail.com`, `a@b`, `ops@stripe.com`,
     `Ops@Stripe.com`. Expect "6 of 6 contacts need cleanup": duplicates 1, invalid 1, role 2,
     disposable 2.
