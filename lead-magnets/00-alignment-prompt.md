# Clay Lead Magnets: Shared Context

> Paste this into Ploy and into Clay's GTM agent before we start on any single magnet.
> It explains the goal, who does what, how the page calls Clay, and how the first magnet, CRM
> Cleanup, should behave.

## The goal

We're building free lead-magnet pages on clay.com. Each page solves one GTM problem, such as
cleaning a CRM list. The visitor types in an email, a website or a short list, and Clay runs a
real check on it. The page then shows them a **teaser of the result**: words and counts, not the
data itself. For example, "20 of 40 contacts need cleanup. 10 emails aren't valid. 6 are role
inboxes like info@."

The only call to action is **"Finish this in Clay."** It opens Clay's GTM agent with a prompt
already written, so the visitor signs up and picks up exactly where the page left off.

**The teaser is the hook, and the full result lives in Clay.** We want signups that go on to
clean, enrich and sync their data in Clay, ideally back to their CRM. We are not trying to give
the data away on the page.

## Who does what

| Who | Responsibility |
|---|---|
| **Sungwan (Clay)** | Picks the next magnet, approves each piece, connects them and ships the page. |
| **Claude** | Writes the **page brief** for Ploy. Builds the **Clay workflow** behind each page and the **endpoint** the page calls. Defines their inputs and outputs so Ploy and the GTM agent can rely on them. |
| **Ploy** | Builds the page in React, Astro and Tailwind. Owns the design and interactivity. Calls the endpoint, turns its output into the teaser, and links the CTA to the GTM agent. Decides how the teaser is worded and revealed. |
| **Clay GTM agent** | Writes the **prompt the CTA carries**, and owns what happens after the click. It continues the same task on the visitor's data inside Clay. |

## How the pieces connect

```
Visitor pastes emails
        │
        ▼
Page ── POST ──► Lead magnet endpoint ──► Clay workflow (checks and verifies the emails)
     ◄── teaser JSON (counts and a headline only) ──┘
        │
        ▼
Page shows the teaser, then the CTA "Clean all 5 in Clay"
        │
        ▼
Deep link into the GTM agent, carrying the prompt and the teaser
```

The endpoint is already built and holds Clay's API key, so Ploy never touches Clay directly.

## The endpoint (CRM Cleanup)

```
POST https://{{CLAY_AEO_DOMAIN}}/api/lead-magnets/crm-cleanup
Content-Type: application/json
```

`{{CLAY_AEO_DOMAIN}}` will be replaced with the production domain before handoff. Call the
endpoint straight from the browser; CORS is enabled. No API key or auth header is needed.

**Request**

```json
{ "emails": ["jane@acme.com", "info@acme.com", "bob@gmail.com"] }
```

`emails` can also be one string with emails separated by new lines, commas or spaces. Only the
first 25 are checked.

**Success: `200`**

```json
{
  "magnet_id": "crm-cleanup",
  "status": "ok",
  "headline": "5 of 6 contacts need cleanup",
  "counts": {
    "total": 6,
    "needs_cleanup": 5,
    "clean": 1,
    "invalid": 2,
    "risky_catch_all": 0,
    "role_inboxes": 1,
    "duplicates": 1,
    "personal": 1,
    "disposable": 0,
    "unverified": 0
  },
  "truncated": 0
}
```

| Field | Meaning |
|---|---|
| `status` | `ok`, or `no_data` when nothing checkable was sent |
| `headline` | A ready-made teaser line. You can reword it from the counts. |
| `counts.total` | Emails checked, at most 25 |
| `counts.needs_cleanup` | The sum of the problem buckets below |
| `counts.clean` | Mailbox verified as deliverable |
| `counts.invalid` | Malformed, mailbox not found, or a do-not-mail address such as a spam trap |
| `counts.risky_catch_all` | The domain accepts all mail, so delivery isn't guaranteed |
| `counts.role_inboxes` | Shared inboxes like info@ or sales@ |
| `counts.duplicates` | The same email entered more than once |
| `counts.personal` | Personal addresses like Gmail or Outlook |
| `counts.disposable` | Throwaway domains like Mailinator |
| `counts.unverified` | The verifier couldn't confirm the mailbox either way |
| `truncated` | Emails beyond the first 25 that weren't checked |

