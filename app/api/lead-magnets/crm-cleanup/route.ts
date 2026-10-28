import { runRoutine, ClayError } from '@/lib/leadMagnets/clay'
import { checkLimits, clientIp, hashKey, type Limit } from '@/lib/leadMagnets/rateLimit'

// Public endpoint behind the clay.com CRM Cleanup lead magnet. Takes up to 25
// emails, runs the Clay workflow and returns counts only, never the emails.
// Contract: lead-magnets/crm-cleanup/workflow/README.md

// A failed mailbox check is retried by the provider, which has taken up to a
// minute, so allow well beyond the usual 1-5 seconds.
export const maxDuration = 60

const ROUTINE_ID = 'workflow:wf_0tnl82wiyc7iywPb4Rp'
// Bump with lead-magnets/crm-cleanup/play-spec.md whenever the workflow logic changes.
const SPEC_VERSION = 'crm-cleanup@2'
const MAX_EMAILS = 25
const MAX_BODY_BYTES = 16_000

const LIMITS: Limit[] = [
  { name: 'crm-cleanup:ip-minute', windowSeconds: 60, max: 5 },
  { name: 'crm-cleanup:ip-day', windowSeconds: 86_400, max: 30 },
]
const GLOBAL_LIMITS: Limit[] = [
  { name: 'crm-cleanup:global-minute', windowSeconds: 60, max: 120 },
]

// The only workflow fields the page ever sees.
const COUNT_FIELDS = [
  'total', 'needs_cleanup', 'clean', 'invalid', 'format_invalid', 'mailbox_invalid',
  'risky_catch_all', 'role_inboxes', 'duplicates', 'personal', 'disposable', 'unverified',
  'to_verify',
] as const

// LEAD_MAGNET_ALLOWED_ORIGINS is a comma-separated list. An entry like
// https://*.example.com also allows every subdomain, for preview deploys.
function originAllowed(origin: string, entry: string): boolean {
  if (entry === origin) return true
  const wildcard = entry.match(/^(https?:\/\/)\*\.(.+)$/)
  if (!wildcard) return false
  const [, scheme, suffix] = wildcard
  return origin.startsWith(scheme) && origin.endsWith(`.${suffix}`)
}

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (process.env.LEAD_MAGNET_ALLOWED_ORIGINS ?? '*')
    .split(',').map(o => o.trim()).filter(Boolean)
  const origin = req.headers.get('origin') ?? ''
  const allowOrigin = allowed.includes('*')
    ? '*'
    : origin && allowed.some(entry => originAllowed(origin, entry)) ? origin : ''
  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(req), ...extra } })
}

function parseEmails(value: unknown): string[] | null {
  const raw = typeof value === 'string' ? value.split(/[\s,;]+/) : Array.isArray(value) ? value : null
  if (!raw) return null
  return raw
    .filter((e): e is string => typeof e === 'string')
    .map(e => e.trim())
    .filter(e => e.length > 0 && e.length <= 254)
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req) })
}

export async function POST(req: Request) {
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) {
    return json(req, { error: 'invalid_input', message: 'Request body is too large.' }, 413)
  }

  let body: { emails?: unknown }
  try {
    body = JSON.parse(text)
  } catch {
    return json(req, { error: 'invalid_input', message: 'Body must be JSON: { "emails": [...] }.' }, 400)
  }

  const emails = parseEmails(body?.emails)
  if (!emails) {
    return json(req, { error: 'invalid_input', message: '"emails" must be an array of strings or a string.' }, 400)
  }
  if (emails.length === 0) {
    return json(req, { error: 'invalid_input', message: 'Add at least one email.' }, 400)
  }
  // Malformed entries still count once there is a real email beside them,
  // but a paste with no @ at all is not a list worth running.
  if (!emails.some(e => e.includes('@'))) {
    return json(req, {
      error: 'no_emails',
      message: "We couldn't find any emails in that. Try pasting a few from your CRM.",
    }, 400)
  }

  const ipKey = await hashKey(clientIp(req))
  const [perIp, global] = await Promise.all([
    checkLimits(ipKey, LIMITS),
    checkLimits('all', GLOBAL_LIMITS),
  ])
  if (!perIp.ok || !global.ok) {
    const retryAfter = Math.max(perIp.retryAfter, global.retryAfter)
    return json(
      req,
      { error: 'rate_limited', message: 'Too many checks. Try again shortly.', retry_after: retryAfter },
      429,
      { 'Retry-After': String(retryAfter) },
    )
  }

  const checked = emails.slice(0, MAX_EMAILS)
  const runId = crypto.randomUUID()
  try {
    const outputs = await runRoutine(ROUTINE_ID, { emails: checked }, runId, 55_000)
    const counts = Object.fromEntries(COUNT_FIELDS.map(f => [f, Number(outputs[f] ?? 0)]))
    return json(req, {
      magnet_id: 'crm-cleanup',
      spec_version: SPEC_VERSION,
      run_id: runId,
      status: outputs.status === 'no_data' ? 'no_data' : 'ok',
      headline: String(outputs.headline ?? ''),
      counts,
      truncated: emails.length - checked.length,
    })
  } catch (err) {
    console.error(`crm-cleanup run ${runId} failed:`, err)
    if (err instanceof ClayError && err.kind === 'timeout') {
      return json(req, { error: 'timeout', message: 'The check took too long. Please try again.', run_id: runId }, 504)
    }
    return json(req, { error: 'upstream_error', message: 'Something went wrong running the check.', run_id: runId }, 502)
  }
}
