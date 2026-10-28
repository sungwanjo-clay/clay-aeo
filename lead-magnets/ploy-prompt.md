# Ploy: CRM Cleanup lead magnet

## What it is

A free tool at **makes.clay.com/tools/crm-cleanup**. A visitor pastes up to 25 emails, Clay
checks them, and the page shows the work live on a workflow canvas. The visitor sees **counts
only**, for example "5 of 6 contacts need cleanup", never which emails are which. The CTA sends
them into Clay's GTM agent to see the details and fix the list.

Keep it noindexed until Sungwan approves it.

## What to build

1. **The page:** an input form, a live workflow canvas and a CTA.
2. **A server route** at `/api/crm-cleanup` that calls Clay. The Clay API key must stay on the
   server. Sungwan will give you a Clay API key to store as the secret `CLAY_API_KEY`.

## Inputs

| Field | Required | UI |
|---|---|---|
| `emails` | Yes | A large paste box (one per line or comma-separated) with a live counter like "12 / 25". Past 25, say "We'll check the first 25. Clean the rest in Clay." Optionally accept a CSV drop: find the email column in the browser and send the first 25. |
| `crm` | No | "Where does this list live?" chips: HubSpot, Salesforce, Spreadsheet, Other. Used only in the CTA, not sent to the route. |

Put this helper text under the box: *"Paste up to 25 real contacts from your CRM, messy as they
are. Duplicates and info@ addresses are what we catch."* Add a **"Try an example"** button
that fills the box with about 10 sample emails, labelled as an example. Don't ask for a name,
company, the visitor's email or a login.

## The server route

Use this code as is. It's tested, and the Clay workflow it calls is live.

