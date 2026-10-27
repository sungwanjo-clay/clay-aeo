# CRM Cleanup: Clay workflow

The backend for the CRM Cleanup lead magnet. It takes the emails a visitor pastes, checks them,
and returns a **gated teaser**: counts and a headline, never the emails themselves.

- **Workflow:** [Lead Magnet – CRM Cleanup](https://app.clay.com/workspaces/4515/terracotta/tc-workflows/wf_0tnl82wiyc7iywPb4Rp) (`wf_0tnl82wiyc7iywPb4Rp`), Clay Team workspace
- **Routine id:** `workflow:wf_0tnl82wiyc7iywPb4Rp`. This is what the server endpoint calls.
- **Status:** draft, tested end to end (see below). Not published.

## What it does

```
Manual trigger { emails: [...] }
  → Free checks      (code, 0 credits)   dedupe · syntax · role inbox · disposable · personal/freemail · cap at 25
  → Verify mailbox   (ZeroBounce, ~0.1 credit each, runs once per email that survives the free checks)
  → Build teaser     (code, 0 credits)   counts → headline + numbers
```

The source for both code nodes is in this folder (`free_checks.py`, `build_teaser.py`), along
with the teaser's output schema (`teaser_schema.json`). The free checks run first so that paid
checks are only spent on emails that could still be sendable.

**Cost:** at most 25 × 0.1 = **2.5 credits per visitor**, and usually less, because personal,
role and duplicate addresses never reach the paid check.

## Input

```json
{ "emails": ["jane@acme.com", "info@acme.com", "bob@gmail.com"] }
```

Only the first 25 emails are checked. The number dropped is reported as `truncated`.

## Output (what the page gets)

The routine returns only the final node's output, so no email address leaves Clay:

```json
{
  "status": "ok",
  "headline": "5 of 6 contacts need cleanup",
  "total": 6,
  "needs_cleanup": 5,
  "clean": 1,
  "invalid": 2,
  "risky_catch_all": 0,
  "role_inboxes": 1,
  "duplicates": 1,
  "personal": 1,
  "disposable": 0,
  "unverified": 0,
  "truncated": 0
}
```

| Field | Meaning |
|---|---|
| `status` | `ok`, or `no_data` when no emails were sent |
| `headline` | A ready-made teaser line. Ploy may reword it from the numbers. |
| `needs_cleanup` | duplicates + invalid + role + disposable + personal + catch-all |
| `clean` | Mailbox verified as deliverable |
| `invalid` | Malformed, mailbox not found, or a do-not-mail address such as a spam trap |
| `risky_catch_all` | The domain accepts all mail, so delivery isn't guaranteed |
| `unverified` | The verifier couldn't confirm the mailbox either way |

`personal` counts as needing cleanup because the page targets B2B lists. Change that in
`build_teaser.py` if a magnet is aimed at a different purpose.

## Endpoint

The public endpoint is `app/api/lead-magnets/crm-cleanup/route.ts`. It starts the routine with
`POST /routines/{id}/run`, polls `GET /routines/run/{run_id}/results`, and returns only the
count fields listed above. The request and response contract Ploy builds against is in
`lead-magnets/00-alignment-prompt.md`.

**Environment variables (Vercel):**

| Variable | Required | Purpose |
|---|---|---|
| `CLAY_API_KEY` | yes | Clay Public API key for the Clay Team workspace (API and CLI → API keys in Clay) |
| `SUPABASE_SERVICE_ROLE_KEY` | for durable limits | Lets every instance share the rate-limit counters |
| `LEAD_MAGNET_ALLOWED_ORIGINS` | no | Comma-separated origins allowed by CORS. Defaults to `*`. |
| `LEAD_MAGNET_RATE_LIMIT_SALT` | no | Salt for hashing visitor IPs |

**Rate limits:** 5 checks per minute and 30 per day per IP, plus 120 per minute site-wide. The
counters live in Supabase: run `supabase/lead_magnet_rate_limit.sql` once. Without it, the
endpoint falls back to a per-instance memory limiter, which only slows abuse down.

A run took about 1–2 seconds in testing. Routine runs started through the API did not need
manual approval, but workflow runs started directly in this workspace did.

## Tested

| Run | Input | Result |
|---|---|---|
| Workflow test `wfr_0tnl876STDYxfYftFX7` | 6 emails: one duplicate, one malformed, one role inbox, one Gmail, 2 business addresses | Gmail, role and duplicate emails were screened out for free. ZeroBounce found one mailbox not found and one valid. Teaser: "5 of 6 contacts need cleanup". |
| Routine run `run_0tnl88cvUdBoes3myFJ` | 3 emails, none reaching the paid check | The verify step ran on an empty list without failing. Teaser: "3 of 3 contacts need cleanup". The response held counts only. |

## Before it goes live

- **Publish** the workflow. It has never been published, so the routine runs the draft, and any edit
  changes the live page immediately.
- **Set the Vercel environment variables** listed above, run `supabase/lead_magnet_rate_limit.sql`,
  and redeploy.
