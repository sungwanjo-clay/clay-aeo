'use client'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import { useCallback, useEffect, useRef, useState } from 'react'
import { generateDateRange } from '@/lib/utils/dateRange'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import {
  getCompetitorList,
  getCompetitorKPIs,
  getClayKPIs,
  getPlatformHeatmap,
  getCompetitorVsClayTimeseries,
  getClayVisibilityTimeseries,
  getWinnersAndLosers,
  getCompetitorCitationRate,
  getCompetitorCitationsFlat,
  getPromptsForCitation,
  getCompetitorPMMComparisonBatch,
  getCompetitorPMMPromptDrilldown,
  getFilteredResponses,
} from '@/lib/queries/competitive'
import type {
  CitationFlatItem,
  CitationPromptRow,
  PMMCompRow,
  PMMCompPromptRow,
} from '@/lib/queries/competitive'
import KpiCard from '@/components/cards/KpiCard'
import HeatmapMatrix from '@/components/charts/HeatmapMatrix'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { getPlatformColor, CHART_COLORS } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'
import CompCitationProfile from '@/components/competitive/CompCitationProfile'
import CompPMMComparison from '@/components/competitive/CompPMMComparison'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import CompetitorIcon from '@/components/shared/CompetitorIcon'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}
const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const COMP_COLORS = ['#4A5AFF', '#FF6B35', '#CC3D8A', '#3DB8CC', '#3DAA6A']
const MAX_SELECT = 5
const CHIPS_LIMIT = 15

interface HeatmapCell { competitor: string; platform: string; visibility_score: number }
interface AnyKPIs {
  visibilityScore: number | null
  deltaVisibility: number | null
  citationRate: number | null
  deltaCitationRate: number | null
  mentionCount: number
  topTopic: string | null
  topPlatform: string | null
  avgPosition?: number | null
}
interface WinnerLoser { competitor_name: string; current: number; previous: number | null; delta: number | null; isNew: boolean }

// ── Delta badge ────────────────────────────────────────────────────────────────
function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span style={{ color: 'rgba(26,25,21,0.35)', fontSize: '11px' }}>—</span>
  const pos = delta >= 0
  return (
    <span style={{
      background: pos ? 'rgba(61,184,204,0.15)' : '#FFE0DD',
      color: pos ? 'var(--clay-slushie)' : 'var(--clay-pomegranate)',
      borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 700,
      display: 'inline-flex', alignItems: 'center', gap: '2px',
    }}>
      <span>{pos ? '↑' : '↓'}</span>
      <span>{Math.abs(delta).toFixed(1)}%</span>
    </span>
  )
}

// ── Tab strip for drill-down sections ─────────────────────────────────────────
function CompTabs({
  options,
  active,
  onChange,
}: {
  options: string[]
  active: string
  onChange: (c: string) => void
}) {
  if (options.length <= 1) return null
  return (
    <div className="flex items-center gap-1 mb-3 flex-wrap">
      {options.map((comp, i) => {
        const isClay = comp === 'Clay'
        const isActive = active === comp
        const nonClayIdx = options.filter(c => c !== 'Clay').indexOf(comp)
        const color = isClay ? null : COMP_COLORS[nonClayIdx >= 0 ? nonClayIdx % COMP_COLORS.length : i % COMP_COLORS.length]
        return (
          <button
            key={comp}
            onClick={() => onChange(comp)}
            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-all"
            style={{
              background: isActive
                ? (isClay ? 'var(--clay-lime)' : color ?? 'var(--clay-black)')
                : 'rgba(26,25,21,0.06)',
              color: isActive
                ? (isClay ? 'var(--clay-black)' : 'white')
                : 'rgba(26,25,21,0.55)',
              border: isActive
                ? `1.5px solid ${isClay ? 'rgba(200,240,64,0.5)' : (color ?? 'var(--clay-black)')}`
                : '1.5px solid transparent',
            }}
          >
            {comp}
          </button>
        )
      })}
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────
function SectionDivider({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="flex-1 h-px" style={{ background: 'var(--clay-border)' }} />
      <div className="text-center shrink-0">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'rgba(26,25,21,0.4)' }}>{title}</p>
        {subtitle && <p className="text-[10px]" style={{ color: 'rgba(26,25,21,0.3)' }}>{subtitle}</p>}
      </div>
      <div className="flex-1 h-px" style={{ background: 'var(--clay-border)' }} />
    </div>
  )
}

