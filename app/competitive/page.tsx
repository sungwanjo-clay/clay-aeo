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
  getCompetitorCitationsByType,
  getPromptsForCitation,
  getCompetitorPMMComparison,
  getCompetitorPMMPromptDrilldown,
} from '@/lib/queries/competitive'
import type {
  CitationTypeGroup,
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

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}
const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }

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

export default function CompetitivePage() {
  const { toQueryParams } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [loadingExtra, setLoadingExtra] = useState(true)

  const [competitors, setCompetitors] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('Clay')

  const [kpis, setKpis] = useState<AnyKPIs | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [tsData, setTsData] = useState<{ date: string; [k: string]: string | number }[]>([])
  const [movers, setMovers] = useState<WinnerLoser[]>([])

  const [citGroups, setCitGroups] = useState<CitationTypeGroup[]>([])
  const [pmmRows, setPmmRows] = useState<PMMCompRow[]>([])

  // Citation drill-down state
  const [citPromptCache, setCitPromptCache] = useState<Record<string, CitationPromptRow[]>>({})
  const [loadingCitPrompts, setLoadingCitPrompts] = useState<string | null>(null)

  const [showAllHeatmap, setShowAllHeatmap] = useState(false)

  // Load competitor list once
  useEffect(() => {
    getCompetitorList(supabase).then(list => {
      setCompetitors(list)
      if (!list.includes('Clay') && list.length > 0) setSelected(list[0])
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isClay = selected === 'Clay'

  // Reset per-competitor caches on selection change
  useEffect(() => {
    setCitPromptCache({})
  }, [selected, f.startDate, f.endDate])

  // Effect 1: fast — KPIs, timeseries, movers, heatmap
  useEffect(() => {
    if (!selected) return
    setLoading(true)

    const kpiPromise = isClay
      ? getClayKPIs(supabase, f).then(r => ({
          visibilityScore: r.visibilityScore,
          deltaVisibility: r.deltaVisibility,
          citationRate: r.citationRate,
          deltaCitationRate: r.deltaCitationRate,
          mentionCount: r.mentionCount,
          avgPosition: r.avgPosition,
          topTopic: r.topTopic,
          topPlatform: r.topPlatform,
        }))
      : Promise.all([
          getCompetitorKPIs(supabase, f, selected),
          getCompetitorCitationRate(supabase, f, selected),
        ]).then(([k, cit]) => ({
          visibilityScore: k.visibilityScore,
          deltaVisibility: k.deltaVisibility,
          citationRate: cit.rate,
          deltaCitationRate: cit.deltaRate,
          mentionCount: k.mentionCount,
          avgPosition: k.avgPosition ?? null,
          topTopic: k.topTopic,
          topPlatform: k.topPlatform,
        }))

    const tsPromise = isClay
      ? getClayVisibilityTimeseries(supabase, f).then(rows =>
          rows.map(r => ({ date: r.date, Clay: r.value }))
        )
      : getCompetitorVsClayTimeseries(supabase, f, selected).then(rows =>
          rows.map(r => ({ date: r.date, Clay: r.clay, [selected]: r.competitor }))
        )

    Promise.all([
      kpiPromise,
      tsPromise,
      getPlatformHeatmap(supabase, f),
      getWinnersAndLosers(supabase, f),
    ]).then(([k, ts, heat, wl]) => {
      setKpis(k)
      setTsData(ts)
      setHeatmap(heat)
      setMovers(wl as WinnerLoser[])
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, selected])

  // Effect 2: slow — citation profile, PMM comparison
  useEffect(() => {
    if (!selected) return
    setLoadingExtra(true)
    Promise.all([
      getCompetitorCitationsByType(supabase, f, selected),
      getCompetitorPMMComparison(supabase, f, selected),
    ]).then(([cit, pmm]) => {
      setCitGroups(cit as CitationTypeGroup[])
      setPmmRows(pmm as PMMCompRow[])
      setLoadingExtra(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, selected])

  // Citation drill-down: load prompts for a given URL's response_ids
  const handleLoadCitationPrompts = useCallback(async (url: string, responseIds: string[]) => {
    if (citPromptCache[url]) return
    setLoadingCitPrompts(url)
    const data = await getPromptsForCitation(supabase, responseIds)
    setCitPromptCache(prev => ({ ...prev, [url]: data as CitationPromptRow[] }))
    setLoadingCitPrompts(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citPromptCache, f.startDate, f.endDate])

  // PMM drill-down
  const handlePMMDrilldown = useCallback(async (pmmUseCase: string): Promise<PMMCompPromptRow[]> => {
    return getCompetitorPMMPromptDrilldown(supabase, f, selected, pmmUseCase) as Promise<PMMCompPromptRow[]>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join()])

  // Static top-5 and losers (always global)
  const topCompetitors = [...movers].sort((a, b) => b.current - a.current).slice(0, 5)
  const biggestLosers = [...movers].filter(r => (r.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 5)
  const emerging = movers.filter(r => r.isNew)

  // Heatmap top-50
  const heatmapComps = [...new Set(heatmap.map(d => d.competitor))].sort((a, b) => {
    const aS = heatmap.filter(d => d.competitor === a).reduce((s, r) => s + r.visibility_score, 0)
    const bS = heatmap.filter(d => d.competitor === b).reduce((s, r) => s + r.visibility_score, 0)
    return bS - aS
  })
  const limitedComps = showAllHeatmap ? heatmapComps : heatmapComps.slice(0, 50)
  const filteredHeatmap = heatmap.filter(d => limitedComps.includes(d.competitor))

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">

      {/* Header + selector */}
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>
          Competitive Intelligence
        </h1>
        <p className="text-sm" style={{ color: 'rgba(26,25,21,0.55)' }}>
          AI visibility benchmarks across domains, topics, and platforms.
        </p>
        <div className="flex items-center gap-3 mt-1">
          <span style={LABEL}>Analyzing Domain:</span>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{
              border: '1px solid var(--clay-border)',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--clay-black)',
              background: '#FFFFFF',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {competitors.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* 5 KPI tiles */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : kpis ? (
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
          {kpis.avgPosition != null ? (
            <KpiCard label="Avg Position" value={`#${kpis.avgPosition.toFixed(1)}`}
              delta={null} deltaLabel={selected} />
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
      ) : null}

      {/* Trend chart + static Top Competitors / Movers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Trend chart (2/3) */}
        <div style={CARD} className="p-4 lg:col-span-2">
          <div style={LABEL} className="mb-3">
            {isClay ? 'Clay Visibility — Trend Over Time' : `Clay vs. ${selected} — Visibility Over Time`}
          </div>
          {loading ? <SkeletonChart /> : tsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={tsData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
                <XAxis dataKey="date" tickFormatter={(v: any) => formatShortDate(v)}
                  tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.45)' }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: any) => `${v}%`}
                  tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.45)' }} tickLine={false} axisLine={false} />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Tooltip formatter={(val: any, name: any) => [`${Number(val).toFixed(1)}%`, name]}
                  contentStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', border: '1px solid var(--clay-border)', borderRadius: '8px' }} />
                {!isClay && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
                <Line type="monotone" dataKey="Clay" stroke="var(--clay-black)" strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: 'var(--clay-black)' }} activeDot={{ r: 5 }} />
                {!isClay && (
                  <Line type="monotone" dataKey={selected} stroke="#4A5AFF" strokeWidth={2}
                    dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                )}
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
                  <span className="flex-1 text-[13px] font-semibold truncate" style={{ color: 'var(--clay-black)' }}>
                    {w.competitor_name}
                    {w.isNew && (
                      <span className="ml-1.5" style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '3px', padding: '1px 4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' }}>
                        New
                      </span>
                    )}
                  </span>
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

      {/* Citation Profile — ABOVE PMM topics */}
      {loadingExtra ? (
        <div style={CARD} className="p-4">
          <div style={LABEL} className="mb-3">Citation Profile — {selected}</div>
          <SkeletonChart />
        </div>
      ) : (
        <CompCitationProfile
          groups={citGroups}
          selected={selected}
          onLoadPrompts={handleLoadCitationPrompts}
          promptCache={citPromptCache}
          loadingPrompts={loadingCitPrompts}
        />
      )}

      {/* PMM Topic Comparison — competitor vs Clay */}
      {loadingExtra ? (
        <div style={CARD} className="p-4">
          <div style={LABEL} className="mb-3">Visibility by PMM Topic</div>
          <SkeletonChart />
        </div>
      ) : (
        <CompPMMComparison
          rows={pmmRows}
          selected={selected}
          onDrilldown={handlePMMDrilldown}
        />
      )}

      {/* Co-cited domains (competitors only) */}
      {!isClay && !loadingExtra && (
        <div style={CARD} className="p-4">
          <div style={LABEL} className="mb-1">Domains Co-cited Alongside {selected}</div>
          <p className="text-xs" style={{ color: 'rgba(26,25,21,0.45)' }}>
            These domains appear in the same AI responses that mention {selected} — indicating shared authority in the space.
          </p>
        </div>
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
