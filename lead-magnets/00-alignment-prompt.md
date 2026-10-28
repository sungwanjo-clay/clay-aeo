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
| **Claude** | Writes the **play spec**, the single definition of the logic that both the page and the GTM agent follow. Builds the **Clay workflow** behind each page and the **endpoint** the page calls. Writes the page brief for Ploy. |
| **Ploy** | Builds the page in React, Astro and Tailwind. Owns the design and interactivity. Calls the endpoint, turns its output into the teaser, and links the CTA to the GTM agent. Decides how the teaser is worded and revealed. |
| **Clay GTM agent** | Writes the **prompt the CTA carries**, and owns what happens after the click. It rebuilds the same check by following the play spec, so the visitor sees the **same numbers** as on the page, then goes further. |

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
endpoint straight from the browser. No API key or auth header is needed.

**CORS** allows `https://makes.clay.com` plus the staging and Ploy preview origins. Preview
subdomains are matched with a wildcard entry such as `https://*.<preview-domain>`. Send us the
exact staging origin and the preview domain pattern.

**Test mode.** For QA, `?mock=1` on the page replays `example_result` from the canvas data
without calling the endpoint, so it uses no checks and no rate limit. Production ignores it.
`example_result` is golden list A from the play spec, so mock mode shows the same numbers a real
run of that list does.

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
  "spec_version": "crm-cleanup@2",
  "run_id": "33a948f2-9590-4e05-b4ed-888eeb132a2e",
  "status": "ok",
  "headline": "5 of 6 contacts need cleanup",
  "counts": {
    "total": 6,
    "needs_cleanup": 5,
    "clean": 1,
    "invalid": 2,
    "format_invalid": 1,
    "mailbox_invalid": 1,
    "risky_catch_all": 0,
    "role_inboxes": 1,
    "duplicates": 1,
    "personal": 1,
    "disposable": 0,
    "unverified": 0,
    "to_verify": 2
  },
  "truncated": 0
}
```

| Field | Meaning |
|---|---|
| `spec_version` | The version of the logic that produced these numbers. Pass it into the deep link unchanged. |
| `run_id` | A unique id for this check. Attach it to every analytics event from the run, and pass it into the deep link, so a page visit can be joined to the GTM agent session it leads to. Error responses from `502` and `504` include it too. |
| `status` | Always `ok` today. The page should still handle `no_data` the same way as the `no_emails` error below, in case it appears later. |
| `headline` | A ready-made teaser line. You can reword it from the counts. |
| `counts.total` | Emails checked, at most 25 |
| `counts.needs_cleanup` | The sum of the problem buckets below |
| `counts.clean` | Mailbox verified as deliverable |
| `counts.invalid` | `format_invalid` + `mailbox_invalid` |
| `counts.format_invalid` | Malformed addresses, caught by the format check |
| `counts.mailbox_invalid` | Mailbox not found, or a do-not-mail address such as a spam trap, caught by the mailbox check |
| `counts.risky_catch_all` | The domain accepts all mail, so delivery isn't guaranteed |
| `counts.role_inboxes` | Shared inboxes like info@ or sales@ |
| `counts.duplicates` | The same email entered more than once |
| `counts.personal` | Personal addresses like Gmail or Outlook |
| `counts.disposable` | Throwaway domains like Mailinator |
| `counts.unverified` | The verifier couldn't confirm the mailbox either way |
| `counts.to_verify` | Emails that passed the free screens and reached the mailbox check |
| `truncated` | Emails beyond the first 25 that weren't checked |

The response never contains an email address. That is the gate. Which contacts are which lives
only in Clay.

**Errors.** Every error has the shape `{ "error": "<code>", "message": "<text you can show>" }`.

| Status | `error` | What the page does |
|---|---|---|
| `400` | `no_emails` | The paste contained no email address at all. Show "We couldn't find any emails in that. Try pasting a few from your CRM." under the input, and don't run the canvas. |
| `400` / `413` | `invalid_input` | Show `message` inline under the input. The canvas stays idle. |
| `429` | `rate_limited` | Also includes `retry_after` in seconds. Say "You've run a lot of checks. Try again in a minute, or clean the full list in Clay." Show the CTA. |
| `502` | `upstream_error` | "Something went wrong running the check." Offer a retry button and the CTA. |
| `504` | `timeout` | Same as `502` |

**Limits.** 5 checks per minute and 30 per day per visitor IP, plus a site-wide cap. Most checks
take 1–5 seconds. A failed mailbox check can make one take about a minute while the provider
retries, so allow **60 seconds** before treating a request as failed. After 10 seconds, change the
verify node's working line to "Still checking mailboxes… some servers are slow to answer."

## CRM Cleanup: how the page should behave

**1. Input**

Ask for exactly these fields. They come from the play spec's Inputs table, and nothing else
should be added.

| Field | Required | UI |
|---|---|---|
| `emails` | Yes | A large paste box (one per line or comma-separated) with a live counter such as "12 / 25". Past 25, say "We'll check the first 25. Clean the rest in Clay." |
| `crm` | No | A one-tap choice: "Where does this list live?" with HubSpot, Salesforce, Spreadsheet and Other. It is used only in the CTA and the deep link, not sent to the endpoint. |

- Put this helper text under the box: *"Paste up to 25 real contacts from your CRM, messy as
  they are. Duplicates and info@ addresses are what we catch."*
- Add a **"Try an example"** button that fills the box with about 10 sample emails, labelled as
  an example, and runs them like any other input. The results are real checks on those samples.
- Optionally, allow dropping a CSV. Parse it in the browser, find the email column, and send the
  first 25. Tell the visitor how many rows the file had, because the remaining rows are a natural
  reason to continue in Clay.
- Don't ask for names, company, the visitor's own email or a login. None of them change the
  result.
- One button: **"Check my list"**.

**2. The workflow canvas: while it runs and the teaser**

The page's centrepiece is a live canvas showing Clay running the visitor's list, step by step.
**Visual reference:** the attached "Clay is building your motion" screenshot. Use the same
two-column layout:
- the visitor's input and running summary on the left;
- on the right, a dotted-grid canvas of white node cards joined by thin connector lines, with a
  status dot in the header and an "x of y steps" counter;
- done nodes with a green check, running nodes with a spinner, and queued nodes faded with
  dashed connectors.

The difference from that screenshot: **the nodes are the real steps of the Clay workflow behind
this page**, in the order the play spec runs them. Each card's footer names the Clay node type
that runs it, the way the reference shows "Claygent" or "Code".

[INTERACTION | intent: "A two-column workflow canvas in the style of the attached Clay screenshot. Left column: before submit, the paste box, the optional 'Where does this list live?' chips and the 'Check my list' button. After submit it collapses into a one-line summary ('6 emails · HubSpot') above a 'Your cleanup so far' list of colored chips that fill in as steps finish, the headline and the CTA. Right column: a canvas card headed 'Clay is cleaning your list' with a pulsing status dot and a '{done} of 8 steps' counter. Under it, eight node cards joined by connector lines: 'Your list' at the top, a row of five screening nodes (Remove duplicates → Check format → Screen throwaway domains → Spot role inboxes → Flag personal emails, left to right with arrows, because order matters: the first step that catches an email claims it), then 'Verify mailboxes', then 'Build your cleanup report'. Below them, a faded, dashed-connector row of four locked nodes tagged 'Runs in Clay': 'See every email and why', 'Keep list', 'Find replacement emails' and a sync node whose label follows the visitor's crm choice ('Sync to HubSpot', 'Sync to Salesforce', 'Export to a sheet' for Spreadsheet, 'Sync to your CRM' for Other or no choice). Before input, the canvas sits idle with every node queued and gray, so the visitor can see the plan before running anything; 'Try an example' runs it for real on labelled sample emails. On submit the POST fires immediately. While it is in flight, the nodes switch to a working state one after another, about 350 ms apart, each with a spinner and its working line, and the verify node keeps a spinner until the response lands. When the response arrives, the nodes resolve top to bottom, one beat (about 300 ms) each, as long as at least 2.5 seconds have passed since submit. Each node flips to a green check with its real count from the response, pushes its chip into the left-hand list, and solidifies the connector to the next node. The verify node shows one small dot per email in counts.to_verify filling in before its result line appears. A node with a 0 count still resolves, as a muted '0 found'. 'Build your cleanup report' shows the headline, the header switches to 'Your list is checked', and the locked row lights up with a soft glow and a lock icon while the CTA 'Clean all {needs_cleanup} in Clay' becomes prominent beside it. Afterwards, clicking any done node opens a small popover saying what the step checks (for example, the first few role-inbox names) and its count, never an email address. Clicking a locked node explains what it delivers in Clay and repeats the CTA. A 'Run again' link resets to the input. On an error, the node that was working turns to a red 'Stopped' state with the endpoint's message and a 'Try again' button, and the CTA stays visible. Under about 768 px wide, the canvas becomes a single vertical column of nodes, with the summary and CTA pinned to the bottom of the screen." | insight: "A list's value is set by its worst segment. Cleaning is triage that runs cheap screens first, so only real candidates reach the mailbox check, and every email ends up in exactly one bucket. Seeing the steps run on your own list makes the 'Runs in Clay' steps feel like the natural next move, not an upsell." | data: {"header": {"title_running": "Clay is cleaning your list", "title_done": "Your list is checked", "counter": "{done} of 8 steps"}, "nodes": [{"id": "list", "name": "Your list", "type_label": "Trigger", "working": "Reading {n} emails…", "done": "{counts.total} emails received", "note_if_truncated": "+{truncated} more waiting in Clay"}, {"id": "duplicates", "name": "Remove duplicates", "type_label": "Code · Free checks", "working": "Comparing every email…", "done": "{counts.duplicates} duplicates", "chip": "Duplicates"}, {"id": "format", "name": "Check format", "type_label": "Code · Free checks", "working": "Checking each address is well formed…", "done": "{counts.format_invalid} malformed", "chip": "Malformed"}, {"id": "disposable", "name": "Screen throwaway domains", "type_label": "Code · Free checks", "working": "Matching against throwaway domains…", "done": "{counts.disposable} throwaway", "chip": "Throwaway"}, {"id": "role", "name": "Spot role inboxes", "type_label": "Code · Free checks", "working": "Looking for info@, sales@, support@…", "done": "{counts.role_inboxes} role inboxes", "chip": "Role inboxes"}, {"id": "personal", "name": "Flag personal emails", "type_label": "Code · Free checks", "working": "Looking for Gmail, Outlook, iCloud…", "done": "{counts.personal} personal", "chip": "Personal"}, {"id": "verify", "name": "Verify mailboxes", "type_label": "Enrich · ZeroBounce · runs once per email", "working": "Pinging mailboxes…", "done": "{counts.clean} valid · {counts.mailbox_invalid} not found · {counts.risky_catch_all} catch-all · {counts.unverified} unconfirmed", "progress_dots": "{counts.to_verify}", "chips": ["Not found", "Catch-all"]}, {"id": "report", "name": "Build your cleanup report", "type_label": "Code", "working": "Adding it up…", "done": "{headline}"}], "locked_nodes": [{"name": "See every email and why", "type_label": "Runs in Clay", "does": "Each email with its bucket and the reason, e.g. 'mailbox not found'"}, {"name": "Keep list", "type_label": "Runs in Clay", "does": "The {counts.clean} sendable emails, ready to export"}, {"name": "Find replacement emails", "type_label": "Runs in Clay", "does": "New work emails for the {counts.invalid} bad ones"}, {"name_by_crm": {"hubspot": "Sync to HubSpot", "salesforce": "Sync to Salesforce", "spreadsheet": "Export to a sheet", "other": "Sync to your CRM", "none": "Sync to your CRM"}, "type_label": "Runs in Clay", "does": "Write the cleaned list back to your CRM, or export it"}], "example_result": {"headline": "5 of 6 contacts need cleanup", "counts": {"total": 6, "duplicates": 1, "format_invalid": 1, "disposable": 0, "role_inboxes": 1, "personal": 1, "to_verify": 2, "clean": 1, "mailbox_invalid": 1, "risky_catch_all": 0, "unverified": 0, "needs_cleanup": 5}}} | label: "Your list running through Clay's CRM Cleanup workflow, step by step"]

**Unverified addresses (`crm-cleanup@2`):**
- Show the headline exactly as the endpoint returns it. For example: "5 of 6 contacts need
  cleanup; 1 could not be verified."
- If `counts.unverified` is above 0:
  - show it as its own count on the verify node and in the left-hand list;
  - add this line under it: "These addresses could not be verified. They are not included in
    the cleanup count.";
  - don't use a green all-clear state anywhere.
- If `needs_cleanup` is 0 and `unverified` is above 0, the CTA is **"Review my list in Clay"**,
  never "Clean all 0 in Clay".

**Rules for the canvas:**
- **Every number on a node comes from the endpoint response.** Map each node to its field, as
  in `data.nodes`. The working lines are copy, not results. Never show a count before the
  response arrives.
- **Never show an email address on the canvas,** in a popover or in the locked nodes. Locked
  nodes may use visibly fake blurred rows as decoration.
- **The canvas is the teaser.** There is no separate results block. The headline sits in the
  report node and at the top of the left column.

**3. CTA**
- Place it directly under the teaser and again at the bottom of the page.
- Label it **"Clean all {needs_cleanup} in Clay"**. If the visitor picked HubSpot or
  Salesforce, use **"Clean all {needs_cleanup} and sync to HubSpot"** (or Salesforce).
  - If `truncated` is above 0: **"Clean all {total + truncated} in Clay."**
  - If `needs_cleanup` is 0 and `unverified` is 0: **"Your list looks clean. Enrich it in Clay."**
  - If `needs_cleanup` is 0 and `unverified` is above 0: **"Review my list in Clay."**
- **What the CTA does.** It hands the GTM agent a filled-in prompt: the template in
  `01-gtm-agent-prompt.md`, filled with `spec_version`, `run_id`, `headline`, the `counts`,
  `truncated`, `crm` if chosen, and **the exact emails that were sent** (the first 25, in
  order, duplicates included). The GTM agent then re-checks the same list with its
  `crm-cleanup` skill and reaches the same numbers.
- **Until the deep link ships (expected mid-November), use copy-and-open:**
  1. Clicking the CTA copies the filled-in prompt to the clipboard.
  2. It then opens Clay's signup page in a new tab, at `{{CLAY_SIGNUP_URL}}` with
     `utm_source=lead-magnet&utm_campaign=crm-cleanup&utm_content={run_id}`.
  3. Show a toast: "Your cleanup is copied. Sign up, open Clay's GTM agent and paste it in to
     see which contacts need fixing."
  4. Keep a small "Copy again" link next to the CTA, in case the clipboard was overwritten.
- **Build the switch now.** Put the CTA behind one config value, `CTA_MODE`, set to
  `copy_and_open` today and `deep_link` later. When the deep link ships, only the URL builder
  changes. The label, the prompt and the analytics stay the same.
- In both modes, fire `cta_clicked` with `cta_mode` and `run_id`.

**4. Copy and trust**
- Don't promise the emails are never stored, because Clay keeps run logs. Use wording like "We
  only use these emails to run this check."
- Never show a count that didn't come from the endpoint.

**5. Analytics**
Fire these events, attaching `run_id` to every event after the response arrives:
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
