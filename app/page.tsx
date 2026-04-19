'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import { getLatestInsight, getActiveAnomalies } from '@/lib/queries/home'
import { getVisibilityKpis, getDataFreshnessStats, getClayOverallTimeseries, getCompetitorLeaderboard, getCompetitorVisibilityTimeseries, getVisibilityByPMM, getPMMTable, getClaygentTimeseries, getFollowupTimeseries, getPMMPromptDrilldown } from '@/lib/queries/visibility'
import { getSentimentBreakdown } from '@/lib/queries/sentiment'
import { getCitationShare, getCitationOverallTimeseries, getTopCitedDomainsWithURLs, getCompetitorCitationTimeseries, getSidebarCitedDomains } from '@/lib/queries/citations'
import type { InsightRow, AnomalyRow, CompetitorRow } from '@/lib/queries/types'
import InsightCard from '@/components/cards/InsightCard'
import AnomalyAlert from '@/components/cards/AnomalyAlert'
import KpiCard from '@/components/cards/KpiCard'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { formatDate, formatShortDate } from '@/lib/utils/formatters'
import { generateDateRange } from '@/lib/utils/dateRange'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LineChart, Line, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { Info } from 'lucide-react'
import { CHART_COLORS } from '@/lib/utils/colors'
import CitationSection from '@/components/home/CitationSection'
import PMMTopicsSection from '@/components/home/PMMTopicsSection'
import ClaygentSection from '@/components/home/ClaygentSection'
import CompetitorIcon from '@/components/shared/CompetitorIcon'

