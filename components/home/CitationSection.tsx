'use client'

import React, { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatShortDate } from '@/lib/utils/formatters'
import { ChevronDown, ChevronRight, ExternalLink, Info } from 'lucide-react'
import { getCitationTypeColor } from '@/lib/utils/colors'
import DomainIcon from '@/components/shared/DomainIcon'

interface CitationTimepoint { date: string; value: number }
interface DomainRow {
  domain: string
  citation_count: number
  share_pct: number
  is_clay: boolean
  citation_type: string | null
  top_urls: { url: string; title: string | null; count: number }[]
}

interface Props {
  timeseries: CitationTimepoint[]
  domains: DomainRow[]
  competitorTimeseries?: { date: string; domain: string; value: number }[]
}

const cardStyle = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const labelStyle = { color: 'rgba(26,25,21,0.45)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }

const CITATION_INFO = '% of AI responses that include a link or reference to clay.com. Toggle "Show competitors" to compare against the top cited competing domains.'

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block ml-1.5"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
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

function buildChartData(
  timeseries: CitationTimepoint[],
  competitorTs: { date: string; domain: string; value: number }[],
  showCompetitors: boolean
) {
  const dates = [...new Set([
    ...timeseries.map(r => r.date),
    ...(showCompetitors ? competitorTs.map(r => r.date) : []),
  ])].sort()

  const domainTotals = new Map<string, number>()
  if (showCompetitors) {
    for (const r of competitorTs) {
      domainTotals.set(r.domain, (domainTotals.get(r.domain) ?? 0) + r.value)
    }
  }
  const topDomains = [...domainTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d)

  const clayLookup = new Map(timeseries.map(r => [r.date, r.value]))
  const compLookup = new Map(competitorTs.map(r => [`${r.date}|||${r.domain}`, r.value]))

  return {
    competitorDomains: topDomains,
    data: dates.map(date => {
      const row: Record<string, string | number> = { date, Clay: clayLookup.get(date) ?? 0 }
      if (showCompetitors) {
        for (const d of topDomains) {
          row[d] = compLookup.get(`${date}|||${d}`) ?? 0
        }
      }
      return row
    }),
  }
}

const COMPETITOR_COLORS = ['#4A5AFF', '#E5362A', '#FF6B35', '#CC3D8A', '#3DAA6A']

export default function CitationSection({ timeseries, domains, competitorTimeseries = [] }: Props) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [showCompetitors, setShowCompetitors] = useState(false)
  const [search, setSearch] = useState('')

  const { competitorDomains, data: chartData } = buildChartData(timeseries, competitorTimeseries, showCompetitors)

  const filteredDomains = search
    ? domains.filter(d => d.domain.toLowerCase().includes(search.toLowerCase()))
    : domains
  const visibleDomains = showAll ? filteredDomains : filteredDomains.slice(0, 8)

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="p-5" style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <h2 style={labelStyle}>Citation Share Over Time</h2>
            <InfoTooltip text={CITATION_INFO} />
          </div>
          {competitorTimeseries.length > 0 && (
            <button
              onClick={() => setShowCompetitors(v => !v)}
              className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors"
              style={{
                background: showCompetitors ? 'var(--clay-black)' : 'rgba(26,25,21,0.06)',
                color: showCompetitors ? 'white' : 'rgba(26,25,21,0.55)',
              }}
            >
              {showCompetitors ? 'Hide competitors' : 'Show competitors'}
            </button>
          )}
        </div>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={showCompetitors ? 200 : 180}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
              <XAxis dataKey="date" tickFormatter={formatShortDate}
                tick={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
                tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `${Number(v).toFixed(0)}%`}
                tick={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
                tickLine={false} axisLine={false} width={36} domain={[0, 'auto']} />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any, name: any) => [`${Number(val).toFixed(1)}%`, name]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(l: any) => formatShortDate(String(l))}
                contentStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', border: '1px solid var(--clay-border-dashed)', borderRadius: '8px' }}
              />
              {showCompetitors && (
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }} />
              )}
              <Line type="monotone" dataKey="Clay" stroke="var(--clay-black)" strokeWidth={2.5}
                dot={{ r: 3, strokeWidth: 0, fill: 'var(--clay-black)' }} activeDot={{ r: 5 }} name="Clay" />
              {showCompetitors && competitorDomains.map((d, i) => (
                <Line key={d} type="monotone" dataKey={d}
                  stroke={COMPETITOR_COLORS[i % COMPETITOR_COLORS.length]}
                  strokeWidth={1.8} dot={{ r: 2, strokeWidth: 0 }} activeDot={{ r: 4 }} name={d} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : chartData.length === 1 ? (
          <div className="py-8 text-center">
            <p className="text-2xl font-bold" style={{ color: 'var(--clay-black)' }}>
              {(chartData[0].Clay as number).toFixed(1)}%
            </p>
            <p style={{ ...labelStyle, marginTop: '4px' }}>Only 1 data point — run again tomorrow to see a trend</p>
          </div>
        ) : (
          <p className="py-8 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No citation data</p>
        )}
      </div>

      {/* Domain table */}
      <div className="p-5" style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={labelStyle}>Top Cited Domains</h2>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setShowAll(false) }}
            placeholder="Search domain…"
            className="text-[12px] px-2.5 py-1 rounded-lg outline-none"
            style={{
              border: '1px solid var(--clay-border-dashed)',
              background: 'rgba(26,25,21,0.02)',
              color: 'var(--clay-black)',
              width: '160px',
            }}
          />
        </div>
        {filteredDomains.length === 0 ? (
          <p className="py-6 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>
            {domains.length === 0 ? 'No citation domain data' : 'No domains match your search'}
          </p>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--clay-border-dashed)' }}>
                  <th className="pb-2 text-left" style={{ ...labelStyle, width: '28px' }}>#</th>
                  <th className="pb-2 text-left" style={labelStyle}>Domain</th>
                  <th className="pb-2 text-right" style={labelStyle}>Citations</th>
                  <th className="pb-2 text-right" style={labelStyle}>Share</th>
                  <th className="pb-2" style={{ width: '24px' }} />
                </tr>
              </thead>
              <tbody>
                {visibleDomains.map((row, idx) => (
                  <React.Fragment key={row.domain}>
                    <tr
                      onClick={() => setExpandedDomain(expandedDomain === row.domain ? null : row.domain)}
                      className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
                      style={{
                        borderBottom: expandedDomain === row.domain ? 'none' : '1px solid rgba(26,25,21,0.05)',
                        background: row.is_clay ? 'rgba(200,240,64,0.06)' : 'transparent',
                      }}
                    >
                      <td className="py-2.5 text-[12px] font-bold" style={{ color: 'rgba(26,25,21,0.3)' }}>{idx + 1}</td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <DomainIcon domain={row.domain} size={16} />
                          <span className="text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>{row.domain}</span>
                          {row.citation_type && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                              style={{
                                background: getCitationTypeColor(row.citation_type) + '20',
                                color: getCitationTypeColor(row.citation_type),
                                border: `1px solid ${getCitationTypeColor(row.citation_type)}40`,
                              }}>
                              {row.citation_type}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                        {row.citation_count.toLocaleString()}
                      </td>
                      <td className="py-2.5 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                        {row.share_pct.toFixed(1)}%
                      </td>
                      <td className="py-2.5 text-center">
                        {row.top_urls.length > 0 && (
                          expandedDomain === row.domain
                            ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />
                            : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />
                        )}
                      </td>
                    </tr>
                    {expandedDomain === row.domain && row.top_urls.length > 0 && (
                      <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                        <td colSpan={5} style={{ paddingBottom: '8px' }}>
                          <div className="ml-6 rounded-lg overflow-hidden" style={{ background: 'rgba(26,25,21,0.02)', border: '1px solid rgba(26,25,21,0.06)' }}>
                            <table className="w-full">
                              <thead>
                                <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
                                  <th className="px-3 py-1.5 text-left" style={{ ...labelStyle, fontSize: '9px' }}>URL</th>
                                  <th className="px-3 py-1.5 text-right" style={{ ...labelStyle, fontSize: '9px' }}>Count</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.top_urls.map(u => (
                                  <tr key={u.url} style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
                                    <td className="px-3 py-2">
                                      <a href={u.url} target="_blank" rel="noopener noreferrer"
                                        className="flex items-start gap-1.5 group"
                                        onClick={e => e.stopPropagation()}>
                                        <ExternalLink size={10} className="mt-0.5 shrink-0 opacity-40 group-hover:opacity-70" />
                                        <div>
                                          {u.title && (
                                            <p className="text-[12px] font-semibold group-hover:underline" style={{ color: 'var(--clay-black)' }}>
                                              {u.title}
                                            </p>
                                          )}
                                          <p className="text-[10px] truncate max-w-md" style={{ color: 'rgba(26,25,21,0.45)' }}>{u.url}</p>
                                        </div>
                                      </a>
                                    </td>
                                    <td className="px-3 py-2 text-right text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                                      {u.count}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {filteredDomains.length > 8 && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="mt-3 w-full py-2 text-[11px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                style={{ border: '1px solid var(--clay-border-dashed)', borderRadius: '6px', color: 'rgba(26,25,21,0.5)' }}
              >
                {showAll ? 'Show less ↑' : `Show all ${filteredDomains.length} domains`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
