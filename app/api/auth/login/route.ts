import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/middleware'

async function makeToken(): Promise<string> {
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

export async function POST(req: NextRequest) {
  const { password } = await req.json()
  const expected = process.env.SITE_PASSWORD

  if (!expected || password !== expected) {
    return NextResponse.json({ error: 'Wrong password' }, { status: 401 })
  }

  const token = await makeToken()
  const res = NextResponse.json({ ok: true })

  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })

  return res
}
