const AUTH_COOKIE = 'clay-aeo-auth'

/** Same check as proxy.ts: site cookie = HMAC(AUTH_SECRET, 'clay-aeo-session'). */
async function hasSessionCookie(req: Request): Promise<boolean> {
  if (!process.env.SITE_PASSWORD) return true // auth disabled globally
  const secret = process.env.AUTH_SECRET
  if (!secret) return false
  const cookie = (req.headers.get('cookie') ?? '')
    .split(';').map(p => p.trim())
    .find(p => p.startsWith(`${AUTH_COOKIE}=`))
    ?.slice(AUTH_COOKIE.length + 1)
  if (!cookie) return false
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('clay-aeo-session'))
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return cookie === expected
}

/** Vercel cron (Bearer CRON_SECRET) or a signed-in browser session. */
export async function isCronOrSession(req: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return hasSessionCookie(req)
}
