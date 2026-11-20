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
import { DataQualityStrip, RestatementBanner } from './Narrative'
import WhatMoved from './WhatMoved'
import { workspacesInsight } from '@/lib/plg/workspacesInsight'
import { Eyebrow, Pill, Segmented, T } from './ui'
import StickyFilters from './StickyFilters'
import Boundary from './Boundary'
import { useRef } from 'react'

export type DashboardTab = 'workspaces' | 'social' | 'startup' | 'portfolio' | 'insights'
const TABS = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'social', label: 'Media properties' },
  { id: 'startup', label: 'Startup program' },
  { id: 'insights', label: 'Content insights' },
] as const
/** Workspaces tab sections, for the sticky bar's jump links. */
const WS_SECTIONS = [
  { id: 'ws-overview', label: 'Overview' }, { id: 'ws-moved', label: 'What moved' }, { id: 'ws-channels', label: 'Channels' },
  { id: 'ws-cro', label: 'CRO' }, { id: 'ws-tier4', label: 'Tier 4' },
]
const HEAD = {
  workspaces: { eyebrow: 'PLG weekly metrics · Workspaces', title: <>New workspaces</>, sub: 'By channel and tier, with conversion and Tier 4 hand-raisers' },
  social: { eyebrow: 'PLG weekly metrics · Media properties · YouTube', title: <>Media properties</>, sub: '' },
  startup: { eyebrow: 'PLG weekly metrics · Startup program · Owner Jenny', title: <>Startup Offer Program</>, sub: 'clay.com/clay-for-startups · no offer sent yet' },
  insights: { eyebrow: 'PLG weekly metrics · Content insights · YouTube creators', title: <>Content insights</>, sub: 'Which creator videos drive workspaces, what they share, and what to make next' },
  portfolio: { eyebrow: 'PLG weekly metrics · Portfolio · VC and accelerator partners', title: <>VC and Partners</>, sub: 'Portfolio companies with a workspace, paying and redeemed' },
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

/** A titled section inside a tab (Workspaces: CRO, Tier 4), with an anchor for the sticky bar's jump links. */
function SectionHead({ id, eyebrow, title, sub, children }: { id: string; eyebrow: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-5 sm:gap-6 pt-6 sm:pt-10 scroll-mt-20" style={{ borderTop: `1px solid ${T.border}` }}>
      <div className="flex flex-col gap-2">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="text-[30px] sm:text-[40px] leading-[1.1] font-bold" style={{ color: T.ink, letterSpacing: '-0.035em' }}>{title}</h2>
        <p className="text-[16px]" style={{ color: T.muted }}>{sub}</p>
      </div>
      {children}
    </section>
  )
}

/** Startup program ↔ Portfolio partners: one switch on the Startup program tab instead of a separate tab. */
function ProgramToggle({ value, onChange }: { value: 'startup' | 'portfolio'; onChange: (v: 'startup' | 'portfolio') => void }) {
  const opts = [{ id: 'startup', label: 'Startup Offer Program', sub: 'clay.com/clay-for-startups' }, { id: 'portfolio', label: 'VC and Partners', sub: 'VC and accelerator portfolios' }] as const
  const i = value === 'portfolio' ? 1 : 0
  return (
    <div role="radiogroup" aria-label="Program view" className="relative inline-grid grid-cols-2 rounded-2xl p-1 self-start w-full sm:w-[460px]" style={{ background: '#EFEEEA' }}>
      <span aria-hidden className="absolute top-1 bottom-1 rounded-xl transition-transform duration-200"
        style={{ left: 4, width: 'calc(50% - 4px)', transform: `translateX(${i * 100}%)`, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }} />
      {opts.map(o => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className="relative z-10 rounded-xl px-4 py-2.5 text-left focus:outline-none focus-visible:ring-2">
          <span className="block text-[15px] font-semibold" style={{ color: value === o.id ? T.ink : T.muted }}>{o.label}</span>
          <span className="block text-[12px]" style={{ color: T.faint }}>{o.sub}</span>
        </button>
      ))}
    </div>
  )
}

/** config/health, written by the daily health check (scripts/health-check.mjs). */
export type Health = { version: 1; checkedAt: string; status: 'ok' | 'warn' | 'alert'; problems: { id: string; level: 'alert' | 'warn'; detail: string }[] }

