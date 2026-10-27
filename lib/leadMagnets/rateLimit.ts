import { createClient } from '@supabase/supabase-js'

export interface Limit {
  /** Counter name, e.g. 'ip-minute'. Combined with the caller key. */
  name: string
  windowSeconds: number
  max: number
}

export interface LimitResult {
  ok: boolean
  /** Seconds until the window that was exceeded resets. */
  retryAfter: number
}

// Fallback used only when Supabase is unreachable or not configured. It is
// per serverless instance, so it slows abuse down rather than capping it.
const memory = new Map<string, { windowStart: number; hits: number }>()

function memoryHit(key: string, windowSeconds: number): number {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds
  const entry = memory.get(key)
  if (!entry || entry.windowStart !== windowStart) {
    if (memory.size > 10_000) memory.clear()
    memory.set(key, { windowStart, hits: 1 })
    return 1
  }
  entry.hits += 1
  return entry.hits
}

function supabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

async function hit(key: string, windowSeconds: number): Promise<number> {
  const supabase = supabaseClient()
  if (supabase) {
    const { data, error } = await supabase.rpc('lead_magnet_hit', {
      p_key: key,
      p_window_seconds: windowSeconds,
    })
    if (!error && typeof data === 'number') return data
    console.error('lead_magnet_hit failed, using in-memory limiter:', error?.message)
  }
  return memoryHit(key, windowSeconds)
}

/** Records a hit against every limit and fails if any of them is exceeded. */
export async function checkLimits(callerKey: string, limits: Limit[]): Promise<LimitResult> {
  const counts = await Promise.all(
    limits.map(l => hit(`${l.name}:${callerKey}`, l.windowSeconds))
  )
  const nowSeconds = Math.floor(Date.now() / 1000)
  let retryAfter = 0
  limits.forEach((l, i) => {
    if (counts[i] > l.max) {
      const resetIn = l.windowSeconds - (nowSeconds % l.windowSeconds)
      retryAfter = Math.max(retryAfter, resetIn)
    }
  })
  return { ok: retryAfter === 0, retryAfter }
}

/** SHA-256 so raw visitor IPs are never stored. */
export async function hashKey(value: string): Promise<string> {
  const salt = process.env.LEAD_MAGNET_RATE_LIMIT_SALT ?? 'clay-lead-magnets'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
