import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/proxy'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, '', { maxAge: 0, path: '/' })
  return res
}