/** Shown on every tab when the daily check found a problem, or when the check itself hasn't run for two days. */
function HealthBanner({ h }: { h: Health | null | undefined }) {
  if (h === undefined) return null
  const age = h ? (Date.now() - new Date(h.checkedAt).getTime()) / 36e5 : Infinity
  const silent = age > 50
  if (h && h.status === 'ok' && !silent) return null
  const alert = silent || h?.status === 'alert'
  return (
    <div role="status" className="rounded-2xl px-5 py-3 text-[14px] flex flex-col gap-1"
      style={{ background: alert ? '#FCE9E2' : T.amberBg, color: alert ? T.neg : T.amberInk }}>
      <b>{silent ? (h ? `The daily data check hasn’t run since ${new Date(h.checkedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'The daily data check hasn’t run yet')
        : h!.status === 'alert' ? 'Some numbers on this dashboard may be out of date' : 'Data check: something looks off'}</b>
      {!silent && h!.problems.slice(0, 4).map(p => <span key={p.id}>{p.level === 'alert' ? '●' : '○'} {p.detail}</span>)}
    </div>
  )
}

export default function DashboardView({ sources, health, v, loading, error, notice, onChange, refreshedAt, sourceNote, tab = 'workspaces', onTab, social, socialSubtitle, startup, portfolio, insights, tier4, cro }: {
  /** Collapsed "Sources and SQL" panel for the active tab, shown at the bottom. */
  sources?: React.ReactNode
  /** Daily health check verdict; undefined while loading. */
  health?: Health | null
  v: DashboardPayload
  loading: boolean
  error: string | null
  /** Neutral banner under the filters, e.g. "showing the saved 7-day view; connect Sigma for other dates". */
  notice?: React.ReactNode
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
  /** Rendered when tab === 'portfolio'. */
  portfolio?: React.ReactNode
  /** Rendered when tab === 'insights' (Content insights: creator program). */
  insights?: React.ReactNode
  /** Workspaces tab section: Tier 4 SLG hand-raisers. */
  tier4?: React.ReactNode
  /** Workspaces tab: CRO section (landing pages, homepage launch). */
  cro?: React.ReactNode
}) {
  const update = onChange
  const presetLabel = v.params.preset ? PRESETS.find(p => p.id === v.params.preset)?.label : 'Custom dates'
  const active: DashboardTab = onTab ? tab : 'workspaces'
  const isSocial = active === 'social'
  const h = HEAD[active]
  const filterRef = useRef<HTMLDivElement>(null)
  const fstate: FilterState = { preset: v.params.preset, start: v.range.start, end: v.range.end, compare: v.params.compare, grain: v.params.grain }
  const program = active === 'startup' || active === 'portfolio'
  // Portfolio and Content insights have their own period controls, not the dashboard's date range.
  const ownDates = active === 'portfolio' || active === 'insights'

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
          {!ownDates && <span className="rounded-full px-5 py-2.5 text-[16px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {presetLabel}
          </span>}
        </div>
      </header>

      <Segmented ariaLabel="Dashboard section" size="lg" value={active === 'portfolio' ? 'startup' : active}
        onChange={id => onTab?.(id)}
        options={TABS.map(t => ({ ...t, disabled: t.id !== 'workspaces' && !onTab,
          title: t.id !== 'workspaces' && !onTab ? 'Available in the claude.ai version' : undefined }))} />

      {active === 'workspaces' && <RestatementBanner v={v} />}

      {program && onTab && <ProgramToggle value={active === 'portfolio' ? 'portfolio' : 'startup'} onChange={t => onTab(t)} />}

      {!ownDates && <StickyFilters anchor={filterRef} state={fstate} label={v.range.label} prevLabel={v.range.prevLabel} onChange={update}
        sections={active === 'workspaces' ? WS_SECTIONS.filter(x => (x.id !== 'ws-cro' || cro) && (x.id !== 'ws-tier4' || tier4)) : undefined} />}

      {!ownDates && <div ref={filterRef}><FilterCard
        state={fstate}
        prevStart={v.range.prevStart} prevEnd={v.range.prevEnd}
        dataStart={v.range.dataStart} dataEnd={v.range.dataEnd}
        onChange={update}
      /></div>}
      <HealthBanner h={health} />
      {notice && !ownDates && <div className="rounded-2xl px-5 py-3 text-[14px]" style={{ background: T.tile, color: T.ink }}>{notice}</div>}

      {active === 'social' ? <Boundary name="Media properties" resetKey={v}>{social}</Boundary> : active === 'startup' ? <Boundary name="Startup Offer Program" resetKey={v}>{startup}</Boundary> : active === 'portfolio' ? <Boundary name="VC and Partners">{portfolio}</Boundary> : active === 'insights' ? <Boundary name="Content insights">{insights}</Boundary> : <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
        {error && <p className="text-[14px]" style={{ color: T.neg }}>Refresh failed: {error}</p>}
        <div id="ws-overview" className="flex flex-col gap-6 sm:gap-8 scroll-mt-20">
          <Boundary name="Headline tiles" resetKey={v}><KpiTiles v={v} /></Boundary>
          <div className="grid gap-6 sm:gap-8 grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Boundary name="Cumulative chart" resetKey={v}><CumulativeChart v={v} onZoom={(start, end) => update({ preset: null, start, end })} /></Boundary>
            <Boundary name="Pacing by tier" resetKey={v}><TierPacing v={v} /></Boundary>
          </div>
        </div>

        <div id="ws-moved" className="scroll-mt-20"><Boundary name="What moved" resetKey={v}><WhatMoved insight={workspacesInsight(v)} /></Boundary></div>

        <div id="ws-channels" className="flex flex-col gap-6 sm:gap-8 scroll-mt-20">
          <Boundary name="Channel table" resetKey={v}><ChannelTable v={v} /></Boundary>
          <div className="grid gap-6 sm:gap-8 grid-cols-1 xl:grid-cols-2">
            <Boundary name="MCP by platform" resetKey={v}><McpByPlatform v={v} /></Boundary>
            <Boundary name="Domain quality" resetKey={v}><DomainQuality v={v} /></Boundary>
          </div>
        </div>

        {cro && <SectionHead id="ws-cro" eyebrow="Conversion rate optimization" title="Conversion"
          sub="New visitors to workspace and CTA clicks, by landing page, channel and device."><Boundary name="Conversion">{cro}</Boundary></SectionHead>}

        {tier4 && <SectionHead id="ws-tier4" eyebrow="SLG · Tier 4 hand-raisers" title="Tier 4 hand-raisers"
          sub="Tier 4 accounts don’t get an SDR demo. Where they go next, and who to nurture."><Boundary name="Tier 4 hand-raisers">{tier4}</Boundary></SectionHead>}

        <DataQualityStrip v={v} />
      </div>}
      {sources}
    </div>
  )
}