// ── KPI comparison table (multi-select) ───────────────────────────────────────
function KpiCompTable({ kpisMap, competitors }: { kpisMap: Record<string, AnyKPIs>; competitors: string[] }) {
  const metrics = [
    { key: 'visibilityScore', label: 'Visibility Score', fmt: (v: any) => v != null ? `${Number(v).toFixed(1)}%` : '—', deltaKey: 'deltaVisibility' },
    { key: 'citationRate', label: 'Citation Rate', fmt: (v: any) => v != null ? `${Number(v).toFixed(1)}%` : '—', deltaKey: 'deltaCitationRate' },
    { key: 'mentionCount', label: 'Mentions', fmt: (v: any) => v != null ? Number(v).toLocaleString() : '—', deltaKey: null },
    { key: 'avgPosition', label: 'Avg Position', fmt: (v: any) => v != null ? `#${Number(v).toFixed(1)}` : '—', deltaKey: null },
    { key: 'topTopic', label: 'Top Topic', fmt: (v: any) => v ?? '—', deltaKey: null },
  ]
  return (
    <div style={CARD} className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
            <th className="py-2.5 px-4 text-left" style={{ ...LABEL, width: '130px' }}>Metric</th>
            {competitors.map((c, i) => {
              const isClay = c === 'Clay'
              const nonClayIdx = competitors.filter(x => x !== 'Clay').indexOf(c)
              const color = isClay ? 'rgba(200,240,64,0.8)' : COMP_COLORS[nonClayIdx >= 0 ? nonClayIdx % COMP_COLORS.length : i % COMP_COLORS.length]
              return (
                <th key={c} className="py-2.5 px-4 text-right" style={LABEL}>
                  <span className="px-2 py-0.5 rounded text-[9px] font-bold" style={{
                    background: isClay ? 'rgba(200,240,64,0.2)' : `${color}18`,
                    color: isClay ? 'var(--clay-black)' : color,
                    border: `1px solid ${isClay ? 'rgba(200,240,64,0.5)' : `${color}40`}`,
                  }}>
                    {c}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {metrics.map(m => (
            <tr key={m.key} style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
              <td className="py-2.5 px-4 text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.55)' }}>
                {m.label}
              </td>
              {competitors.map(c => {
                const isClay = c === 'Clay'
                const kpi = kpisMap[c] as unknown as Record<string, unknown> | undefined
                const val = kpi ? kpi[m.key] : null
                const delta = m.deltaKey && kpi ? kpi[m.deltaKey] as number | null : null
                // Avg Position is only tracked for Clay — show a note for competitors
                const isAvgPos = m.key === 'avgPosition'
                const notTracked = isAvgPos && !isClay
                return (
                  <td key={c} className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {notTracked ? (
                        <span className="text-[11px]" style={{ color: 'rgba(26,25,21,0.3)' }} title="Position tracking is only available for Clay">
                          Not tracked
                        </span>
                      ) : (
                        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                          {m.fmt(val)}
                        </span>
                      )}
                      {delta != null && <DeltaBadge delta={delta} />}
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CompetitivePage() {
  const { toQueryParams } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [loadingExtra, setLoadingExtra] = useState(true)

  // Competitor list + multi-select
  const [competitors, setCompetitors] = useState<string[]>([])
  const [selectedComps, setSelectedComps] = useState<string[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [dropdownSearch, setDropdownSearch] = useState('')
  const dropdownRef = useRef(null)
  // activeComp: which competitor is shown in drill-down sections (Citation, PMM, Sentiment)
  const [activeComp, setActiveComp] = useState<string>('')

  // Per-competitor KPIs
  const [kpisMap, setKpisMap] = useState<Record<string, AnyKPIs>>({})
  const [tsData, setTsData] = useState<{ date: string; [k: string]: string | number }[]>([])
  const [chartCompLines, setChartCompLines] = useState<string[]>([]) // competitors actually rendered in chart
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [movers, setMovers] = useState<WinnerLoser[]>([])

  // Drill-down data
  const [citations, setCitations] = useState<CitationFlatItem[]>([])
  const [pmmRowsMap, setPmmRowsMap] = useState<Record<string, PMMCompRow[]>>({})

  // Citation drill-down cache
  const [citPromptCache, setCitPromptCache] = useState<Record<string, CitationPromptRow[]>>({})
  const [loadingCitPrompts, setLoadingCitPrompts] = useState<string | null>(null)

  const [showAllHeatmap, setShowAllHeatmap] = useState(false)

  // Load competitor list once
  useEffect(() => {
    getCompetitorList(supabase).then(list => {
      setCompetitors(list)
      const initial = list.includes('Clay') ? ['Clay'] : list.slice(0, 1)
      setSelectedComps(initial)
      setActiveComp(initial[0] ?? '')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync activeComp if it's removed from selectedComps
  useEffect(() => {
    if (selectedComps.length > 0 && !selectedComps.includes(activeComp)) {
      setActiveComp(selectedComps[0])
    }
  }, [selectedComps, activeComp])

  function toggleComp(comp: string) {
    setSelectedComps(prev => {
      if (prev.includes(comp)) {
        if (prev.length === 1) return prev // can't deselect last
        return prev.filter(c => c !== comp)
      }
      if (prev.length >= MAX_SELECT) return prev // max reached
      return [...prev, comp]
    })
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !(dropdownRef.current as HTMLElement).contains(e.target as Node)) {
        setDropdownOpen(false)
        setDropdownSearch('')
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [dropdownOpen])

  // Fast effect: KPIs + timeseries + heatmap + movers
  useEffect(() => {
    if (selectedComps.length === 0) return
    setLoading(true)

    async function loadMain() {
      const isDefaultView = selectedComps.length === 1 && selectedComps[0] === 'Clay'

      // Pre-fetch response metadata once — shared across all competitor KPI calls.
      // Eliminates N×2 redundant full-table scans (one per competitor per period).
      const [sharedCurMeta, sharedPrevMeta] = await Promise.all([
        getFilteredResponses(supabase, f),
        getFilteredResponses(supabase, { ...f, startDate: f.prevStartDate, endDate: f.prevEndDate }),
      ])
      const sharedCurIds = sharedCurMeta.map(r => r.id)

      const kpiPromises = selectedComps.map(comp => {
        const isClay = comp === 'Clay'
        const p = isClay
          ? getClayKPIs(supabase, f).then(r => ({
              visibilityScore: r.visibilityScore,
              deltaVisibility: r.deltaVisibility,
              citationRate: r.citationRate,
              deltaCitationRate: r.deltaCitationRate,
              mentionCount: r.mentionCount,
              avgPosition: r.avgPosition,
              topTopic: r.topTopic,
              topPlatform: r.topPlatform,
            })).catch(() => null)
          : Promise.all([
              getCompetitorKPIs(supabase, f, comp, { cur: sharedCurMeta, prev: sharedPrevMeta }).catch(() => null),
              getCompetitorCitationRate(supabase, f, comp).catch(() => ({ rate: null, deltaRate: null })),
            ]).then(([k, cit]) => k ? {
              visibilityScore: k.visibilityScore,
              deltaVisibility: k.deltaVisibility,
              citationRate: cit.rate,
              deltaCitationRate: cit.deltaRate,
              mentionCount: k.mentionCount,
              avgPosition: k.avgPosition ?? null,
              topTopic: k.topTopic,
              topPlatform: k.topPlatform,
            } : null)
        return p.then(kpi => ({ comp, kpi }))
      })

      const [kpiResults, heat, wl] = await Promise.all([
        Promise.all(kpiPromises),
        getPlatformHeatmap(supabase, f, sharedCurIds).catch(() => []),
        getWinnersAndLosers(supabase, f).catch(() => []),
      ])

      const top5 = (wl as WinnerLoser[])
        .filter(w => w.competitor_name !== 'Clay')
        .sort((a, b) => b.current - a.current)
        .slice(0, 5)
        .map(w => w.competitor_name)

      const compsForChart = isDefaultView ? top5 : selectedComps.filter(c => c !== 'Clay')
      setChartCompLines(compsForChart)

      const [clayTs, ...compTsResults] = await Promise.all([
        getClayVisibilityTimeseries(supabase, f).catch(() => []),
        ...compsForChart.map(comp => getCompetitorVsClayTimeseries(supabase, f, comp).catch(() => [])),
      ])

      const compMap: Record<string, Record<string, number>> = {}
      compsForChart.forEach((comp, i) => {
        compMap[comp] = {}
        for (const r of compTsResults[i]) compMap[comp][r.date] = r.competitor
      })

      const allDates = generateDateRange(f.startDate.split('T')[0], f.endDate.split('T')[0])
      const clayDateMap = new Map(clayTs.map(r => [r.date, r.value]))
      const ts = allDates.map(date => {
        const row: { date: string; [k: string]: string | number } = { date }
        if (clayDateMap.has(date)) row['Clay'] = clayDateMap.get(date)!
        for (const comp of compsForChart) {
          if (compMap[comp]?.[date] !== undefined) row[comp] = compMap[comp][date]
        }
        return row
      })

      const newMap: Record<string, AnyKPIs> = {}
      for (const { comp, kpi } of kpiResults) {
        if (kpi) newMap[comp] = kpi
      }
      setKpisMap(newMap)
      setTsData(ts)
      setHeatmap(heat)
      setMovers(wl as WinnerLoser[])
      setLoading(false)
    }

    loadMain().catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, selectedComps.join(',')])

  // Slow effect A: citations for activeComp
  useEffect(() => {
    if (!activeComp) return
    setLoadingExtra(true)
    setCitPromptCache({})
    getCompetitorCitationsFlat(supabase, f, activeComp)
      .then(cit => {
        setCitations(cit as CitationFlatItem[])
        setLoadingExtra(false)
      })
      .catch(() => setLoadingExtra(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, activeComp])

  // Slow effect B: PMM for ALL selectedComps — single fetch, compute all competitors client-side
  useEffect(() => {
    if (selectedComps.length === 0) return
    getCompetitorPMMComparisonBatch(supabase, f, selectedComps)
      .then(result => setPmmRowsMap(result))
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, selectedComps.join(',')])

  // Citation drill-down
  const handleLoadCitationPrompts = useCallback(async (url: string, responseIds: string[]) => {
    if (citPromptCache[url]) return
    setLoadingCitPrompts(url)
    const data = await getPromptsForCitation(supabase, responseIds)
    setCitPromptCache(prev => ({ ...prev, [url]: data as CitationPromptRow[] }))
    setLoadingCitPrompts(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citPromptCache])

  // PMM drill-down — always use the first non-Clay competitor so that
  // competitor_mentioned is computed for the opponent, not for Clay itself.
  // (When activeComp='Clay' the old code set competitor='Clay' making every
  //  badge show Clay's own mention status instead of Apollo/ZoomInfo/etc.)
  const handlePMMDrilldown = useCallback(async (pmmUseCase: string): Promise<PMMCompPromptRow[]> => {
    const nonClay = selectedComps.find(c => c !== 'Clay')
    const compForDrilldown = nonClay ?? activeComp
    return getCompetitorPMMPromptDrilldown(supabase, f, compForDrilldown, pmmUseCase) as Promise<PMMCompPromptRow[]>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComps.join(), activeComp, f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join()])

  // Derived
  const isMulti = selectedComps.length > 1
  const nonClaySelected = selectedComps.filter(c => c !== 'Clay')
  // Patch Clay's visibility in movers to always match the KPI tile (getClayKPIs uses
  // clay_mentioned='Yes' from responses; getWinnersAndLosers uses response_competitors — different sources)
  const clayKpiScore = kpisMap['Clay']?.visibilityScore
  const patchedMovers = movers.map(m =>
    m.competitor_name === 'Clay' && clayKpiScore != null
      ? { ...m, current: clayKpiScore }
      : m
  )
  const topCompetitors = [...patchedMovers].sort((a, b) => b.current - a.current).slice(0, 5)
  const biggestLosers = [...patchedMovers].filter(r => (r.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 5)
  const emerging = patchedMovers.filter(r => r.isNew)

  const heatmapComps = [...new Set(heatmap.map(d => d.competitor))].sort((a, b) => {
    const aS = heatmap.filter(d => d.competitor === a).reduce((s, r) => s + r.visibility_score, 0)
    const bS = heatmap.filter(d => d.competitor === b).reduce((s, r) => s + r.visibility_score, 0)
    return bS - aS
  })
  const limitedComps = showAllHeatmap ? heatmapComps : heatmapComps.slice(0, 50)
  const filteredHeatmap = heatmap.filter(d => limitedComps.includes(d.competitor))

  // Dropdown trigger label — clearly shows who is being compared
  const triggerLabel = (() => {
    if (selectedComps.length === 1) return selectedComps[0]
    const hasClay = selectedComps.includes('Clay')
    const others = selectedComps.filter(c => c !== 'Clay')
    if (hasClay && others.length === 1) return `Clay vs ${others[0]}`
    if (hasClay && others.length > 1) return `Clay vs ${others.length} competitors`
    if (selectedComps.length === 2) return `${selectedComps[0]} vs ${selectedComps[1]}`
    return `${selectedComps[0]} + ${selectedComps.length - 1} more`
  })()

  // Tab strip for drill-down sections
  const drillTabs = isMulti ? (
    <CompTabs options={selectedComps} active={activeComp} onChange={setActiveComp} />
  ) : null

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">

      {/* Header + multi-select chips */}
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>
          Competitive Intelligence
        </h1>
        <p className="text-sm" style={{ color: 'rgba(26,25,21,0.55)' }}>
          AI visibility benchmarks across domains, topics, and platforms.
        </p>

        <div className="mt-1">
          <div className="flex items-center gap-2 mb-2">
            <span style={LABEL}>Compare domains</span>
            {selectedComps.length >= MAX_SELECT && (
              <span className="text-[10px]" style={{ color: 'rgba(26,25,21,0.4)' }}>Max {MAX_SELECT} selected</span>
            )}
          </div>

          {/* Excel-style dropdown */}
          <div ref={dropdownRef} className="relative inline-block">
            <button
              onClick={() => {
                setDropdownOpen(v => {
                  if (v) setDropdownSearch('')
                  return !v
                })
              }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-semibold transition-colors"
              style={{
                background: '#FFFFFF',
                border: '1px solid rgba(26,25,21,0.18)',
                color: 'var(--clay-black)',
                minWidth: '240px',
                cursor: 'pointer',
                boxShadow: dropdownOpen ? '0 0 0 2px rgba(26,25,21,0.1)' : 'none',
              }}
            >
              <span className="flex-1 text-left">{triggerLabel}</span>
              <span style={{ color: 'rgba(26,25,21,0.4)', fontSize: '10px', transform: dropdownOpen ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s' }}>▼</span>
            </button>

            {dropdownOpen && (
              <div
                className="absolute top-full left-0 mt-1 z-50 rounded-lg"
                style={{
                  background: '#FFFFFF',
                  border: '1px solid var(--clay-border)',
                  minWidth: '280px',
                  maxHeight: '380px',
                  display: 'flex',
                  flexDirection: 'column',
                  boxShadow: '0 8px 24px rgba(26,25,21,0.12)',
                }}
              >
                {/* Search input */}
                <div style={{ padding: '8px 10px', borderBottom: '1px solid rgba(26,25,21,0.08)', flexShrink: 0 }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search competitors…"
                    value={dropdownSearch}
                    onChange={e => setDropdownSearch(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    style={{
                      width: '100%',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: '1px solid rgba(26,25,21,0.15)',
                      fontSize: '12px',
                      color: 'var(--clay-black)',
                      background: 'rgba(26,25,21,0.03)',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Scrollable list */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {/* Clay always at top (hide if search doesn't match) */}
                  {competitors.filter(c => c === 'Clay' && c.toLowerCase().includes(dropdownSearch.toLowerCase())).map(comp => {
                    const checked = selectedComps.includes(comp)
                    const disabled = checked && selectedComps.length === 1
                    const mover = movers.find(m => m.competitor_name === comp)
                    const kpi = kpisMap[comp]
                    return (
                      <label key={comp}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[rgba(26,25,21,0.04)] transition-colors"
                        style={{ borderBottom: '1px solid rgba(26,25,21,0.08)' }}
                      >
                        <input type="checkbox" checked={checked} disabled={disabled}
                          onChange={() => !disabled && toggleComp(comp)}
                          style={{ width: '14px', height: '14px', accentColor: '#C8F040', cursor: disabled ? 'not-allowed' : 'pointer' }}
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
                          {comp}
                          <span className="ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)' }}>You</span>
                        </span>
                        {kpi?.visibilityScore != null && (
                          <span className="text-[12px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>{kpi.visibilityScore.toFixed(1)}%</span>
                        )}
                        {mover?.delta != null && (
                          <span className="text-[10px] font-bold" style={{ color: mover.delta >= 0 ? 'var(--clay-positive-text)' : 'var(--clay-pomegranate)', minWidth: '36px', textAlign: 'right' }}>
                            {mover.delta >= 0 ? '↑' : '↓'}{Math.abs(mover.delta).toFixed(1)}%
                          </span>
                        )}
                      </label>
                    )
                  })}

                  {/* Filtered non-Clay competitors */}
                  {competitors
                    .filter(c => c !== 'Clay' && c.toLowerCase().includes(dropdownSearch.toLowerCase()))
                    .map(comp => {
                    const checked = selectedComps.includes(comp)
                    const disabled = checked && selectedComps.length === 1
                    const maxed = !checked && selectedComps.length >= MAX_SELECT
                    const mover = movers.find(m => m.competitor_name === comp)
                    const kpi = kpisMap[comp]
                    return (
                      <label key={comp}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-[rgba(26,25,21,0.04)] transition-colors"
                        style={{ opacity: maxed ? 0.4 : 1, borderBottom: '1px solid rgba(26,25,21,0.04)' }}
                      >
                        <input type="checkbox" checked={checked}
                          disabled={disabled || (maxed && !checked)}
                          onChange={() => !disabled && !maxed && toggleComp(comp)}
                          style={{ width: '14px', height: '14px', accentColor: 'var(--clay-black)', cursor: disabled || maxed ? 'not-allowed' : 'pointer' }}
                          onClick={e => e.stopPropagation()}
                        />
                        <span className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>{comp}</span>
                        {kpi?.visibilityScore != null && (
                          <span className="text-[12px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>{kpi.visibilityScore.toFixed(1)}%</span>
                        )}
                        {mover?.delta != null && (
                          <span className="text-[10px] font-bold" style={{ color: mover.delta >= 0 ? 'var(--clay-positive-text)' : 'var(--clay-pomegranate)', minWidth: '36px', textAlign: 'right' }}>
                            {mover.delta >= 0 ? '↑' : '↓'}{Math.abs(mover.delta).toFixed(1)}%
                          </span>
                        )}
                      </label>
                    )
                  })}

                  {/* Empty state */}
                  {dropdownSearch && competitors.filter(c => c.toLowerCase().includes(dropdownSearch.toLowerCase())).length === 0 && (
                    <div className="px-4 py-4 text-center text-[12px]" style={{ color: 'rgba(26,25,21,0.4)' }}>
                      No competitors match "{dropdownSearch}"
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI tiles / comparison table */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: isMulti ? selectedComps.length : 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : isMulti ? (
        <KpiCompTable kpisMap={kpisMap} competitors={selectedComps} />
      ) : selectedComps.length === 1 ? (() => {
        const comp = selectedComps[0]
        const kpis = kpisMap[comp]
        if (!kpis) return null
        const isClay = comp === 'Clay'
        return (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiCard label="Visibility Score"
              value={kpis.visibilityScore != null ? `${kpis.visibilityScore.toFixed(1)}%` : '—'}
              delta={kpis.deltaVisibility} deltaLabel="vs prev period" />
            <KpiCard label="Citation Rate"
              value={kpis.citationRate != null ? `${kpis.citationRate.toFixed(1)}%` : '—'}
              delta={kpis.deltaCitationRate} deltaLabel="vs prev period" />
            <KpiCard label="Mention Count"
              value={kpis.mentionCount.toLocaleString()}
              delta={null} deltaLabel="times mentioned" />
            {isClay && kpis.avgPosition != null ? (
              <KpiCard label="Avg Position" value={`#${kpis.avgPosition.toFixed(1)}`}
                delta={null} deltaLabel={comp} />
            ) : (
              <div style={CARD} className="p-5 flex flex-col gap-2">
                <div style={LABEL}>Avg Position</div>
                <div className="text-2xl font-bold" style={{ color: 'rgba(26,25,21,0.25)' }}>—</div>
                <div style={{ ...LABEL, color: 'rgba(26,25,21,0.3)' }}>Clay only</div>
              </div>
            )}
            <div style={CARD} className="p-5 flex flex-col gap-2">
              <div style={LABEL}>Top Topic</div>
              <div className="text-lg font-bold leading-snug" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
                {kpis.topTopic ?? '—'}
              </div>
              <div style={{ ...LABEL, color: 'rgba(26,25,21,0.3)' }}>{kpis.topPlatform ?? ''}</div>
            </div>
          </div>
        )
      })() : null}

      <SectionDivider title="Market Position" subtitle="Visibility benchmarks & trends" />

      {/* Trend chart + static Top Competitors / Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Trend chart (2/3) */}
        <div style={CARD} className="p-4 lg:col-span-2">
          <div style={LABEL} className="mb-3">
            {isMulti
              ? `Visibility Over Time — ${selectedComps.join(' vs ')}`
              : chartCompLines.length > 0
                ? `Clay vs Top Competitors — Visibility Over Time`
                : `Clay Visibility — Trend Over Time`}
          </div>
          {loading ? <SkeletonChart /> : tsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={tsData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
                <XAxis dataKey="date" tickFormatter={(v: any) => formatShortDate(v)}
                  tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.45)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: any) => `${v}%`}
                  tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.45)' }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(val: any, name: any) => [`${Number(val).toFixed(1)}%`, name]}
                  contentStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', border: '1px solid var(--clay-border)', borderRadius: '8px' }}
                />
                {chartCompLines.length > 0 && (
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="Clay" stroke="var(--clay-black)" strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: 'var(--clay-black)' }} activeDot={{ r: 5 }} name="Clay"
                  connectNulls={false} />
                {chartCompLines.map((comp, i) => (
                  <Line key={comp} type="monotone" dataKey={comp}
                    stroke={COMP_COLORS[i % COMP_COLORS.length]}
                    strokeWidth={2} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} name={comp}
                    connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48" style={{ color: 'rgba(26,25,21,0.35)', fontSize: '13px' }}>
              No trend data available
            </div>
          )}
        </div>

        {/* Right panel: Top Competitors with movement */}
        <div style={CARD} className="p-4 flex flex-col">
          <div style={LABEL} className="mb-1">Top Competitors</div>
          <p className="text-[11px] mb-3" style={{ color: 'rgba(26,25,21,0.45)' }}>By AI visibility this period. Click to add to comparison.</p>
          {loading ? <SkeletonCard /> : topCompetitors.map((w, i) => (
            <div key={w.competitor_name} className="flex items-center gap-2 py-2"
              style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
              <span style={{ color: 'rgba(26,25,21,0.3)', fontSize: '11px', fontWeight: 700, width: '16px', flexShrink: 0 }}>{i + 1}</span>
              <CompetitorIcon name={w.competitor_name} size={16} />
              <button
                className="flex-1 text-left text-[13px] font-semibold truncate hover:opacity-70 transition-opacity"
                style={{ color: 'var(--clay-black)', background: 'none', border: 'none', padding: 0, cursor: selectedComps.includes(w.competitor_name) ? 'default' : 'pointer' }}
                onClick={() => !selectedComps.includes(w.competitor_name) && selectedComps.length < MAX_SELECT && toggleComp(w.competitor_name)}
              >
                {w.competitor_name}
              </button>
              <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: 'var(--clay-black)' }}>
                {w.current.toFixed(1)}%
              </span>
              {w.delta !== null ? (
                <span className="text-[11px] font-bold shrink-0 flex items-center gap-0.5"
                  style={{ color: w.delta >= 0 ? 'var(--clay-positive-text)' : 'var(--clay-pomegranate)', minWidth: '44px', justifyContent: 'flex-end' }}>
                  {w.delta >= 0 ? '↑' : '↓'}{Math.abs(w.delta).toFixed(1)}%
                </span>
              ) : (
                <span style={{ color: 'rgba(26,25,21,0.25)', fontSize: '11px', minWidth: '44px', textAlign: 'right' }}>—</span>
              )}
            </div>
          ))}

        </div>
      </div>

      <SectionDivider title="Topic Intelligence" subtitle="Where Clay wins and loses by use case" />

      {/* PMM Topic Comparison */}
      {Object.keys(pmmRowsMap).length === 0 ? (
        <div style={CARD} className="p-4">
          {drillTabs}
          <div style={LABEL} className="mb-3">Visibility by PMM Topic</div>
          <SkeletonChart />
        </div>
      ) : (
        <CompPMMComparison
          allRows={pmmRowsMap}
          selectedComps={selectedComps}
          selected={activeComp}
          onDrilldown={handlePMMDrilldown}
        />
      )}

      <SectionDivider title="Citation & Source Analysis" subtitle="Which sources cite Clay vs competitors" />

      {/* Citation Profile */}
      {loadingExtra ? (
        <div style={CARD} className="p-4">
          {drillTabs}
          <div style={LABEL} className="mb-3">Citation Profile — {activeComp}</div>
          <SkeletonChart />
        </div>
      ) : (
        <CompCitationProfile
          citations={citations}
          selected={activeComp}
          onLoadPrompts={handleLoadCitationPrompts}
          promptCache={citPromptCache}
          loadingPrompts={loadingCitPrompts}
          headerSlot={drillTabs}
        />
      )}

      <SectionDivider title="Platform Coverage" subtitle="Visibility score across all AI platforms" />

      {/* Platform Heatmap */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">Platform Visibility Heatmap</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Visibility Score % per competitor per platform. Showing top {Math.min(50, heatmapComps.length)} by visibility.
        </p>
        {loading ? <SkeletonChart /> : (
          <>
            <HeatmapMatrix data={filteredHeatmap} />
            {heatmapComps.length > 50 && (
              <button
                onClick={() => setShowAllHeatmap(v => !v)}
                className="mt-3 text-[11px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                style={{ color: 'rgba(26,25,21,0.5)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {showAllHeatmap ? 'Show top 50 ↑' : `Show all ${heatmapComps.length} competitors ↓`}
              </button>
            )}
          </>
        )}
      </div>

    </div>
  )
}
