import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const AUTH_COOKIE = 'clay-aeo-auth'

/** Verify the site auth cookie (mirrors middleware logic). */
async function isCookieAuthenticated(req: Request): Promise<boolean> {
  if (!process.env.SITE_PASSWORD) return true   // auth disabled globally
  const authSecret = process.env.AUTH_SECRET
  if (!authSecret) return false

  let cookieToken: string | undefined
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx === -1) continue
    if (part.slice(0, eqIdx).trim() === AUTH_COOKIE) {
      cookieToken = part.slice(eqIdx + 1).trim()
      break
    }
  }
  if (!cookieToken) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(authSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('clay-aeo-session'))
  const expected = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  return cookieToken === expected
}

async function runCacheRefresh(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: false, error: 'Missing env vars' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { error } = await supabase.rpc('refresh_dashboard_cache', { p_days: 3 })

  if (error) {
    console.error('[refresh-cache] RPC error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, refreshed_at: new Date().toISOString() })
}

/**
 * GET — called by Vercel cron.
 * Auth: Authorization: Bearer <CRON_SECRET>  OR  valid session cookie.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  const hasCronAuth = !!cronSecret && auth === `Bearer ${cronSecret}`
  const hasCookieAuth = await isCookieAuthenticated(req)

  if (!hasCronAuth && !hasCookieAuth) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  return runCacheRefresh(req)
}
