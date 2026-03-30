'use client'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import { useCallback, useEffect, useState } from 'react'
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
  getCompetitorPMMComparison,
  getCompetitorPMMPromptDrilldown,
  getCompetitorSentimentVsClay,
} from '@/lib/queries/competitive'
import type {
  CitationFlatItem,
  CitationPromptRow,
  PMMCompRow,
  PMMCompPromptRow,
  SentimentVsClayData,
} from '@/lib/queries/competitive'
import KpiCard from '@/components/cards/KpiCard'
import HeatmapMatrix from '@/components/charts/HeatmapMatrix'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { getPlatformColor, CHART_COLORS } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'
import CompCitationProfile from '@/components/competitive/CompCitationProfile'
import CompPMMComparison from '@/components/competitive/CompPMMComparison'
import CompSentimentVsClay from '@/components/competitive/CompSentimentVsClay'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}
const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const COMP_COLORS = ['#4A5AFF', '#E5362A', '#FF6B35', '#CC3D8A', '#3DAA6A']
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
      background: pos ? 'var(--clay-lime)' : '#FFE0DD',
      color: pos ? 'var(--clay-black)' : 'var(--clay-pomegranate)',
      borderRadius: '4px', padding: '1px 6px', fontSize: '11px', fontWeight: 700,
    }}>
      {pos ? '+' : ''}{delta.toFixed(1)}%
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
                const kpi = kpisMap[c] as unknown as Record<string, unknown> | undefined
                const val = kpi ? kpi[m.key] : null
                const delta = m.deltaKey && kpi ? kpi[m.deltaKey] as number | null : null
                return (
                  <td key={c} className="py-2.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                        {m.fmt(val)}
                      </span>
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
  const [loadingSentiment, setLoadingSentiment] = useState(true)

  // Competitor list + multi-select
  const [competitors, setCompetitors] = useState<string[]>([])
  const [selectedComps, setSelectedComps] = useState<string[]>([])
  const [showAllChips, setShowAllChips] = useState(false)
  // activeComp: which competitor is shown in drill-down sections (Citation, PMM, Sentiment)
  const [activeComp, setActiveComp] = useState<string>('')

  // Per-competitor KPIs
  const [kpisMap, setKpisMap] = useState<Record<string, AnyKPIs>>({})
  const [tsData, setTsData] = useState<{ date: string; [k: string]: string | number }[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [movers, setMovers] = useState<WinnerLoser[]>([])

  // Drill-down data for activeComp
  const [citations, setCitations] = useState<CitationFlatItem[]>([])
  const [pmmRows, setPmmRows] = useState<PMMCompRow[]>([])
  const [sentimentData, setSentimentData] = useState<SentimentVsClayData | null>(null)

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

  // Fast effect: KPIs + timeseries + heatmap + movers for all selectedComps
  useEffect(() => {
    if (selectedComps.length === 0) return
    setLoading(true)

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
            getCompetitorKPIs(supabase, f, comp).catch(() => null),
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

    // Build merged timeseries: Clay always present + each non-Clay competitor
    const buildTs = async () => {
      const clayTs = await getClayVisibilityTimeseries(supabase, f).catch(() => [])
      const nonClayComps = selectedComps.filter(c => c !== 'Clay')
      const dateSet = new Set<string>(clayTs.map(r => r.date))
      const compMap: Record<string, Record<string, number>> = {}

      await Promise.all(nonClayComps.map(async comp => {
        const rows = await getCompetitorVsClayTimeseries(supabase, f, comp).catch(() => [])
        compMap[comp] = {}
        for (const r of rows) {
          compMap[comp][r.date] = r.competitor
          dateSet.add(r.date)
        }
      }))

      const allDates = [...dateSet].sort()
      const clayDateMap = new Map(clayTs.map(r => [r.date, r.value]))
      return allDates.map(date => {
        const row: { date: string; [k: string]: string | number } = { date, Clay: clayDateMap.get(date) ?? 0 }
        for (const comp of nonClayComps) {
          row[comp] = compMap[comp]?.[date] ?? 0
        }
        return row
      })
    }

    Promise.all([
      Promise.all(kpiPromises),
      buildTs(),
      getPlatformHeatmap(supabase, f).catch(() => []),
      getWinnersAndLosers(supabase, f).catch(() => []),
    ]).then(([kpiResults, ts, heat, wl]) => {
      const newMap: Record<string, AnyKPIs> = {}
      for (const { comp, kpi } of kpiResults) {
        if (kpi) newMap[comp] = kpi
      }
      setKpisMap(newMap)
      setTsData(ts)
      setHeatmap(heat)
      setMovers(wl as WinnerLoser[])
      setLoading(false)
    }).catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, selectedComps.join(',')])

  // Slow effect: citation + PMM + sentiment for activeComp
  useEffect(() => {
    if (!activeComp) return
    setLoadingExtra(true)
    setLoadingSentiment(true)
    setCitPromptCache({})
    Promise.all([
      getCompetitorCitationsFlat(supabase, f, activeComp).catch(() => []),
      getCompetitorPMMComparison(supabase, f, activeComp).catch(() => []),
      getCompetitorSentimentVsClay(supabase, f, activeComp).catch(() => null),
    ]).then(([cit, pmm, sentiment]) => {
      setCitations(cit as CitationFlatItem[])
      setPmmRows(pmm as PMMCompRow[])
      setSentimentData(sentiment as SentimentVsClayData | null)
      setLoadingExtra(false)
      setLoadingSentiment(false)
    }).catch(() => {
      setLoadingExtra(false)
      setLoadingSentiment(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, activeComp])

  // Citation drill-down
  const handleLoadCitationPrompts = useCallback(async (url: string, responseIds: string[]) => {
    if (citPromptCache[url]) return
    setLoadingCitPrompts(url)
    const data = await getPromptsForCitation(supabase, responseIds)
    setCitPromptCache(prev => ({ ...prev, [url]: data as CitationPromptRow[] }))
    setLoadingCitPrompts(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citPromptCache])

  // PMM drill-down
  const handlePMMDrilldown = useCallback(async (pmmUseCase: string): Promise<PMMCompPromptRow[]> => {
    return getCompetitorPMMPromptDrilldown(supabase, f, activeComp, pmmUseCase) as Promise<PMMCompPromptRow[]>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeComp, f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join()])

  // Derived
  const isMulti = selectedComps.length > 1
  const nonClaySelected = selectedComps.filter(c => c !== 'Clay')
  const topCompetitors = [...movers].sort((a, b) => b.current - a.current).slice(0, 5)
  const biggestLosers = [...movers].filter(r => (r.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 5)
  const emerging = movers.filter(r => r.isNew)

  const heatmapComps = [...new Set(heatmap.map(d => d.competitor))].sort((a, b) => {
    const aS = heatmap.filter(d => d.competitor === a).reduce((s, r) => s + r.visibility_score, 0)
    const bS = heatmap.filter(d => d.competitor === b).reduce((s, r) => s + r.visibility_score, 0)
    return bS - aS
  })
  const limitedComps = showAllHeatmap ? heatmapComps : heatmapComps.slice(0, 50)
  const filteredHeatmap = heatmap.filter(d => limitedComps.includes(d.competitor))
  const visibleChips = showAllChips ? competitors : competitors.slice(0, CHIPS_LIMIT)

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
            {isMulti && (
              <span className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.45)' }}>
                {selectedComps.length} selected
              </span>
            )}
            {selectedComps.length >= MAX_SELECT && (
              <span className="text-[10px]" style={{ color: 'rgba(26,25,21,0.4)' }}>
                · max {MAX_SELECT}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleChips.map((comp) => {
              const isSelected = selectedComps.includes(comp)
              const isClay = comp === 'Clay'
              const nonClayIdx = nonClaySelected.indexOf(comp)
              const color = isClay ? null : (nonClayIdx >= 0 ? COMP_COLORS[nonClayIdx % COMP_COLORS.length] : null)
              const maxed = !isSelected && selectedComps.length >= MAX_SELECT
              const disabled = isSelected && selectedComps.length === 1
              return (
                <button
                  key={comp}
                  onClick={() => !disabled && !maxed && toggleComp(comp)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-all"
                  style={{
                    background: isSelected
                      ? (isClay ? 'var(--clay-lime)' : color ?? 'var(--clay-black)')
                      : 'rgba(26,25,21,0.06)',
                    color: isSelected
                      ? (isClay ? 'var(--clay-black)' : 'white')
                      : maxed ? 'rgba(26,25,21,0.25)' : 'rgba(26,25,21,0.6)',
                    border: isSelected
                      ? `1.5px solid ${isClay ? 'rgba(200,240,64,0.6)' : (color ?? 'var(--clay-black)')}`
                      : '1.5px solid transparent',
                    cursor: disabled || maxed ? 'not-allowed' : 'pointer',
                    opacity: maxed ? 0.5 : 1,
                  }}
                >
                  {comp}
                </button>
              )
            })}
            {competitors.length > CHIPS_LIMIT && (
              <button
                onClick={() => setShowAllChips(v => !v)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                style={{
                  background: 'rgba(26,25,21,0.03)',
                  color: 'rgba(26,25,21,0.4)',
                  border: '1.5px dashed rgba(26,25,21,0.15)',
                  cursor: 'pointer',
                }}
              >
                {showAllChips ? 'Show less ↑' : `+${competitors.length - CHIPS_LIMIT} more ↓`}
              </button>
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

      {/* Trend chart + static Top Competitors / Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Trend chart (2/3) */}
        <div style={CARD} className="p-4 lg:col-span-2">
          <div style={LABEL} className="mb-3">
            {isMulti
              ? `Visibility Over Time — ${selectedComps.join(' vs ')}`
              : selectedComps[0] === 'Clay'
                ? 'Clay Visibility — Trend Over Time'
                : `Clay vs. ${selectedComps[0]} — Visibility Over Time`}
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
                {(isMulti || nonClaySelected.length > 0) && (
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="Clay" stroke="var(--clay-black)" strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: 'var(--clay-black)' }} activeDot={{ r: 5 }} name="Clay" />
                {nonClaySelected.map((comp, i) => (
                  <Line key={comp} type="monotone" dataKey={comp}
                    stroke={COMP_COLORS[i % COMP_COLORS.length]}
                    strokeWidth={2} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} name={comp} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-48" style={{ color: 'rgba(26,25,21,0.35)', fontSize: '13px' }}>
              No trend data available
            </div>
          )}
        </div>

        {/* Static panel: Top Competitors + Biggest Losers + Emerging */}
        <div style={CARD} className="p-4 flex flex-col gap-0">
          <div style={LABEL} className="mb-2">Top Competitors</div>
          {loading ? <SkeletonCard /> : (
            <div className="mb-4">
              {topCompetitors.map((w, i) => (
                <div key={w.competitor_name} className="flex items-center gap-2 py-1.5"
                  style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                  <span style={{ color: 'rgba(26,25,21,0.3)', fontSize: '11px', fontWeight: 700, width: '16px' }}>{i + 1}</span>
                  <button
                    className="flex-1 text-left text-[13px] font-semibold truncate hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--clay-black)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    onClick={() => !selectedComps.includes(w.competitor_name) && selectedComps.length < MAX_SELECT && toggleComp(w.competitor_name)}
                    title={selectedComps.includes(w.competitor_name) ? 'Already in comparison' : 'Click to add to comparison'}
                  >
                    {w.competitor_name}
                    {w.isNew && (
                      <span className="ml-1.5" style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
                        New
                      </span>
                    )}
                    {selectedComps.includes(w.competitor_name) && (
                      <span className="ml-1.5" style={{ background: 'rgba(26,25,21,0.08)', color: 'rgba(26,25,21,0.45)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 700 }}>
                        ✓
                      </span>
                    )}
                  </button>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                    {w.current.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--clay-border)', paddingTop: '12px' }}>
            <div style={{ ...LABEL, color: 'var(--clay-pomegranate)' }} className="mb-2">Biggest Losers</div>
            {loading ? <SkeletonCard /> : biggestLosers.length === 0 ? (
              <p style={{ color: 'rgba(26,25,21,0.35)', fontSize: '12px' }}>No losses this period</p>
            ) : biggestLosers.map((w, i) => (
              <div key={w.competitor_name} className="flex items-center gap-2 py-1.5"
                style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                <span style={{ color: 'rgba(26,25,21,0.3)', fontSize: '11px', fontWeight: 700, width: '16px' }}>{i + 1}</span>
                <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: 'var(--clay-black)' }}>
                  {w.competitor_name}
                </span>
                <DeltaBadge delta={w.delta} />
              </div>
            ))}
          </div>

          {!loading && emerging.length > 0 && (
            <div style={{ borderTop: '1px solid var(--clay-border)', paddingTop: '12px', marginTop: '12px' }}>
              <div style={LABEL} className="mb-2">Emerging Threats</div>
              {emerging.slice(0, 4).map(w => (
                <div key={w.competitor_name} className="flex items-center gap-2 py-1.5"
                  style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                  <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: 'var(--clay-black)' }}>
                    {w.competitor_name}
                  </span>
                  <span style={{ color: 'rgba(26,25,21,0.55)', fontSize: '12px' }}>{w.current.toFixed(1)}%</span>
                  <span style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '3px', padding: '1px 5px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
                    New
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PMM Topic Comparison */}
      {loadingExtra ? (
        <div style={CARD} className="p-4">
          {drillTabs}
          <div style={LABEL} className="mb-3">Visibility by PMM Topic</div>
          <SkeletonChart />
        </div>
      ) : (
        <CompPMMComparison
          rows={pmmRows}
          selected={activeComp}
          onDrilldown={handlePMMDrilldown}
          headerSlot={drillTabs}
        />
      )}

      {/* Sentiment vs Clay */}
      <CompSentimentVsClay
        data={sentimentData}
        selected={activeComp}
        loading={loadingSentiment}
        headerSlot={drillTabs}
      />

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