The response never contains an email address. That is the gate. Which contacts are which lives
only in Clay.

**Errors.** Every error has the shape `{ "error": "<code>", "message": "<text you can show>" }`.

| Status | `error` | What the page does |
|---|---|---|
| `400` / `413` | `invalid_input` | Show `message` inline under the input |
| `429` | `rate_limited` | Also includes `retry_after` in seconds. Say "You've run a lot of checks. Try again in a minute, or clean the full list in Clay." Show the CTA. |
| `502` | `upstream_error` | "Something went wrong running the check." Offer a retry button and the CTA. |
| `504` | `timeout` | Same as `502` |

**Limits.** 5 checks per minute and 30 per day per visitor IP, plus a site-wide cap. Most checks
take 1–5 seconds. Allow up to 30 seconds before treating a request as failed.

## CRM Cleanup: how the page should behave

**1. Input**
- Above the fold, a large text box where visitors paste emails, one per line or comma-separated.
  Show a live counter such as "12 / 25". Past 25, say "We'll check the first 25. Clean the
  rest in Clay."
- Add a **"Try an example"** button that fills the box with about 10 sample emails, labelled as
  an example, and runs them like any other input. The results are real checks on those samples.
- Optionally, allow dropping a CSV. Parse it in the browser, find the email column, and send the
  first 25. Tell the visitor how many rows the file had, because the remaining rows are a natural
  reason to continue in Clay.
- One button: **"Check my list"**.

**2. While it runs**
- Animate four steps in order: *Removing duplicates → Checking formats → Spotting role and
  personal inboxes → Verifying mailboxes*. These are the workflow's real steps.
- Keep the animation on screen for about 2.5 seconds even if the response arrives sooner, so the
  work registers.

**3. Teaser**
- Use `headline` as the big line. For example: **"5 of 6 contacts need cleanup."**
- Show a breakdown of every bucket with a count above 0: invalid, catch-all, role inboxes,
  duplicates, personal, disposable and unverified. Show `clean` as a positive, for example
  "1 ready to send."
- Show a locked panel of blurred placeholder rows titled "In Clay you'll see":
  - which 5 contacts they are and why each failed
  - verified replacement emails for the bad ones
  - the clean list synced to HubSpot or Salesforce

  The rows must be visibly fake placeholders, never real emails.

**4. CTA**
- Place it directly under the teaser and again at the bottom of the page.
- Label it **"Clean all {needs_cleanup} in Clay"**.
  - If `truncated` is above 0: **"Clean all {total + truncated} in Clay."**
  - If `needs_cleanup` is 0: **"Your list looks clean. Enrich it in Clay."**
- The link is the GTM agent deep link with its prompt, filled with the teaser numbers. The GTM
  agent will supply the link and prompt.

**5. Copy and trust**
- Don't promise the emails are never stored, because Clay keeps run logs. Use wording like "We
  only use these emails to run this check."
- Never show a count that didn't come from the endpoint.

**6. Analytics**
Fire these events:
- `input_started`
- `example_used`
- `check_submitted` (with the count of emails)
- `result_viewed` (with `needs_cleanup`)
- `error_shown` (with the error code)
- `cta_clicked` (with its position: under the teaser or at the bottom)

## Rules for every page

1. **Input first.** Nothing stands between the visitor and the first result: no signup and no
   email gate.
2. **Make the wait feel like work.** Show the workflow's steps as they run.
3. **Show real numbers only.** Teaser numbers come from the endpoint. Example data must be
   labelled as an example.
4. **The CTA names the next action.** For example, "Clean all 20 in Clay" rather than "Sign up".
5. **Use Clay's voice.** Direct, specific and a little playful. No invented statistics, customer
   logos or pricing claims.

## Before we build

**GTM agent, please confirm:**
1. The deep-link format and how the prompt is passed, including any length limit.
2. That the prompt survives signup, so a brand-new user lands in the agent with it.
3. The prompt template for CRM Cleanup, and which response fields it uses (for example
   `headline`, `counts.needs_cleanup` and `truncated`).

**Ploy, please confirm:**
1. In two sentences, what you understand the goal to be.
2. That the endpoint and response above work for you, and anything you'd add.
3. How you'll present the teaser, the locked panel and each error state.
