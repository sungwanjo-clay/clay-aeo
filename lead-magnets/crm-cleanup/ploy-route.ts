// Server route for the CRM Cleanup lead magnet. Runs Clay's CRM Cleanup workflow on the
// pasted emails and returns counts only, never the emails.
//
// Astro: save as src/pages/api/crm-cleanup.ts and add
//   export const prerender = false
//   export const POST = ({ request, clientAddress }) => handleCrmCleanup(request, clientAddress, import.meta.env.CLAY_API_KEY)
//   export const OPTIONS = ({ request }) => new Response(null, { status: 204, headers: cors(request) })

const CLAY_API = 'https://api.clay.com/public/v0'
const ROUTINE_ID = 'workflow:wf_0tnl82wiyc7iywPb4Rp'
const SPEC_VERSION = 'crm-cleanup@2'
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