```ts
// Server route for the CRM Cleanup lead magnet. Runs Clay's CRM Cleanup workflow on the
// pasted emails and returns counts only, never the emails.
//
// Astro: save as src/pages/api/crm-cleanup.ts and add
//   export const prerender = false
//   export const POST = ({ request, clientAddress }) => handleCrmCleanup(request, clientAddress, import.meta.env.CLAY_API_KEY)
//   export const OPTIONS = ({ request }) => new Response(null, { status: 204, headers: cors(request) })

const CLAY_API = 'https://api.clay.com/public/v0'
const ROUTINE_ID = 'workflow:wf_0tnl82wiyc7iywPb4Rp'
const SPEC_VERSION = 'crm-cleanup@3'
const MAX_EMAILS = 25
const TIMEOUT_MS = 55_000
const ALLOWED_ORIGINS = [/^https:\/\/makes\.clay\.com$/, /^https:\/\/([a-z0-9-]+\.)*clay\.com$/]

// The only fields the page ever sees.
const COUNT_FIELDS = [
  'total', 'needs_cleanup', 'clean', 'invalid', 'format_invalid', 'mailbox_invalid',
  'risky_catch_all', 'role_inboxes', 'duplicates', 'personal', 'disposable', 'unverified',
  'to_verify',
]

// Per-instance limits: 5 checks a minute and 30 a day per IP. Swap in your KV store if you
// have one, so the limits hold across instances.
const hits = new Map<string, number[]>()
function rateLimited(ip: string): number {
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter(t => now - t < 86_400_000)
  const lastMinute = recent.filter(t => now - t < 60_000)
  if (lastMinute.length >= 5) return Math.ceil((60_000 - (now - lastMinute[0])) / 1000)
  if (recent.length >= 30) return Math.ceil((86_400_000 - (now - recent[0])) / 1000)
  recent.push(now)
  hits.set(ip, recent)
  return 0
}

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? ''
  const ok = ALLOWED_ORIGINS.some(re => re.test(origin))
  return {
    ...(ok ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
}

function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...cors(request), ...extra } })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export async function handleCrmCleanup(request: Request, ip: string, apiKey: string, apiBase = CLAY_API) {
  let body: { emails?: unknown }
  try {
    body = JSON.parse(await request.text())
  } catch {
    return json(request, { error: 'invalid_input', message: 'Body must be JSON: { "emails": [...] }.' }, 400)
  }
  const raw = typeof body?.emails === 'string' ? body.emails.split(/[\s,;]+/) : body?.emails
  if (!Array.isArray(raw)) {
    return json(request, { error: 'invalid_input', message: '"emails" must be an array or a string.' }, 400)
  }
  const emails = raw.filter((e): e is string => typeof e === 'string')
    .map(e => e.trim()).filter(e => e.length > 0 && e.length <= 254)
  if (!emails.some(e => e.includes('@'))) {
    return json(request, { error: 'no_emails', message: "We couldn't find any emails in that. Try pasting a few from your CRM." }, 400)
  }

  const retryAfter = rateLimited(ip)
  if (retryAfter) {
    return json(request, { error: 'rate_limited', message: 'Too many checks. Try again shortly.', retry_after: retryAfter },
      429, { 'Retry-After': String(retryAfter) })
  }

  const checked = emails.slice(0, MAX_EMAILS)
  const runId = crypto.randomUUID()
  const headers = { 'clay-api-key': apiKey, 'content-type': 'application/json' }
  try {
    const start = await fetch(`${apiBase}/routines/${ROUTINE_ID}/run`, {
      method: 'POST', headers, body: JSON.stringify({ items: [{ id: runId, inputs: { emails: checked } }] }),
    })
    if (!start.ok) throw new Error(`run start ${start.status}`)
    const { routine_run_id } = await start.json() as { routine_run_id: string }

    const deadline = Date.now() + TIMEOUT_MS
    let delay = 500
    while (Date.now() < deadline) {
      await sleep(delay)
      delay = Math.min(delay * 1.5, 2_000)
      const res = await fetch(`${apiBase}/routines/run/${routine_run_id}/results`, { headers })
      if (res.status === 202) continue
      if (!res.ok) throw new Error(`results ${res.status}`)
      const data = await res.json() as { status: string, data?: { status: string, result?: Record<string, unknown> }[] }
      if (data.status !== 'complete') continue
      const item = data.data?.[0]
      if (item?.status !== 'complete' || !item.result) throw new Error('run failed')
      const out = (item.result.structuredOutputs ?? item.result) as Record<string, unknown>
      return json(request, {
        magnet_id: 'crm-cleanup',
        spec_version: SPEC_VERSION,
        run_id: runId,
        status: out.status === 'no_data' ? 'no_data' : 'ok',
        headline: String(out.headline ?? ''),
        counts: Object.fromEntries(COUNT_FIELDS.map(f => [f, Number(out[f] ?? 0)])),
        truncated: emails.length - checked.length,
      })
    }
    return json(request, { error: 'timeout', message: 'The check took too long. Please try again.', run_id: runId }, 504)
  } catch (err) {
    console.error(`crm-cleanup ${runId} failed:`, err)
    return json(request, { error: 'upstream_error', message: 'Something went wrong running the check.', run_id: runId }, 502)
  }
}
```

Add your staging and preview origins to `ALLOWED_ORIGINS`.

**Request:** `POST /api/crm-cleanup` with the body `{ "emails": ["jane@acme.com", "..."] }`.

**Success: `200`**

```json
{
  "spec_version": "crm-cleanup@3",
  "run_id": "33a948f2-…",
  "headline": "5 of 6 contacts need cleanup",
  "counts": {
    "total": 6, "needs_cleanup": 5, "clean": 1, "invalid": 2, "format_invalid": 1,
    "mailbox_invalid": 1, "risky_catch_all": 0, "role_inboxes": 1, "duplicates": 1,
    "personal": 1, "disposable": 0, "unverified": 0, "to_verify": 2
  },
  "truncated": 0
}
```

**Errors:**

| Status | `error` | What the page does |
|---|---|---|
| `400` | `no_emails` | Show the message under the input. Don't run the canvas. |
| `400` | `invalid_input` | Show the message under the input. Don't run the canvas. |
| `429` | `rate_limited` | Show the message with a countdown from `retry_after`, plus the CTA. |
| `502` | `upstream_error` | The working node turns red ("Stopped") and shows the message, a "Try again" button and the CTA. |
| `504` | `timeout` | Same as `502` |

**Timing.** Most checks take 1–5 seconds, but one can take about a minute when a mailbox server
is slow. Allow 60 seconds. After 10 seconds, change the verify node's line to "Still checking
mailboxes… some servers are slow to answer."

## The page: a live workflow canvas

Reuse the /abm canvas look. The nodes are the real steps of the Clay workflow, in order.

