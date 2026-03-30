'use client'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import React, { useState, useEffect } from 'react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import {
  getCitationShare,
  getCitationCount,
  getCitationOverallTimeseries,
  getCompetitorCitationTimeseries,
  getClayURLsByType,
  getTopCitedDomainsEnhanced,
  getCitationGaps,
} from '@/lib/queries/citations'
import type { ClayURLTypeGroup, TopDomainRow } from '@/lib/queries/citations'
import KpiCard from '@/components/cards/KpiCard'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { getCitationTypeColor, getPlatformColor, CHART_COLORS } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'
import { ChevronDown, ChevronRight, ExternalLink, Info } from 'lucide-react'
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

// ── URL type colour palette ────────────────────────────────────────────────────
const URL_TYPE_COLORS: Record<string, string> = {
  'Blog Post':        '#4A5AFF',
  'Documentation':    '#3DAA6A',
  'Landing Page':     '#FF6B35',
  'Case Study':       '#CC3D8A',
  'Integration Page': '#3DB8CC',
  'Product Page':     '#F5C518',
  'Guide':            '#C8F040',
  'Other':            '#9CA3AF',
}
function urlTypeColor(t: string): string {
  return URL_TYPE_COLORS[t] ?? CHART_COLORS[Object.keys(URL_TYPE_COLORS).length % CHART_COLORS.length]
}

// ── Info tooltip ──────────────────────────────────────────────────────────────
function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block ml-1.5"
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <Info size={12} style={{ color: 'rgba(26,25,21,0.35)', verticalAlign: 'middle', cursor: 'help' }} />
      {show && (
        <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-64 rounded-lg px-3 py-2 text-[11px] leading-relaxed font-medium shadow-lg pointer-events-none"
          style={{ background: 'var(--clay-black)', color: 'white', whiteSpace: 'normal' }}>
          {text}
        </span>
      )}
    </span>
  )
}

// ── Horizontal share bar ──────────────────────────────────────────────────────
function ShareBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height: '5px', background: 'rgba(26,25,21,0.07)' }}>
      <div style={{ width: `${Math.min(pct, 100)}%`, background: color, height: '100%', transition: 'width 0.4s' }} />
    </div>
  )
}

// ── Citation Share chart with competitor toggle ───────────────────────────────
function CitationShareChart({
  clayTs,
  competitorTs,
}: {
  clayTs: { date: string; value: number }[]
  competitorTs: { date: string; domain: string; value: number }[]
}) {
  const [showComp, setShowComp] = useState(false)

  // Build top 5 competitors by total
  const totals = new Map<string, number>()
  for (const r of competitorTs) totals.set(r.domain, (totals.get(r.domain) ?? 0) + r.value)
  const top5 = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([d]) => d)

  // Merge into chart rows
  const allDates = [...new Set([...clayTs.map(r => r.date), ...competitorTs.map(r => r.date)])].sort()
  const clayMap = new Map(clayTs.map(r => [r.date, r.value]))
  const compMap = new Map(competitorTs.map(r => [`${r.date}|||${r.domain}`, r.value]))

  const chartData = allDates.map(date => {
    const row: Record<string, string | number> = { date, Clay: clayMap.get(date) ?? 0 }
    if (showComp) for (const d of top5) row[d] = compMap.get(`${date}|||${d}`) ?? 0
    return row
  })

  return (
    <div style={CARD} className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <span style={LABEL}>Citation Share Over Time</span>
          <InfoTooltip text="% of AI responses that cite clay.com. Toggle to compare against top cited competing domains." />
        </div>
        {competitorTs.length > 0 && (
          <button
            onClick={() => setShowComp(v => !v)}
            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors"
            style={{
              background: showComp ? 'var(--clay-black)' : 'rgba(26,25,21,0.06)',
              color: showComp ? 'white' : 'rgba(26,25,21,0.55)',
            }}
          >
            {showComp ? 'Hide competitors' : 'Show top 5 competitors'}
          </button>
        )}
      </div>

      {chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height={showComp ? 210 : 180}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
            <XAxis dataKey="date" tickFormatter={(v: any) => formatShortDate(v)}
              tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v: any) => `${Number(v).toFixed(0)}%`}
              tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(val: any, name: any) => [`${Number(val).toFixed(1)}%`, name]}
              labelFormatter={(l: any) => formatShortDate(String(l))}
              contentStyle={{ fontSize: 11, border: '1px solid var(--clay-border)', borderRadius: '8px' }}
            />
            {showComp && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />}
            <Line type="monotone" dataKey="Clay" stroke="var(--clay-black)" strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 0, fill: 'var(--clay-black)' }} activeDot={{ r: 5 }} name="Clay" />
            {showComp && top5.map((d, i) => (
              <Line key={d} type="monotone" dataKey={d}
                stroke={COMP_COLORS[i % COMP_COLORS.length]}
                strokeWidth={1.8} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} name={d} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center py-12" style={{ color: 'rgba(26,25,21,0.35)', fontSize: '13px' }}>
          Not enough data points
        </div>
      )}
    </div>
  )
}

