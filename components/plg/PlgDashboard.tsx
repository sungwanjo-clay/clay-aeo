'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { DashboardPayload } from '@/lib/plg/plan'
import type { FilterState } from './FilterCard'
import DashboardView, { paramsFor } from './DashboardView'
import { T } from './ui'

export default function PlgDashboard() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const qs = sp.toString()
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<{ msg: string; noData: boolean } | null>(null)
  // Query string of the last finished request; loading while it lags the URL.
  const [settledQs, setSettledQs] = useState<string | null>(null)
  const loading = settledQs !== qs

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/plg/dashboard?${qs}`, { signal: ctrl.signal })
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw Object.assign(new Error(j.error ?? r.statusText), { noData: !!j.noData })
        setData(j as DashboardPayload)
        setError(null)
        setSettledQs(qs)
      })
      .catch(e => {
        if (e.name === 'AbortError') return
        setError({ msg: e.message, noData: !!e.noData })
        setSettledQs(qs)
      })
    return () => ctrl.abort()
  }, [qs])

  const update = useCallback((patch: Partial<FilterState>) => {
    if (!data) return
    router.replace(`${pathname}?${paramsFor(data, patch).toString()}`, { scroll: false })
  }, [data, pathname, router])

  if (!data) {
    return (
      <div className="p-6 sm:p-12" style={{ background: T.page, minHeight: '100%' }}>
        {error
          ? <div className="rounded-2xl p-6 text-[15px]" style={{ background: '#FDECEC', color: '#7A1F12' }}>
              <p className="font-bold mb-1">{error.noData ? 'No PLG data yet' : 'Could not load PLG metrics'}</p>
              <p>{error.msg}</p>
            </div>
          : <p style={{ color: T.muted }}>Loading PLG metrics…</p>}
      </div>
    )
  }

  return <DashboardView v={data} loading={loading} error={error?.msg ?? null} onChange={update} />
}
