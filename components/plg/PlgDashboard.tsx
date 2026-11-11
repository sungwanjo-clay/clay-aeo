'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { DashboardPayload } from '@/lib/plg/load'
import { PRESETS } from '@/lib/plg/range'
import { fmtShort } from '@/lib/plg/dates'
import FilterCard, { type FilterState } from './FilterCard'
import KpiTiles from './KpiTiles'
import CumulativeChart from './CumulativeChart'
import TierPacing from './TierPacing'
import ChannelTable from './ChannelTable'
import { DomainQuality, McpByPlatform } from './McpAndQuality'
import { Commentary, DataQualityStrip, Discuss, RestatementBanner } from './Narrative'
import { Eyebrow, Pill, Segmented, T } from './ui'

const TABS = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'social', label: 'Social video', disabled: true, title: 'Coming soon' },
  { id: 'startup', label: 'Startup program', disabled: true, title: 'Coming soon' },
] as const

function freshness(v: DashboardPayload) {
  const through = `Data through ${fmtShort(v.range.dataEnd)}`
  if (!v.range.lastRefreshAt) return through
  const t = new Date(v.range.lastRefreshAt)
  return `${through} · refreshed ${t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

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
    const next = new URLSearchParams()
    const preset = 'preset' in patch ? patch.preset : data.params.preset
    if (preset) {
      next.set('preset', preset)
    } else {
      next.set('start', patch.start ?? data.range.start)
      next.set('end', patch.end ?? data.range.end)
    }
    const compare = patch.compare ?? data.params.compare
    const grain = patch.grain ?? data.params.grain
    if (compare !== 'previous_period') next.set('compare', compare)
    if (grain !== 'day') next.set('grain', grain)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
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

  const v = data
  const presetLabel = v.params.preset ? PRESETS.find(p => p.id === v.params.preset)?.label : 'Custom dates'

  return (
    <div className="px-4 py-6 sm:px-10 sm:py-8 xl:px-16 flex flex-col gap-6 sm:gap-8" style={{ background: T.page, minHeight: '100%' }}>
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3 min-w-0">
          <Eyebrow>PLG weekly metrics · Workspaces</Eyebrow>
          <h1 className="text-[40px] sm:text-[60px] leading-[1.05] font-bold" style={{ color: T.ink, letterSpacing: '-0.04em' }}>
            New workspaces &amp; pacing
          </h1>
          <p className="text-[17px]" style={{ color: T.muted }}>Blended attribution, cut by channel and tier</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {v.source === 'fixture'
            ? <Pill tone="amber" title="Local fixture file (PLG_FIXTURE_PATH), not the live Supabase tables">Fixture data</Pill>
            : <Pill tone="neutral" title={v.range.settled ? 'Settled' : 'Settling (±5% expected)'}>{freshness(v)}</Pill>}
          <span className="rounded-full px-5 py-2.5 text-[16px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {presetLabel}
          </span>
        </div>
      </header>

      <Segmented ariaLabel="Dashboard section" size="lg" value="workspaces" onChange={() => {}}
        options={TABS.map(t => ({ ...t }))} />

      <RestatementBanner v={v} />

      <FilterCard
        state={{ preset: v.params.preset, start: v.range.start, end: v.range.end, compare: v.params.compare, grain: v.params.grain }}
        prevStart={v.range.prevStart} prevEnd={v.range.prevEnd}
        dataStart={v.range.dataStart} dataEnd={v.range.dataEnd}
        onChange={update}
      />

      <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
        {error && <p className="text-[14px]" style={{ color: T.neg }}>Refresh failed: {error.msg}</p>}
        <KpiTiles v={v} />

        <div className="grid gap-6 sm:gap-8 grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <CumulativeChart v={v} onZoom={(start, end) => update({ preset: null, start, end })} />
          <TierPacing v={v} />
        </div>

        <ChannelTable v={v} />

        <div className="grid gap-6 sm:gap-8 grid-cols-1 xl:grid-cols-2">
          <McpByPlatform v={v} />
          <DomainQuality v={v} />
        </div>

        <Commentary v={v} />
        <Discuss v={v} />
        <DataQualityStrip v={v} />
      </div>
    </div>
  )
}
