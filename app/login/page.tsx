'use client'

import { useState, FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const from = params.get('from') ?? '/'

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.ok) {
        router.replace(from)
      } else {
        setError('Incorrect password — try again.')
        setPassword('')
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--background)' }}>
      <div className="w-full max-w-sm">

        {/* Logo / wordmark */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3"
            style={{ background: 'var(--clay-black)' }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="3" y="3" width="6" height="6" rx="1.5" fill="#C8F040"/>
              <rect x="11" y="3" width="6" height="6" rx="1.5" fill="white" fillOpacity="0.5"/>
              <rect x="3" y="11" width="6" height="6" rx="1.5" fill="white" fillOpacity="0.3"/>
              <rect x="11" y="11" width="6" height="6" rx="1.5" fill="white" fillOpacity="0.15"/>
            </svg>
          </div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>
            Clay AEO
          </h1>
          <p className="text-xs mt-1 font-semibold" style={{ color: 'rgba(26,25,21,0.45)' }}>
            AI Engine Optimization Dashboard
          </p>
        </div>

        {/* Card */}
        <form onSubmit={handleSubmit}
          className="p-6 rounded-2xl space-y-4"
          style={{ background: '#FFFFFF', border: '1px solid var(--clay-border)', boxShadow: '0 2px 12px rgba(26,25,21,0.06)' }}>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: 'rgba(26,25,21,0.5)' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter access password"
              required
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg text-[14px] outline-none transition-all"
              style={{
                border: error ? '1px solid var(--clay-pomegranate)' : '1px solid var(--clay-border)',
                background: 'rgba(26,25,21,0.02)',
                color: 'var(--clay-black)',
                fontFamily: 'Plus Jakarta Sans, sans-serif',
              }}
              onFocus={e => { if (!error) e.target.style.borderColor = 'var(--clay-slushie)' }}
              onBlur={e => { if (!error) e.target.style.borderColor = 'var(--clay-border)' }}
            />
            {error && (
              <p className="mt-1.5 text-[11px] font-semibold" style={{ color: 'var(--clay-pomegranate)' }}>
                {error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2.5 rounded-lg text-[13px] font-bold transition-opacity"
            style={{
              background: 'var(--clay-black)',
              color: '#FFFFFF',
              opacity: loading || !password ? 0.5 : 1,
              cursor: loading || !password ? 'not-allowed' : 'pointer',
              fontFamily: 'Plus Jakarta Sans, sans-serif',
            }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>
          Clay internal use only
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