export default function HomePage() {
  const { filters, toQueryParams } = useGlobalFilters()

  // Stable reference — only changes when filter values actually change
  const f = useMemo(() => toQueryParams(), [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    filters.dateRange.start.toISOString(),
    filters.dateRange.end.toISOString(),
    filters.promptType,
    filters.platform,
    filters.brandedFilter,
    filters.tags,
    filters.topics.join(','),
  ])

  // ── Tier 1: KPI cards (fast RPCs, renders first) ─────────
  const [loading, setLoading] = useState(true)
  const [loadingInsight, setLoadingInsight] = useState(true)
  const [insight, setInsight] = useState<InsightRow | null>(null)
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([])
  const [visibility, setVisibility] = useState<{ current: number | null; previous: number | null; total: number } | null>(null)
  const [sentiment, setSentiment] = useState<{ positive: number | null } | null>(null)
  const [citationRate, setCitationRate] = useState<{ current: number | null; previous: number | null } | null>(null)
  const [claygentCount, setClaygentCount] = useState<{ current: number; previous: number } | null>(null)
  const [avgPos, setAvgPos] = useState<{ current: number | null; previous: number | null } | null>(null)
  const [freshness, setFreshness] = useState<{ lastRunDate: string | null; promptCount: number; platformCount: number } | null>(null)

  // ── Tier 2: Charts (heavier, renders after KPIs) ──────────
  const [loadingCharts, setLoadingCharts] = useState(true)
  const [competitors, setCompetitors] = useState<CompetitorRow[]>([])
  const [sparkData, setSparkData] = useState<{ date: string; value: number }[]>([])
  const [competitorVisTimeseries, setCompetitorVisTimeseries] = useState<{ date: string; competitor: string; value: number }[]>([])
  const [showVisCompetitors, setShowVisCompetitors] = useState(true)

  // ── Tier 3a: Charts/tables (fast RPCs) ───────────────────
  const [loadingExtra, setLoadingExtra] = useState(true)
  const [citationTimeseries, setCitationTimeseries] = useState<{ date: string; value: number }[]>([])
  const [competitorCitTimeseries, setCompetitorCitTimeseries] = useState<{ date: string; domain: string; value: number }[]>([])
  const [citedDomains, setCitedDomains] = useState<{ domain: string; citation_count: number; share_pct: number; is_clay: boolean; citation_type: string | null; top_urls: { url: string; title: string | null; count: number }[] }[]>([])
  const [sidebarDomains, setSidebarDomains] = useState<{ domain: string; share_pct: number; is_clay: boolean; citation_type: string | null }[]>([])
  const [pmmSeries, setPmmSeries] = useState<{ date: string; value: number; pmm_use_case?: string }[]>([])
  const [pmmTable, setPmmTable] = useState<{ pmm_use_case: string; pmm_classification: string | null; visibility_score: number; delta: number | null; citation_share: number | null; avg_position: number | null; total_responses: number; timeseries: { date: string; value: number }[] }[]>([])
  const [claygentTimeseries, setClaygentTimeseries] = useState<{ date: string; count: number }[]>([])
  const [followupTimeseries, setFollowupTimeseries] = useState<{ date: string; count: number }[]>([])

  // Tier 1: KPI numbers — one RPC call covers visibility + avg pos + claygent
  useEffect(() => {
    setLoading(true)
    setLoadingInsight(true)
    Promise.all([
      getVisibilityKpis(supabase, f),   // single RPC → all 3 KPIs
      getCitationShare(supabase, f),
      getSentimentBreakdown(supabase, f),
      getLatestInsight(supabase),
      getActiveAnomalies(supabase),
      getDataFreshnessStats(supabase),
    ]).then(async ([kpis, citRate, sent, ins, ano, fresh]) => {
      setVisibility(kpis.visibility)
      setAvgPos(kpis.avgPosition)
      setClaygentCount(kpis.claygentCount)
      setCitationRate(citRate)
      setSentiment({ positive: sent.positive })
      setAnomalies(ano)
      setFreshness(fresh)
      // KPIs are ready — unblock the page immediately
      setLoading(false)

      // Insight: show cached value right away, then generate in background if stale
      const today = new Date().toISOString().split('T')[0]
      const cached = ins as InsightRow | null
      if (cached) setInsight(cached)
      if (!cached || cached.run_date?.substring(0, 10) !== today) {
        try {
          const res = await fetch('/api/generate-insight', { method: 'POST' })
          const json = await res.json()
          if (json.ok && json.insight) setInsight(json.insight)
        } catch { /* silent */ }
      }
      setLoadingInsight(false)
    }).catch(err => {
      console.error('[page] KPI Promise.all failed:', err)
      setLoading(false)
      setLoadingInsight(false)
    })
  }, [f])

  // Tier 2: Visibility + competitor charts (heavier)
  useEffect(() => {
    setLoadingCharts(true)
    Promise.all([
      getCompetitorLeaderboard(supabase, f),
      getClayOverallTimeseries(supabase, f),
      getCompetitorVisibilityTimeseries(supabase, f),
    ]).then(([comp, spark, compVisTs]) => {
      setCompetitors((comp as CompetitorRow[]).slice(0, 6))
      setSparkData(spark)
      setCompetitorVisTimeseries(compVisTs)
      setLoadingCharts(false)
    }).catch(err => {
      console.error('[page] charts Promise.all failed:', err)
      setLoadingCharts(false)
    })
  }, [f])

  // Tier 3a: Fast RPC-backed sections — renders charts immediately
  useEffect(() => {
    setLoadingExtra(true)
    getSidebarCitedDomains(supabase, f).then(setSidebarDomains).catch(() => {})

    Promise.all([
      getCitationOverallTimeseries(supabase, f),
      getTopCitedDomainsWithURLs(supabase, f),
      getCompetitorCitationTimeseries(supabase, f),
    ]).then(([citTs, citDom, compCitTs]) => {
      setCitationTimeseries(citTs)
      setCitedDomains(citDom)
      setCompetitorCitTimeseries(compCitTs)
    }).catch(err => console.error('[page] Tier3a-A failed:', err))

    Promise.all([
      getVisibilityByPMM(supabase, f),
      getPMMTable(supabase, f),
      getClaygentTimeseries(supabase, f),
      getFollowupTimeseries(supabase, f),
    ]).then(([pmmTs, pmmTbl, claygentTs, followupTs]) => {
      setPmmSeries(pmmTs)
      setPmmTable(pmmTbl)
      setClaygentTimeseries(claygentTs)
      setFollowupTimeseries(followupTs)
      setLoadingExtra(false)
    }).catch(err => {
      console.error('[page] Tier3a-B failed:', err)
      setLoadingExtra(false)
    })
  }, [f])


  const handlePMMDrilldown = useCallback(async (pmmUseCase: string, pmmClassification: string | null) => {
    return getPMMPromptDrilldown(supabase, f, pmmUseCase, pmmClassification)
  }, [f])

  function visDelta() {
    if (!visibility?.current || !visibility?.previous) return null
    return visibility.current - visibility.previous
  }
  function posDelta() {
    if (!avgPos?.current || !avgPos?.previous) return null
    return avgPos.current - avgPos.previous
  }

  // Build visibility trend chart data (Clay + top-5 from leaderboard)
  // Use leaderboard order (not timeseries totals) so chart matches the table
  // and avoids competitors with inconsistent naming across days
  const topVisComps = competitors
    .filter(c => c.competitor_name !== 'Clay')
    .slice(0, 5)
    .map(c => c.competitor_name)
  const sparkLookup = new Map(sparkData.map(r => [r.date, r.value]))
  const visCompLookup = new Map(competitorVisTimeseries.map(r => [`${r.date}|||${r.competitor}`, r.value]))

  // Span the full filter date range — dates without data simply omit the key,
  // which Recharts renders as a gap rather than a flat zero.
  const visChartDates = generateDateRange(f.startDate.split('T')[0], f.endDate.split('T')[0])
  const visChartData = visChartDates.map(date => {
    const row: Record<string, string | number> = { date }
    if (sparkLookup.has(date)) row['Clay'] = sparkLookup.get(date)!
    for (const c of topVisComps) {
      const key = `${date}|||${c}`
      if (visCompLookup.has(key)) row[c] = visCompLookup.get(key)!
    }
    return row
  })
  // Dynamic Y-axis max: headroom above actual data, capped at 100
  const visAllVals = visChartData.flatMap(r => Object.entries(r).filter(([k]) => k !== 'date').map(([, v]) => Number(v)))
  const visYMax = Math.min(100, Math.ceil(Math.max(...visAllVals, 1) * 1.2 / 5) * 5)

  // Always include Clay in the top-6 table. If not naturally in top 6, pin it at #6.
  const allWithClay = (() => {
    const hasClay = competitors.some(c => c.competitor_name === 'Clay')
    const list = hasClay
      ? competitors
      : [...competitors, { competitor_name: 'Clay', mention_count: 0, sov_pct: visibility?.current ?? 0, visibility_score: visibility?.current ?? 0, delta: visDelta(), isOwned: true }]
    return list
      .map(row => ({
        ...row,
        _displayScore: row.competitor_name === 'Clay' && visibility?.current != null
          ? visibility.current
          : (row.visibility_score ?? row.sov_pct ?? 0),
      }))
      .sort((a, b) => b._displayScore - a._displayScore)
  })()
  const clayNaturalRank = allWithClay.findIndex(c => c.competitor_name === 'Clay')
  const sortedCompetitors = clayNaturalRank < 6
    ? allWithClay.slice(0, 6)
    : [...allWithClay.filter(c => c.competitor_name !== 'Clay').slice(0, 5), allWithClay[clayNaturalRank]]

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>Good morning</h1>
          <p className="text-xs font-bold uppercase tracking-wider mt-0.5" style={{ color: 'rgba(26,25,21,0.45)' }}>Here&apos;s what happened with Clay&apos;s AI visibility</p>
        </div>
      </div>

      {/* Insight */}
      <InsightCard insight={insight} loading={loadingInsight} />

      {/* Anomaly alerts */}
      <div>
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'rgba(26,25,21,0.45)' }}>Alerts</h2>
        <AnomalyAlert
          anomalies={anomalies}
          onDismiss={id => setAnomalies(prev => prev.filter(a => a.id !== id))}
        />
      </div>

      {/* KPI row */}
      <div>
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'rgba(26,25,21,0.45)' }}>Key Metrics</h2>
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard
              label="Visibility Score"
              value={visibility?.current != null ? `${visibility.current.toFixed(1)}%` : '—'}
              delta={visDelta()}
              deltaLabel="vs prev period"
            />
            <KpiCard
              label="Citation Rate"
              value={citationRate?.current != null ? `${citationRate.current.toFixed(1)}%` : '—'}
              delta={citationRate?.current != null && citationRate?.previous != null ? citationRate.current - citationRate.previous : null}
              deltaLabel="vs prev period"
            />
            <KpiCard
              label="Avg Position"
              value={avgPos?.current != null ? `#${avgPos.current.toFixed(1)}` : '—'}
              delta={posDelta()}
              deltaLabel="vs prev period"
              invertDelta
            />
            <KpiCard
              label="Positive Sentiment"
              value={sentiment?.positive != null ? `${sentiment.positive.toFixed(1)}%` : '—'}
              delta={null}
              deltaLabel="of Clay mentions"
            />
            <KpiCard
              label="ClayMCP & Agent"
              value={claygentCount?.current != null ? claygentCount.current.toLocaleString() : '—'}
              delta={claygentCount?.current != null && claygentCount?.previous != null ? claygentCount.current - claygentCount.previous : null}
              deltaLabel="vs prev period"
              deltaIsCount
            />
            <KpiCard
              label="Total Prompts"
              value={visibility?.total != null ? visibility.total.toLocaleString() : '—'}
              delta={null}
              deltaLabel="in period"
            />
          </div>
        )}
      </div>

      {/* Sparkline + top competitor */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 p-4" style={{ background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center">
              <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.45)' }}>Visibility Score Trend</h3>
              <span className="group relative ml-1.5 inline-block">
                <Info size={12} style={{ color: 'rgba(26,25,21,0.35)', cursor: 'help', verticalAlign: 'middle' }} />
                <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-60 rounded-lg px-3 py-2 text-[11px] leading-relaxed font-medium shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'var(--clay-black)', color: 'white', whiteSpace: 'normal' }}>
                  % of AI responses that mention Clay by name, across all prompts and platforms.
                </span>
              </span>
            </div>
            {!loadingCharts && competitorVisTimeseries.length > 0 && (
              <button
                onClick={() => setShowVisCompetitors(v => !v)}
                className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors"
                style={{
                  background: showVisCompetitors ? 'var(--clay-black)' : 'rgba(26,25,21,0.06)',
                  color: showVisCompetitors ? 'white' : 'rgba(26,25,21,0.55)',
                }}
              >
                {showVisCompetitors ? 'Hide competitors' : 'Show competitors'}
              </button>
            )}
          </div>
          {loadingCharts ? (
            <SkeletonChart />
          ) : visAllVals.length > 0 ? (
            <ResponsiveContainer width="100%" height={showVisCompetitors ? 180 : 110}>
              <LineChart data={visChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatShortDate}
                  tick={{ fontSize: 10, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={v => `${Number(v).toFixed(0)}%`}
                  tick={{ fontSize: 10, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  domain={[0, visYMax]}
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(val: any, name: any) => [`${Number(val).toFixed(1)}%`, name]}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  labelFormatter={(l: any) => formatShortDate(String(l))}
                  contentStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', border: '1px solid var(--clay-border-dashed)', borderRadius: '8px' }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }} />
                <Line type="monotone" dataKey="Clay" stroke="var(--clay-black)" strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: 'var(--clay-black)' }} activeDot={{ r: 5 }} name="Clay"
                  connectNulls={false} />
                {showVisCompetitors && topVisComps.map((c, i) => (
                  <Line key={c} type="monotone" dataKey={c}
                    stroke={CHART_COLORS[(i + 2) % CHART_COLORS.length]}
                    strokeWidth={1.8} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} name={c}
                    connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs font-bold py-6 text-center" style={{ color: 'rgba(26,25,21,0.35)' }}>No trend data yet</p>
          )}
        </div>

        <div className="p-4" style={{ background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }}>
          <h3 className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'rgba(26,25,21,0.45)' }}>Top Mentioned Competitors</h3>
          {loadingCharts ? (
            <SkeletonCard />
          ) : competitors.length > 0 ? (
            <table className="w-full">
              <tbody>
                {sortedCompetitors.map((row, idx) => {
                  const isClay = row.competitor_name === 'Clay'
                  const score = row._displayScore
                  const delta = isClay ? visDelta() : (row.delta ?? null)
                  return (
                    <tr key={row.competitor_name} style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                      <td className="py-1.5 text-[11px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.3)', width: '20px' }}>{idx + 1}</td>
                      <td className="py-1.5 text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
                        <span className="flex items-center gap-1.5">
                          <CompetitorIcon name={row.competitor_name} size={16} />
                          {row.competitor_name}
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                        {score.toFixed(1)}%
                      </td>
                      <td className="py-1.5 pl-2 text-right" style={{ width: '60px' }}>
                        {delta != null && (
                          <span className="text-[10px] font-bold tabular-nums"
                            style={{ color: delta > 0 ? 'var(--clay-positive-text)' : delta < 0 ? 'var(--clay-pomegranate)' : 'rgba(26,25,21,0.4)' }}>
                            {delta > 0 ? '↑' : delta < 0 ? '↓' : '—'}{Math.abs(delta).toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-xs font-bold" style={{ color: 'rgba(26,25,21,0.35)' }}>No competitor data</p>
          )}
        </div>
      </div>

      {/* Citations */}
      <div>
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'rgba(26,25,21,0.45)' }}>Citations</h2>
        {loadingExtra ? <div className="space-y-4"><SkeletonChart /><SkeletonChart /></div> : (
          <CitationSection timeseries={citationTimeseries} domains={citedDomains} sidebarDomains={sidebarDomains} competitorTimeseries={competitorCitTimeseries} citationRateKPI={citationRate?.current ?? null} startDate={f.startDate.split('T')[0]} endDate={f.endDate.split('T')[0]} />
        )}
      </div>

      {/* Topic Visibility */}
      <div>
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'rgba(26,25,21,0.45)' }}>Topic Visibility</h2>
        {loadingExtra ? <div className="space-y-4"><SkeletonChart /><SkeletonChart /></div> : (
          <PMMTopicsSection series={pmmSeries} table={pmmTable} compareEnabled={filters.compareEnabled} onDrilldown={handlePMMDrilldown} startDate={f.startDate.split('T')[0]} endDate={f.endDate.split('T')[0]} />
        )}
      </div>

      {/* ClayMCP & Agent */}
      <div>
        <h2 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'rgba(26,25,21,0.45)' }}>ClayMCP & Agent</h2>
        {loadingExtra ? <SkeletonChart /> : (
          <ClaygentSection
            claygentData={claygentTimeseries}
            followupData={followupTimeseries}
            startDate={f.startDate.split('T')[0]}
            endDate={f.endDate.split('T')[0]}
          />
        )}
      </div>

      {/* Data freshness */}
      {freshness && (
        <div className="text-[10px] font-bold uppercase tracking-wider pt-4" style={{ borderTop: '1px solid var(--clay-border)', color: 'rgba(26,25,21,0.35)' }}>
          Last ingestion: {freshness.lastRunDate ? formatDate(freshness.lastRunDate) : '—'} —{' '}
          {freshness.promptCount} prompts × {freshness.platformCount} platform{freshness.platformCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
