import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const AUTH_COOKIE = 'clay-aeo-auth'

/** Compute the expected cookie token from AUTH_SECRET using HMAC-SHA256. */
async function expectedToken(): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me'
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('clay-aeo-session'))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow: login page, auth API, Next.js internals, static files
  if (
    pathname === '/login' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value
  const token  = await expectedToken()

  if (cookie !== token) {
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    if (pathname !== '/') loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