[INTERACTION | intent: "A two-column workflow canvas in the style of the /abm 'Clay is building your motion' canvas (live-canvas.tsx). Left column: before submit, the paste box, the optional 'Where does this list live?' chips and the 'Check my list' button. After submit it collapses into a one-line summary ('6 emails · HubSpot') above a 'Your cleanup so far' list of colored chips that fill in as steps finish, the headline and the CTA. Right column: a canvas card headed 'Clay is cleaning your list' with a pulsing status dot and a '{done} of 8 steps' counter. Under it, eight node cards joined by connector lines: 'Your list' at the top, a row of five screening nodes (Remove duplicates → Check format → Screen throwaway domains → Spot role inboxes → Identify personal emails, left to right with arrows, because order matters: the first step that catches an email claims it), then 'Verify mailboxes', then 'Build your cleanup report'. Below them, a faded, dashed-connector row of four locked nodes tagged 'Runs in Clay': 'See every email and why', 'Keep list', 'Find replacement emails' and a sync node whose label follows the visitor's crm choice ('Sync to HubSpot', 'Sync to Salesforce', 'Export to a sheet' for Spreadsheet, 'Sync to your CRM' for Other or no choice). Before input, the canvas sits idle with every node queued and gray, so the visitor can see the plan before running anything; 'Try an example' runs it for real on labelled sample emails. On submit the POST fires immediately. While it is in flight, the nodes switch to a working state one after another, about 350 ms apart, each with a spinner and its working line, and the verify node keeps a spinner until the response lands. When the response arrives, the nodes resolve top to bottom, one beat (about 300 ms) each, as long as at least 2.5 seconds have passed since submit. Each node flips to a green check with its real count from the response, pushes its chip into the left-hand list, and solidifies the connector to the next node. The verify node shows one small dot per email in counts.to_verify filling in before its result line appears. A node with a 0 count still resolves, as a muted '0 found'. 'Build your cleanup report' shows the headline, the header switches to 'Your list is checked', and the locked row lights up with a soft glow and a lock icon while the CTA 'Clean all {needs_cleanup} in Clay' becomes prominent beside it. Afterwards, clicking any done node opens a small popover saying what the step checks (for example, the first few role-inbox names) and its count, never an email address. Clicking a locked node explains what it delivers in Clay and repeats the CTA. A 'Run again' link resets to the input. On an error, the node that was working turns to a red 'Stopped' state with the endpoint's message and a 'Try again' button, and the CTA stays visible. Under about 768 px wide, the canvas becomes a single vertical column of nodes, with the summary and CTA pinned to the bottom of the screen." | insight: "A list's value is set by its worst segment. Cleaning is triage that runs cheap screens first, so only real candidates reach the mailbox check, and every email ends up in exactly one bucket. Seeing the steps run on your own list makes the 'Runs in Clay' steps feel like the natural next move, not an upsell." | data: {"header": {"title_running": "Clay is cleaning your list", "title_done": "Your list is checked", "counter": "{done} of 8 steps"}, "nodes": [{"id": "list", "name": "Your list", "type_label": "Trigger", "working": "Reading {n} emails…", "done": "{counts.total} emails received", "note_if_truncated": "+{truncated} more waiting in Clay"}, {"id": "duplicates", "name": "Remove duplicates", "type_label": "Code · Free checks", "working": "Comparing every email…", "done": "{counts.duplicates} duplicates", "chip": "Duplicates"}, {"id": "format", "name": "Check format", "type_label": "Code · Free checks", "working": "Checking each address is well formed…", "done": "{counts.format_invalid} malformed", "chip": "Malformed"}, {"id": "disposable", "name": "Screen throwaway domains", "type_label": "Code · Free checks", "working": "Matching against throwaway domains…", "done": "{counts.disposable} throwaway", "chip": "Throwaway"}, {"id": "role", "name": "Spot role inboxes", "type_label": "Code · Free checks", "working": "Looking for info@, sales@, support@…", "done": "{counts.role_inboxes} role inboxes", "chip": "Role inboxes"}, {"id": "personal", "name": "Identify personal emails", "type_label": "Code · Free checks", "working": "Looking for Gmail, Outlook, iCloud…", "done": "{counts.personal} personal · still verified", "note": "Personal addresses aren't removed. They go on to the mailbox check, and valid ones stay in your list.", "chip": "Personal (label)"}, {"id": "verify", "name": "Verify mailboxes", "type_label": "Enrich · ZeroBounce · runs once per email", "working": "Pinging mailboxes…", "done": "{counts.clean} valid · {counts.mailbox_invalid} not found · {counts.risky_catch_all} catch-all · {counts.unverified} unconfirmed", "progress_dots": "{counts.to_verify}", "chips": ["Not found", "Catch-all"]}, {"id": "report", "name": "Build your cleanup report", "type_label": "Code", "working": "Adding it up…", "done": "{headline}"}], "locked_nodes": [{"name": "See every email and why", "type_label": "Runs in Clay", "does": "Each email with its bucket and the reason, e.g. 'mailbox not found'"}, {"name": "Keep list", "type_label": "Runs in Clay", "does": "The {counts.clean} sendable emails, ready to export"}, {"name": "Find replacement emails", "type_label": "Runs in Clay", "does": "New work emails for the {counts.invalid} bad ones"}, {"name_by_crm": {"hubspot": "Sync to HubSpot", "salesforce": "Sync to Salesforce", "spreadsheet": "Export to a sheet", "other": "Sync to your CRM", "none": "Sync to your CRM"}, "type_label": "Runs in Clay", "does": "Write the cleaned list back to your CRM, or export it"}], "example_result": {"headline": "5 of 6 contacts need cleanup", "counts": {"total": 6, "duplicates": 1, "format_invalid": 1, "disposable": 0, "role_inboxes": 1, "personal": 1, "to_verify": 2, "clean": 1, "mailbox_invalid": 1, "risky_catch_all": 0, "unverified": 0, "needs_cleanup": 5}}} | label: "Your list running through Clay's CRM Cleanup workflow, step by step"]

