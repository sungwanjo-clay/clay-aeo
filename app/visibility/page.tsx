'use client'

import { useEffect, useState } from 'react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import {
  getVisibilityScore, getVisibilityByTopic,
  getShareOfVoice, getAvgPosition, getMentionShare,
  getCompetitorVisibilityTimeseries, getFullLeaderboard,
  getVisibilityByPMM, getPMMTable, getClayOverallTimeseries,
} from '@/lib/queries/visibility'
import type { TimeseriesRow, CompetitorRow } from '@/lib/queries/types'
import KpiCard from '@/components/cards/KpiCard'
import VisibilityLineChart from '@/components/charts/VisibilityLineChart'
import CompetitorComparisonChart from '@/components/charts/CompetitorComparisonChart'
import SOVDonutChart from '@/components/charts/SOVDonutChart'
import CompetitorLeaderboard from '@/components/tables/CompetitorLeaderboard'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer } from 'recharts'
import { CHART_COLORS } from '@/lib/utils/colors'

interface PMMRow {
  pmm_use_case: string
  visibility_score: number
  delta: number | null
  total_responses: number
  timeseries: { date: string; value: number }[]
}

export default function VisibilityPage() {
  const { filters, toQueryParams } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [visibility, setVisibility] = useState<{ current: number | null; previous: number | null } | null>(null)
  const [mentionShare, setMentionShare] = useState<number | null>(null)
  const [avgPos, setAvgPos] = useState<{ current: number | null; previous: number | null } | null>(null)
  const [clayTimeseries, setClayTimeseries] = useState<{ date: string; value: number }[]>([])
  const [topicSeries, setTopicSeries] = useState<TimeseriesRow[]>([])
  const [sov, setSov] = useState<CompetitorRow[]>([])
  const [leaderboard, setLeaderboard] = useState<CompetitorRow[]>([])
  const [competitorTimeseries, setCompetitorTimeseries] = useState<{ date: string; competitor: string; value: number }[]>([])
  const [showCompetitors, setShowCompetitors] = useState(false)
  const [pmmSeries, setPmmSeries] = useState<TimeseriesRow[]>([])
  const [pmmTable, setPmmTable] = useState<PMMRow[]>([])
  const [pmmView, setPmmView] = useState<'chart' | 'table'>('chart')
  const [pmmSort, setPmmSort] = useState<'visibility_score' | 'total_responses' | 'delta'>('visibility_score')
  const [pmmSortDir, setPmmSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getVisibilityScore(supabase, f),
      getMentionShare(supabase, f),
      getAvgPosition(supabase, f),
      getClayOverallTimeseries(supabase, f),
      getVisibilityByTopic(supabase, f),
      getShareOfVoice(supabase, f),
      getFullLeaderboard(supabase, f),
      getVisibilityByPMM(supabase, f),
      getPMMTable(supabase, f),
    ]).then(([vis, ms, pos, clayTs, topicTs, sovData, lb, pmmTs, pmmTbl]) => {
      setVisibility(vis)
      setMentionShare(ms)
      setAvgPos(pos)
      setClayTimeseries(clayTs)
      setTopicSeries(topicTs)
      setSov(sovData)
      setLeaderboard(lb)
      setPmmSeries(pmmTs)
      setPmmTable(pmmTbl)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.tags, f.platforms.join(), f.topics.join(), f.brandedFilter])

  // Load competitor timeseries when toggle turned on
  useEffect(() => {
    if (!showCompetitors) { setCompetitorTimeseries([]); return }
    getCompetitorVisibilityTimeseries(supabase, f).then(setCompetitorTimeseries)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompetitors, f.startDate, f.endDate])

  const visDelta = (visibility?.current != null && visibility?.previous != null)
    ? visibility.current - visibility.previous : null
  const posDelta = (avgPos?.current != null && avgPos?.previous != null)
    ? avgPos.current - avgPos.previous : null

  const chartCompetitorData = showCompetitors ? competitorTimeseries : []

  // PMM table sorting
  const sortedPmmTable = [...pmmTable].sort((a, b) => {
    const aVal = a[pmmSort] ?? -Infinity
    const bVal = b[pmmSort] ?? -Infinity
    return pmmSortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
  })

  function toggleSort(col: 'visibility_score' | 'total_responses' | 'delta') {
    if (pmmSort === col) {
      setPmmSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setPmmSort(col)
      setPmmSortDir('desc')
    }
  }

  const cardStyle = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
  const sectionLabel = 'text-[10px] font-bold uppercase tracking-wider mb-3'
  const sectionLabelColor = { color: 'rgba(26,25,21,0.45)' }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-extrabold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>Visibility</h1>
        <p className="text-[11px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: 'rgba(26,25,21,0.45)' }}>How often is Clay appearing in AI responses?</p>
      </div>

      {/* KPI row */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Visibility Score" value={visibility?.current != null ? `${visibility.current.toFixed(1)}%` : '—'} delta={visDelta} />
          <KpiCard label="Mention Share" value={mentionShare != null ? `${mentionShare.toFixed(1)}%` : '—'} delta={null} deltaLabel="of competitor mentions" />
          <KpiCard label="Share of Voice" value={sov.find(r => r.competitor_name.toLowerCase() === 'clay')?.sov_pct != null ? `${sov.find(r => r.competitor_name.toLowerCase() === 'clay')!.sov_pct.toFixed(1)}%` : '—'} delta={null} deltaLabel="of all mentions" />
          <KpiCard label="Avg Position" value={avgPos?.current != null ? `#${avgPos.current.toFixed(1)}` : '—'} delta={posDelta} invertDelta />
        </div>
      )}

      {/* Visibility trend chart */}
      <div className="p-5" style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={sectionLabel} style={sectionLabelColor}>Visibility Score over Time</h2>
          <button
            onClick={() => setShowCompetitors(v => !v)}
            className="text-[11px] font-bold px-3 py-1.5 transition-all"
            style={{
              borderRadius: '99px',
              background: showCompetitors ? 'var(--clay-black)' : '#fff',
              color: showCompetitors ? '#fff' : 'var(--clay-black)',
              border: '1px solid var(--clay-border-dashed)',
            }}
          >
            {showCompetitors ? '✓ Competitors On' : 'Compare Competitors'}
          </button>
        </div>
        {loading ? <SkeletonChart /> : (
          <CompetitorComparisonChart
            clayData={clayTimeseries}
            competitorData={chartCompetitorData}
            height={280}
          />
        )}
      </div>

      {/* Competitor Leaderboard */}
      <div className="p-5" style={cardStyle}>
        <h2 className={sectionLabel} style={sectionLabelColor}>Competitor Leaderboard</h2>
        {loading ? <SkeletonChart /> : (
          <CompetitorLeaderboard data={leaderboard} compareEnabled={filters.compareEnabled} />
        )}
      </div>

      {/* Visibility by Topic */}
      <div className="p-5" style={cardStyle}>
        <h2 className={sectionLabel} style={sectionLabelColor}>Visibility by Topic</h2>
        {loading ? <SkeletonChart /> : (
          <VisibilityLineChart data={topicSeries} groupKey="topic" height={240} />
        )}
      </div>

      {/* Share of Voice */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="p-5" style={cardStyle}>
          <h2 className={sectionLabel} style={sectionLabelColor}>Share of Voice</h2>
          {loading ? <SkeletonChart /> : <SOVDonutChart data={sov} height={200} />}
        </div>
        <div className="lg:col-span-2 p-5" style={cardStyle}>
          <h2 className={sectionLabel} style={sectionLabelColor}>By Platform & Topic</h2>
          {loading ? <SkeletonChart /> : (
            <VisibilityLineChart data={topicSeries} groupKey="topic" height={200} />
          )}
        </div>
      </div>

      {/* PMM Solution Performance */}
      <div className="p-5" style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={sectionLabel} style={sectionLabelColor}>Visibility by PMM Solution</h2>
          <div className="flex gap-1">
            {(['chart', 'table'] as const).map(v => (
              <button
                key={v}
                onClick={() => setPmmView(v)}
                className="text-[11px] font-bold px-3 py-1.5 capitalize transition-all"
                style={{
                  borderRadius: '99px',
                  background: pmmView === v ? 'var(--clay-black)' : '#fff',
                  color: pmmView === v ? '#fff' : 'var(--clay-black)',
                  border: '1px solid var(--clay-border-dashed)',
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {loading ? <SkeletonChart /> : pmmView === 'chart' ? (
          pmmSeries.length > 0 ? (
            <VisibilityLineChart data={pmmSeries} groupKey="pmm_use_case" height={280} />
          ) : (
            <p className="text-[12px] font-semibold py-8 text-center" style={{ color: 'rgba(26,25,21,0.35)' }}>No PMM use case data</p>
          )
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--clay-border-dashed)' }}>
                <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)' }}>PMM Solution</th>
                <th
                  className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:opacity-60"
                  style={{ color: pmmSort === 'visibility_score' ? 'var(--clay-black)' : 'rgba(26,25,21,0.4)' }}
                  onClick={() => toggleSort('visibility_score')}
                >
                  Visibility {pmmSort === 'visibility_score' ? (pmmSortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
                <th className="pb-2 text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)' }}>Trend</th>
                {filters.compareEnabled && (
                  <th
                    className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:opacity-60"
                    style={{ color: pmmSort === 'delta' ? 'var(--clay-black)' : 'rgba(26,25,21,0.4)' }}
                    onClick={() => toggleSort('delta')}
                  >
                    vs Prev {pmmSort === 'delta' ? (pmmSortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                )}
                <th
                  className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider cursor-pointer hover:opacity-60"
                  style={{ color: pmmSort === 'total_responses' ? 'var(--clay-black)' : 'rgba(26,25,21,0.4)' }}
                  onClick={() => toggleSort('total_responses')}
                >
                  Responses {pmmSort === 'total_responses' ? (pmmSortDir === 'desc' ? '↓' : '↑') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedPmmTable.map((row, i) => {
                const isUp = row.delta != null ? row.delta > 0 : null
                return (
                  <tr key={row.pmm_use_case} style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                    <td className="py-2.5 font-semibold" style={{ color: 'var(--clay-black)' }}>{row.pmm_use_case}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>{row.visibility_score.toFixed(1)}%</td>
                    <td className="py-2.5 text-center" style={{ width: '80px' }}>
                      <ResponsiveContainer width={80} height={28}>
                        <LineChart data={row.timeseries}>
                          <Line type="monotone" dataKey="value" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </td>
                    {filters.compareEnabled && (
                      <td className="py-2.5 text-right">
                        {row.delta != null ? (
                          <span
                            className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5"
                            style={{
                              borderRadius: '4px',
                              background: isUp ? 'var(--clay-lime)' : '#FFE0DD',
                              color: isUp ? 'var(--clay-black)' : 'var(--clay-pomegranate)',
                            }}
                          >
                            {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                            {isUp ? '+' : ''}{row.delta.toFixed(1)}%
                          </span>
                        ) : <span style={{ color: 'rgba(26,25,21,0.3)', fontSize: '11px' }}>—</span>}
                      </td>
                    )}
                    <td className="py-2.5 text-right font-semibold tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>{row.total_responses.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