// ── Clay citations by URL type ────────────────────────────────────────────────
function ClayURLTypeRow({ group, totalCitations }: { group: ClayURLTypeGroup; totalCitations: number }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const color = urlTypeColor(group.url_type)
  const visible = showAll ? group.urls : group.urls.slice(0, 8)

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
      {/* Group header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        onClick={() => setOpen(v => !v)}
        style={{ borderBottom: open ? '1px solid rgba(26,25,21,0.07)' : 'none' }}
      >
        <div className="shrink-0">
          {open
            ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />
            : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />}
        </div>

        {/* Type badge + name */}
        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0"
          style={{ background: `${color}18`, color, border: `1px solid ${color}35` }}>
          {group.url_type}
        </span>

        {/* Share bar */}
        <div className="flex-1 min-w-0 hidden sm:block">
          <ShareBar pct={group.share_pct} color={color} />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 shrink-0 text-right">
          <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
            {group.share_pct.toFixed(1)}%
          </span>
          <span className="text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
            {group.total.toLocaleString()} <span className="text-[10px] font-medium" style={{ color: 'rgba(26,25,21,0.4)' }}>citations</span>
          </span>
          <span className="text-[11px] tabular-nums" style={{ color: 'rgba(26,25,21,0.4)' }}>
            {group.urls.length} URLs
          </span>
        </div>
      </div>

      {/* URL list */}
      {open && (
        <div style={{ background: 'rgba(26,25,21,0.01)' }}>
          {/* Sub-header */}
          <div className="grid gap-2 px-4 py-1.5"
            style={{ gridTemplateColumns: '1fr 80px 80px 100px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
            {['Content / URL', 'Times Cited', 'Topics', 'Platforms'].map((h, i) => (
              <span key={h} className={i > 0 ? 'text-right' : ''} style={{ ...LABEL, fontSize: '9px' }}>{h}</span>
            ))}
          </div>

          {visible.map(item => (
            <div key={item.url} className="grid gap-2 px-4 py-2.5 hover:bg-[rgba(26,25,21,0.02)] items-start"
              style={{ gridTemplateColumns: '1fr 80px 80px 100px', borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
              {/* URL + title */}
              <div className="min-w-0">
                {item.title && (
                  <p className="text-[12px] font-semibold mb-0.5 leading-tight" style={{ color: 'var(--clay-black)' }}>
                    {item.title}
                  </p>
                )}
                <a href={item.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 group">
                  <ExternalLink size={9} className="opacity-40 group-hover:opacity-70 shrink-0" />
                  <span className="text-[10px] truncate group-hover:underline max-w-xs"
                    style={{ color: 'rgba(26,25,21,0.45)' }}>
                    {item.url}
                  </span>
                </a>
              </div>
              {/* Count */}
              <span className="text-right text-[13px] font-bold tabular-nums pt-0.5" style={{ color: 'var(--clay-black)' }}>
                {item.count.toLocaleString()}
              </span>
              {/* Topics */}
              <div className="flex flex-wrap gap-1 justify-end">
                {item.topics.slice(0, 2).map(t => (
                  <span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(74,90,255,0.08)', color: '#4A5AFF' }}>
                    {t}
                  </span>
                ))}
                {item.topics.length > 2 && (
                  <span className="text-[9px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>
                    +{item.topics.length - 2}
                  </span>
                )}
              </div>
              {/* Platforms */}
              <div className="flex flex-wrap gap-1 justify-end">
                {item.platforms.map(p => (
                  <span key={p} className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: getPlatformColor(p) + '20', color: getPlatformColor(p) }}>
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {group.urls.length > 8 && (
            <button
              onClick={e => { e.stopPropagation(); setShowAll(v => !v) }}
              className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
              style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)' }}
            >
              {showAll ? 'Show top 8 ↑' : `Show all ${group.urls.length} URLs ↓`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Top cited domains (all) with url_type drill-down ──────────────────────────
function TopDomainRow({ row, rank }: { row: TopDomainRow; rank: number }) {
  const [open, setOpen] = useState(false)
  const typeColor = row.citation_type ? getCitationTypeColor(row.citation_type) : 'rgba(26,25,21,0.35)'

  // Group urls by url_type
  const byType = new Map<string, typeof row.top_urls>()
  for (const u of row.top_urls) {
    const t = u.url_type ?? 'Other'
    if (!byType.has(t)) byType.set(t, [])
    byType.get(t)!.push(u)
  }

  return (
    <React.Fragment>
      <tr
        onClick={() => row.top_urls.length > 0 && setOpen(v => !v)}
        className={`transition-colors ${row.top_urls.length > 0 ? 'cursor-pointer hover:bg-[rgba(26,25,21,0.02)]' : ''}`}
        style={{
          borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.06)',
          background: row.is_clay ? 'rgba(200,240,64,0.05)' : 'transparent',
        }}
      >
        <td className="py-2.5 px-4 text-[12px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.3)', width: '36px' }}>
          {rank}
        </td>
        <td className="py-2.5 pr-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>{row.domain}</span>
            {row.is_clay && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(200,240,64,0.25)', color: 'var(--clay-black)' }}>
                Clay ✓
              </span>
            )}
            {row.citation_type && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: `${typeColor}18`, color: typeColor, border: `1px solid ${typeColor}30` }}>
                {row.citation_type}
              </span>
            )}
          </div>
        </td>
        <td className="py-2.5 px-3 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {row.citation_count.toLocaleString()}
        </td>
        <td className="py-2.5 px-3 text-right text-[12px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.55)' }}>
          {row.share_pct.toFixed(1)}%
        </td>
        <td className="py-2.5 px-2 text-center" style={{ width: '28px' }}>
          {row.top_urls.length > 0 && (
            open
              ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.4)' }} />
              : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.4)' }} />
          )}
        </td>
      </tr>

      {open && row.top_urls.length > 0 && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
          <td colSpan={5} style={{ padding: '4px 12px 12px 40px' }}>
            <div className="space-y-2">
              {Array.from(byType.entries()).map(([urlType, urls]) => {
                const uc = urlTypeColor(urlType)
                return (
                  <div key={urlType} className="rounded-lg overflow-hidden"
                    style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
                    {/* URL type sub-header */}
                    <div className="flex items-center gap-2 px-3 py-1.5"
                      style={{ background: `${uc}10`, borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: `${uc}20`, color: uc, border: `1px solid ${uc}35` }}>
                        {urlType}
                      </span>
                      <span className="text-[10px]" style={{ color: 'rgba(26,25,21,0.4)' }}>
                        {urls.length} URL{urls.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {/* URLs */}
                    {urls.map(u => (
                      <div key={u.url} className="flex items-start gap-3 px-3 py-2 hover:bg-[rgba(26,25,21,0.02)]"
                        style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
                        <div className="flex-1 min-w-0">
                          {u.title && (
                            <p className="text-[12px] font-semibold mb-0.5 leading-tight" style={{ color: 'var(--clay-black)' }}>
                              {u.title}
                            </p>
                          )}
                          <a href={u.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 group" onClick={e => e.stopPropagation()}>
                            <ExternalLink size={9} className="opacity-40 group-hover:opacity-70 shrink-0" />
                            <span className="text-[10px] truncate group-hover:underline max-w-xs"
                              style={{ color: 'rgba(26,25,21,0.45)' }}>{u.url}</span>
                          </a>
                          {u.topics.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {u.topics.slice(0, 3).map(t => (
                                <span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                                  style={{ background: 'rgba(74,90,255,0.08)', color: '#4A5AFF' }}>
                                  {t}
                                </span>
                              ))}
                              {u.topics.length > 3 && (
                                <span className="text-[9px]" style={{ color: 'rgba(26,25,21,0.35)' }}>+{u.topics.length - 3} topics</span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="text-[12px] font-bold tabular-nums shrink-0 pt-0.5"
                          style={{ color: 'var(--clay-black)' }}>
                          {u.count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CitationsPage() {
  const { toQueryParams } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [loadingExtra, setLoadingExtra] = useState(true)

  const [citShare, setCitShare] = useState<{ current: number | null; previous: number | null } | null>(null)
  const [citCount, setCitCount] = useState<{ current: number; previous: number } | null>(null)
  const [clayTs, setClayTs] = useState<{ date: string; value: number }[]>([])
  const [competitorTs, setCompetitorTs] = useState<{ date: string; domain: string; value: number }[]>([])
  const [clayUrlTypes, setClayUrlTypes] = useState<ClayURLTypeGroup[]>([])
  const [topDomains, setTopDomains] = useState<TopDomainRow[]>([])
  const [gaps, setGaps] = useState<{ domain: string; topic: string; prompt_count: number; pct_of_topic: number }[]>([])
  const [domainSearch, setDomainSearch] = useState('')

  // Fast: KPIs + chart
  useEffect(() => {
    setLoading(true)
    Promise.all([
      getCitationShare(supabase, f).catch(() => null),
      getCitationCount(supabase, f).catch(() => null),
      getCitationOverallTimeseries(supabase, f).catch(() => []),
    ]).then(([share, count, ts]) => {
      if (share) setCitShare(share)
      if (count) setCitCount(count)
      setClayTs(ts ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter])

  // Slow: competitor ts + clay url types + top domains + gaps (each isolated)
  useEffect(() => {
    setLoadingExtra(true)
    Promise.all([
      getCompetitorCitationTimeseries(supabase, f, 5).catch(() => []),
      getClayURLsByType(supabase, f).catch(() => []),
      getTopCitedDomainsEnhanced(supabase, f).catch(() => []),
      getCitationGaps(supabase, f).catch(() => []),
    ]).then(([compTs, urlTypes, domains, gapData]) => {
      setCompetitorTs(compTs ?? [])
      setClayUrlTypes(urlTypes ?? [])
      setTopDomains(domains ?? [])
      setGaps(gapData ?? [])
      setLoadingExtra(false)
    }).catch(() => setLoadingExtra(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter])

  const citDelta = (citShare?.current != null && citShare?.previous != null)
    ? citShare.current - citShare.previous : null
  const countDelta = (citCount != null && citCount.previous > 0)
    ? citCount.current - citCount.previous : null

  const totalClayCitations = clayUrlTypes.reduce((s, g) => s + g.total, 0)
  const filteredDomains = domainSearch
    ? topDomains.filter(d => d.domain.toLowerCase().includes(domainSearch.toLowerCase()))
    : topDomains
  const clayDomainRank = topDomains.findIndex(d => d.is_clay) + 1

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>
          Citations
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'rgba(26,25,21,0.55)' }}>
          What content is being cited by AI, what type, and where are the gaps?
        </p>
      </div>

      {/* KPI tiles */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <KpiCard label="Citation Share"
            value={citShare?.current != null ? `${citShare.current.toFixed(1)}%` : '—'}
            delta={citDelta} deltaLabel="vs prev period" />
          <KpiCard label="Citation Count"
            value={citCount?.current != null ? citCount.current.toLocaleString() : '—'}
            delta={countDelta} deltaLabel="responses w/ citation" />
          <KpiCard label="Clay Domain Rank"
            value={clayDomainRank > 0 ? `#${clayDomainRank}` : '—'}
            delta={null} deltaLabel="among all cited domains" />
          <KpiCard label="Clay URL Types"
            value={clayUrlTypes.length > 0 ? clayUrlTypes.length.toString() : '—'}
            delta={null} deltaLabel="content categories cited" />
          <KpiCard label="Clay Citations"
            value={totalClayCitations > 0 ? totalClayCitations.toLocaleString() : '—'}
            delta={null} deltaLabel="total clay.com citations" />
        </div>
      )}

      {/* Citation Share chart */}
      {loading ? (
        <div style={CARD} className="p-4">
          <div style={LABEL} className="mb-3">Citation Share Over Time</div>
          <SkeletonChart />
        </div>
      ) : (
        <CitationShareChart
          clayTs={clayTs}
          competitorTs={competitorTs}
        />
      )}

      {/* Clay Citations by Content Type */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">Clay Citations by Content Type</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Which types of Clay content AI cites most. Expand a type to see individual URLs, the topics they appear in, and which platforms cite them.
        </p>
        {loadingExtra ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.05)' }} />
            ))}
          </div>
        ) : clayUrlTypes.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            No Clay citation data in this period
          </div>
        ) : (
          <div className="space-y-2">
            {clayUrlTypes.map(group => (
              <ClayURLTypeRow key={group.url_type} group={group} totalCitations={totalClayCitations} />
            ))}
          </div>
        )}
      </div>

      {/* Top Cited Domains */}
      <div style={CARD} className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div style={LABEL} className="mb-0.5">Top Cited Domains</div>
            <p className="text-xs" style={{ color: 'rgba(26,25,21,0.45)' }}>
              All domains cited by AI across the prompt set. Expand a domain to see URLs grouped by content type.
            </p>
          </div>
          <input
            type="text"
            value={domainSearch}
            onChange={e => setDomainSearch(e.target.value)}
            placeholder="Search domain…"
            className="text-[12px] px-2.5 py-1.5 rounded-lg outline-none"
            style={{
              border: '1px solid var(--clay-border)',
              background: 'rgba(26,25,21,0.02)',
              color: 'var(--clay-black)',
              width: '160px',
            }}
          />
        </div>

        {loadingExtra ? (
          <SkeletonChart />
        ) : filteredDomains.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            {topDomains.length === 0 ? 'No domain citation data' : 'No domains match your search'}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
                <th className="pb-2 px-4 text-left" style={{ ...LABEL, width: '36px' }}>#</th>
                <th className="pb-2 pr-3 text-left" style={LABEL}>Domain</th>
                <th className="pb-2 px-3 text-right" style={LABEL}>Citations</th>
                <th className="pb-2 px-3 text-right" style={LABEL}>Share</th>
                <th style={{ width: '28px' }} />
              </tr>
            </thead>
            <tbody>
              {filteredDomains.map((row, i) => (
                <TopDomainRow key={row.domain} row={row} rank={i + 1} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Citation Gap Analysis */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">Citation Gap Analysis</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Competitor domains cited by AI when Clay isn&apos;t mentioned — topics where rival content ranks but Clay doesn&apos;t appear.
        </p>
        {loadingExtra ? (
          <SkeletonChart />
        ) : gaps.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>No gap data found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
                <th className="pb-2 px-4 text-left" style={LABEL}>Competitor Domain</th>
                <th className="pb-2 px-3 text-left" style={LABEL}>Topic</th>
                <th className="pb-2 px-3 text-right" style={LABEL}>Prompts</th>
                <th className="pb-2 px-3 text-right" style={LABEL}>% of Topic</th>
              </tr>
            </thead>
            <tbody>
              {gaps.slice(0, 25).map((g, i) => (
                <tr key={`${g.domain}-${g.topic}-${i}`}
                  style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                  <td className="py-2.5 px-4">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--clay-pomegranate)' }}>{g.domain}</span>
                  </td>
                  <td className="py-2.5 px-3 text-[12px]" style={{ color: 'var(--clay-black)' }}>{g.topic}</td>
                  <td className="py-2.5 px-3 text-right text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                    {g.prompt_count}
                  </td>
                  <td className="py-2.5 px-3 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.55)' }}>
                    {g.pct_of_topic.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