**Personal emails (`crm-cleanup@3`):** personal is a label, not a problem bucket.
- The "Identify personal emails" node shows "{counts.personal} personal · still verified", with
  the note: "Personal addresses aren't removed. They go on to the mailbox check, and valid ones
  stay in your list."
- Show the personal chip in a neutral color, apart from the cleanup chips. Never add it to the
  cleanup count; `needs_cleanup` already excludes it.
- The verify node's dots include personal addresses (`counts.to_verify` counts them).

**Unverified addresses:**
- If `counts.unverified` is above 0, show it as its own count, with this line: "These addresses
  could not be verified. They are not included in the cleanup count."
- Never show a green all-clear while any address is unverified.
- Always show the headline exactly as returned.

**Sync node label:**

| Visitor's `crm` choice | Label |
|---|---|
| HubSpot | Sync to HubSpot |
| Salesforce | Sync to Salesforce |
| Spreadsheet | Export to a sheet |
| Other, or no choice | Sync to your CRM |

## The CTA

- **Label:** "Clean all {needs_cleanup} in Clay".
  - If `truncated` is above 0: "Clean all {total + truncated} in Clay".
  - If nothing needs cleanup and some are unverified: "Review my list in Clay".
  - If everything is clean: "Your list looks clean. Enrich it in Clay".
- **Placement:** directly under the result, and again at the bottom of the page.
- **Link:** it opens Clay signup, which drops the visitor into Clay's GTM agent with a
  prefilled prompt. The **prompt template comes from the GTM agent.** Fill in its
  placeholders from the response, plus the exact emails that were checked and `crm`. Then
  build the link:

```js
const redirectTo = `chats?sculptorPrompt=${encodeURIComponent(prompt)}&oneShot=true`
const url = `https://app.clay.com/signup?redirect_to=${encodeURIComponent(redirectTo)}`
```

  Until the template arrives, use a placeholder prompt.

## Rules

- **Never show an email address** on the canvas, in a popover or anywhere else. That's the gate.
- **Every number comes from the route's response.** Never animate a count before the response
  arrives.
- **Mock mode:** `?mock=1` replays `example_result` from the canvas data without calling the
  route.
- **Analytics:** fire `input_started`, `example_used`, `check_submitted`, `result_viewed`,
  `error_shown` and `cta_clicked`. Attach `run_id` once the response arrives.
- **Voice:** direct, specific and a little playful. No invented statistics, logos or pricing
  claims.
