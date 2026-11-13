'use client'

import type { DashboardPayload } from '@/lib/plg/plan'
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

export type DashboardTab = 'workspaces' | 'social' | 'startup'
const TABS = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'social', label: 'Social video' },
  { id: 'startup', label: 'Startup program' },
] as const
const HEAD = {
  workspaces: { eyebrow: 'PLG weekly metrics · Workspaces', title: <>New workspaces &amp; pacing</>, sub: 'Blended attribution, cut by channel and tier' },
  social: { eyebrow: 'PLG weekly metrics · Social · YouTube', title: <>Video → offer → workspace</>, sub: '' },
  startup: { eyebrow: 'PLG weekly metrics · Startup program · Owner Jenny', title: <>Startup offer: visit → workspace → paid</>, sub: 'Offer page www.clay.com/clay-for-startups · no offer sent yet' },
} as const

/** Next query params after a filter change (shared by the Next page and the artifact). */
export function paramsFor(v: DashboardPayload, patch: Partial<FilterState>): URLSearchParams {
  const next = new URLSearchParams()
  const preset = 'preset' in patch ? patch.preset : v.params.preset
  if (preset) next.set('preset', preset)
  else {
    next.set('start', patch.start ?? v.range.start)
    next.set('end', patch.end ?? v.range.end)
  }
  const compare = patch.compare ?? v.params.compare
  const grain = patch.grain ?? v.params.grain
  if (compare !== 'previous_period') next.set('compare', compare)
  if (grain !== 'day') next.set('grain', grain)
  return next
}

function freshness(v: DashboardPayload, refreshedAt?: number | string | null) {
  const through = `Data through ${fmtShort(v.range.dataEnd)}`
  const at = refreshedAt ?? v.range.lastRefreshAt
  if (!at) return through
  const t = new Date(at)
  return `${through} · refreshed ${t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

export default function DashboardView({ v, loading, error, onChange, refreshedAt, sourceNote, tab = 'workspaces', onTab, social, socialSubtitle, startup }: {
  v: DashboardPayload
  loading: boolean
  error: string | null
  onChange: (patch: Partial<FilterState>) => void
  /** When the shown data was produced (e.g. Sigma cache.storedAt). */
  refreshedAt?: number | string | null
  /** Tooltip for the freshness pill. */
  sourceNote?: string
  /** Active tab; the Social tab is offered only when onTab is given. */
  tab?: DashboardTab
  onTab?: (t: DashboardTab) => void
  /** Rendered in place of the Workspaces sections when tab === 'social'. */
  social?: React.ReactNode
  socialSubtitle?: string
  /** Rendered when tab === 'startup'. */
  startup?: React.ReactNode
}) {
  const update = onChange
  const presetLabel = v.params.preset ? PRESETS.find(p => p.id === v.params.preset)?.label : 'Custom dates'
  const active: DashboardTab = onTab ? tab : 'workspaces'
  const isSocial = active === 'social'
  const h = HEAD[active]

  return (
    <div className="px-4 py-6 sm:px-10 sm:py-8 xl:px-16 flex flex-col gap-6 sm:gap-8" style={{ background: T.page, minHeight: '100%' }}>
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3 min-w-0">
          <Eyebrow>{h.eyebrow}</Eyebrow>
          <h1 className="text-[40px] sm:text-[60px] leading-[1.05] font-bold" style={{ color: T.ink, letterSpacing: '-0.04em' }}>{h.title}</h1>
          <p className="text-[17px]" style={{ color: T.muted }}>{isSocial ? socialSubtitle : h.sub}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {v.source === 'fixture'
            ? <Pill tone="amber" title="Local fixture file (PLG_FIXTURE_PATH), not live data">Fixture data</Pill>
            : <Pill tone="neutral" title={sourceNote ?? (v.range.settled ? 'Settled' : 'Settling (±5% expected)')}>{freshness(v, refreshedAt)}</Pill>}
          <span className="rounded-full px-5 py-2.5 text-[16px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {presetLabel}
          </span>
        </div>
      </header>

      <Segmented ariaLabel="Dashboard section" size="lg" value={active}
        onChange={id => onTab?.(id)}
        options={TABS.map(t => ({ ...t, disabled: t.id !== 'workspaces' && !onTab,
          title: t.id !== 'workspaces' && !onTab ? 'Available in the claude.ai version' : undefined }))} />

      {active === 'workspaces' && <RestatementBanner v={v} />}

      <FilterCard
        state={{ preset: v.params.preset, start: v.range.start, end: v.range.end, compare: v.params.compare, grain: v.params.grain }}
        prevStart={v.range.prevStart} prevEnd={v.range.prevEnd}
        dataStart={v.range.dataStart} dataEnd={v.range.dataEnd}
        onChange={update}
      />

      {active === 'social' ? social : active === 'startup' ? startup : <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
        {error && <p className="text-[14px]" style={{ color: T.neg }}>Refresh failed: {error}</p>}
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
      </div>}
    </div>
  )
}
