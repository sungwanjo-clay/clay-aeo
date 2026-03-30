'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatShortDate } from '@/lib/utils/formatters'
import { CHART_COLORS } from '@/lib/utils/colors'
import type { PMMPromptDrillRow, PMMPromptResponseRow } from '@/lib/queries/visibility'

interface TimeseriesRow { date: string; value: number; pmm_use_case?: string }
interface PMMRow {
  pmm_use_case: string
  visibility_score: number
  delta: number | null
  citation_share: number | null
  avg_position: number | null
  total_responses: number
  timeseries: { date: string; value: number }[]
}

interface Props {
  series: TimeseriesRow[]
  table: PMMRow[]
  compareEnabled: boolean
  onDrilldown: (pmmUseCase: string) => Promise<PMMPromptDrillRow[]>
}

const cardStyle = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const labelStyle = { color: 'rgba(26,25,21,0.45)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }

/** Strip common markdown syntax so raw LLM output displays cleanly */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold**
    .replace(/\*([^*]+)\*/g, '$1')        // *italic*
    .replace(/`([^`]+)`/g, '$1')          // `code`
    .replace(/#+\s+/g, '')                // ## headings
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url)
    .replace(/^\s*[-*>]\s+/gm, '')        // list bullets / blockquotes
    .replace(/\|\s*/g, ' ')               // table pipes
    .replace(/\s{2,}/g, ' ')             // collapse extra whitespace
    .trim()
}

function buildChartData(series: TimeseriesRow[]) {
  const groups = [...new Set(series.map(r => r.pmm_use_case).filter(Boolean))]
  const dates = [...new Set(series.map(r => r.date))].sort()
  const lookup = new Map(series.map(r => [`${r.date}|||${r.pmm_use_case}`, r.value]))
  return { groups, chartData: dates.map(date => {
    const row: Record<string, string | number> = { date }
    for (const g of groups) row[g!] = lookup.get(`${date}|||${g}`) ?? 0
    return row
  })}
}

// ── Full response expandable block ─────────────────────────────────────────
function FullResponseBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const cleaned = stripMarkdown(text)
  const preview = cleaned.slice(0, 180)
  const hasMore = cleaned.length > 180

  return (
    <div className="rounded-lg px-3 py-2.5" style={{ background: 'rgba(26,25,21,0.03)', border: '1px solid rgba(26,25,21,0.07)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,25,21,0.45)' }}>Full AI Response</p>
      <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(26,25,21,0.75)' }}>
        {open ? cleaned : preview}{!open && hasMore ? '…' : ''}
      </p>
      {hasMore && (
        <button
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          className="mt-1.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
          style={{ color: 'rgba(26,25,21,0.45)' }}
        >
          {open ? 'Show less ↑' : 'Show full response ↓'}
        </button>
      )}
    </div>
  )
}

// ── Per-response detail row ────────────────────────────────────────────────
function ResponseRow({ r, defaultOpen = false }: { r: PMMPromptResponseRow; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const mentioned = r.clay_mentioned === 'Yes'

  return (
    <div
      style={{ borderBottom: '1px solid rgba(26,25,21,0.04)', background: open ? 'rgba(26,25,21,0.015)' : 'transparent' }}
    >
      {/* Summary row */}
      <div
        className="grid items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)]"
        style={{ gridTemplateColumns: '80px 70px 56px 56px 56px 1fr 16px' }}
        onClick={() => setOpen(v => !v)}
      >
        {/* Platform badge */}
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-block text-center"
          style={{
            background: r.platform === 'ChatGPT' ? 'rgba(61,170,106,0.12)' : 'rgba(204,61,138,0.12)',
            color: r.platform === 'ChatGPT' ? '#3DAA6A' : '#CC3D8A',
          }}>
          {r.platform}
        </span>

        {/* Date */}
        <span className="text-[11px] tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>
          {r.run_date}
        </span>

        {/* Mentioned */}
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-center"
          style={{
            background: mentioned ? 'rgba(200,240,64,0.25)' : 'rgba(229,54,42,0.08)',
            color: mentioned ? 'var(--clay-black)' : 'var(--clay-pomegranate)',
          }}>
          {mentioned ? 'Yes' : 'No'}
        </span>

        {/* Position */}
        <span className="text-[12px] font-bold tabular-nums text-center" style={{ color: 'var(--clay-black)' }}>
          {r.clay_mention_position != null ? `#${r.clay_mention_position}` : '—'}
        </span>

        {/* Cited */}
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-center"
          style={{
            background: r.clay_cited ? 'rgba(200,240,64,0.25)' : 'rgba(26,25,21,0.06)',
            color: r.clay_cited ? 'var(--clay-black)' : 'rgba(26,25,21,0.4)',
          }}>
          {r.clay_cited ? 'Cited' : '—'}
        </span>

        {/* Other domains (inline pill list) */}
        <div className="flex flex-wrap gap-1">
          {r.other_cited_domains.slice(0, 3).map(d => (
            <span key={d} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.55)' }}>
              {d}
            </span>
          ))}
          {r.other_cited_domains.length > 3 && (
            <span className="text-[9px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>
              +{r.other_cited_domains.length - 3}
            </span>
          )}
        </div>

        {/* Expand toggle */}
        <div>
          {(r.clay_mention_snippet || r.response_text) ? (
            open
              ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.35)' }} />
              : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.35)' }} />
          ) : null}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {/* Snippet */}
          {r.clay_mention_snippet && (
            <div className="rounded-lg px-3 py-2.5" style={{ background: 'rgba(200,240,64,0.1)', border: '1px solid rgba(200,240,64,0.3)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>Clay mention snippet</p>
              <p className="text-[12px] font-semibold leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                &ldquo;{stripMarkdown(r.clay_mention_snippet)}&rdquo;
              </p>
            </div>
          )}

          {/* Full response — expandable */}
          {r.response_text && (
            <FullResponseBlock text={r.response_text} />
          )}

          {/* Co-cited domains */}
          {r.other_cited_domains.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>
                All cited domains alongside Clay
              </p>
              <div className="flex flex-wrap gap-1">
                {r.other_cited_domains.map(d => (
                  <span key={d} className="text-[11px] font-semibold px-2 py-0.5 rounded"
                    style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.6)' }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Per-prompt block ───────────────────────────────────────────────────────
function PromptBlock({ p, colSpan }: { p: PMMPromptDrillRow; colSpan: number }) {
  const [open, setOpen] = useState(false)

  return (
    <React.Fragment>
      <tr
        onClick={() => setOpen(v => !v)}
        className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.04)' }}
      >
        <td className="px-3 py-2.5" style={{ paddingLeft: '20px' }}>
          <div className="flex items-center gap-2">
            {open
              ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
              : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
            <span className="text-[12px] font-semibold" style={{ color: 'var(--clay-black)' }}>
              {p.prompt_text}
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {p.visibility_pct.toFixed(1)}%
        </td>
        <td className="px-3 py-2.5 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.55)' }}>
          {p.avg_position != null ? `#${p.avg_position.toFixed(1)}` : '—'}
        </td>
        <td className="px-3 py-2.5 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.45)' }}>
          {p.response_count}
        </td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
          <td colSpan={colSpan} style={{ padding: '0 12px 10px 20px' }}>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
              {/* Column headers */}
              <div
                className="grid gap-2 px-3 py-1.5"
                style={{
                  gridTemplateColumns: '80px 70px 56px 56px 56px 1fr 16px',
                  background: 'rgba(26,25,21,0.04)',
                  borderBottom: '1px solid rgba(26,25,21,0.07)',
                }}
              >
                {['Platform', 'Date', 'Mentioned', 'Position', 'Cited', 'Other cited domains', ''].map(h => (
                  <span key={h} style={{ ...labelStyle, fontSize: '9px' }}>{h}</span>
                ))}
              </div>
              {/* Response rows — first 4 auto-open showing snippet */}
              {p.responses.map((r, idx) => <ResponseRow key={r.id} r={r} defaultOpen={idx < 4} />)}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

const PROMPT_LIMIT = 10

// ── Main component ─────────────────────────────────────────────────────────
export default function PMMTopicsSection({ series, table, compareEnabled, onDrilldown }: Props) {
  const [expandedPMM, setExpandedPMM] = useState<string | null>(null)
  const [drillRows, setDrillRows] = useState<Record<string, PMMPromptDrillRow[]>>({})
  const [loadingDrill, setLoadingDrill] = useState<string | null>(null)
  const [showAllPrompts, setShowAllPrompts] = useState<Record<string, boolean>>({})

  const { groups, chartData } = buildChartData(series)

  async function toggleDrill(pmm: string) {
    if (expandedPMM === pmm) { setExpandedPMM(null); return }
    setExpandedPMM(pmm)
    if (!drillRows[pmm]) {
      setLoadingDrill(pmm)
      const rows = await onDrilldown(pmm)
      setDrillRows(prev => ({ ...prev, [pmm]: rows }))
      setLoadingDrill(null)
    }
  }

  const colSpan = compareEnabled ? 7 : 6

  return (
    <div className="space-y-4">
      {/* Line chart */}
      <div className="p-5" style={cardStyle}>
        <h2 style={labelStyle} className="mb-4">Visibility by PMM Solution</h2>
        {chartData.length > 0 && groups.length > 0 ? (() => {
          const pmmAllVals = chartData.flatMap(r => groups.map(g => Number((r as any)[g!] ?? 0)))
          const pmmYMax = Math.min(100, Math.ceil(Math.max(...pmmAllVals, 1) * 1.2 / 5) * 5)
          return (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
              <XAxis dataKey="date" tickFormatter={formatShortDate}
                tick={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
                tickLine={false} axisLine={false} />
              <YAxis tickFormatter={v => `${Number(v).toFixed(0)}%`}
                tick={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', fill: 'rgba(26,25,21,0.4)' }}
                tickLine={false} axisLine={false} width={36} domain={[0, pmmYMax]} />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any, name: any) => [`${Number(val).toFixed(1)}%`, name]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(l: any) => formatShortDate(String(l))}
                contentStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans', border: '1px solid var(--clay-border-dashed)', borderRadius: '8px' }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'Plus Jakarta Sans' }} />
              {groups.map((g, i) => (
                <Line key={g} type="monotone" dataKey={g!}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={1.8}
                  dot={{ r: 2.5, strokeWidth: 0 }} activeDot={{ r: 4 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          )
        })() : (
          <p className="py-8 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No PMM use case data</p>
        )}
      </div>

      {/* Table */}
      <div className="p-5" style={cardStyle}>
        <h2 style={labelStyle} className="mb-1">PMM Breakdown</h2>
        <p className="text-[11px] font-semibold mb-4" style={{ color: 'rgba(26,25,21,0.4)' }}>
          Click a row to expand prompts → click a prompt to see responses with snippets
        </p>
        {table.length === 0 ? (
          <p className="py-6 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No PMM data</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--clay-border-dashed)' }}>
                <th className="pb-2 text-left" style={labelStyle}>PMM Solution</th>
                <th className="pb-2 text-right" style={labelStyle}>Visibility</th>
                {compareEnabled && <th className="pb-2 text-right" style={labelStyle}>vs Prev</th>}
                <th className="pb-2 text-right" style={labelStyle}>Citation Share</th>
                <th className="pb-2 text-right" style={labelStyle}>Avg Pos</th>
                <th className="pb-2 text-right" style={labelStyle}>Responses</th>
                <th className="pb-2" style={{ width: '24px' }} />
              </tr>
            </thead>
            <tbody>
              {table.map(row => {
                const isUp = row.delta != null ? row.delta > 0 : null
                const expanded = expandedPMM === row.pmm_use_case
                const drill = drillRows[row.pmm_use_case]
                return (
                  <React.Fragment key={row.pmm_use_case}>
                    {/* PMM row */}
                    <tr
                      onClick={() => toggleDrill(row.pmm_use_case)}
                      className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
                      style={{ borderBottom: expanded ? 'none' : '1px solid rgba(26,25,21,0.05)' }}
                    >
                      <td className="py-2.5 text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
                        <div className="flex items-center gap-2">
                          {expanded
                            ? <ChevronDown size={13} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
                            : <ChevronRight size={13} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />}
                          {row.pmm_use_case}
                        </div>
                      </td>
                      <td className="py-2.5 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                        {row.visibility_score.toFixed(1)}%
                      </td>
                      {compareEnabled && (
                        <td className="py-2.5 text-right">
                          {row.delta != null ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5"
                              style={{ borderRadius: '4px', background: isUp ? 'rgba(61,184,204,0.15)' : '#FFE0DD', color: isUp ? 'var(--clay-slushie)' : 'var(--clay-pomegranate)' }}>
                              {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                              {isUp ? '+' : ''}{row.delta!.toFixed(1)}%
                            </span>
                          ) : <span style={{ color: 'rgba(26,25,21,0.3)', fontSize: '11px' }}>—</span>}
                        </td>
                      )}
                      <td className="py-2.5 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.55)' }}>
                        {row.citation_share != null ? `${row.citation_share.toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2.5 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.55)' }}>
                        {row.avg_position != null ? `#${row.avg_position.toFixed(1)}` : '—'}
                      </td>
                      <td className="py-2.5 text-right text-[12px] font-semibold tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>
                        {row.total_responses.toLocaleString()}
                      </td>
                      <td />
                    </tr>

                    {/* Drill-down: prompt list */}
                    {expanded && (
                      <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
                        <td colSpan={colSpan} style={{ paddingBottom: '10px', paddingLeft: '4px', paddingRight: '4px' }}>
                          {loadingDrill === row.pmm_use_case ? (
                            <p className="px-4 py-3 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.4)' }}>Loading prompts…</p>
                          ) : !drill || drill.length === 0 ? (
                            <p className="px-4 py-3 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No prompt data</p>
                          ) : (
                            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
                              {/* Prompt table header */}
                              <div className="grid px-3 py-1.5" style={{
                                gridTemplateColumns: '1fr 80px 72px 72px',
                                background: 'rgba(26,25,21,0.03)',
                                borderBottom: '1px solid rgba(26,25,21,0.07)',
                              }}>
                                {['Prompt', 'Visibility', 'Avg Pos', 'Responses'].map((h, i) => (
                                  <span key={h} className={i > 0 ? 'text-right' : ''} style={{ ...labelStyle, fontSize: '9px' }}>{h}</span>
                                ))}
                              </div>
                              {/* Prompt rows sorted by response count — limited to top 10 */}
                              {(() => {
                                const sorted = [...drill].sort((a, b) => b.response_count - a.response_count)
                                const showAll = showAllPrompts[row.pmm_use_case]
                                const visible = showAll ? sorted : sorted.slice(0, PROMPT_LIMIT)
                                return (
                                  <>
                                    <table className="w-full">
                                      <tbody>
                                        {visible.map(p => (
                                          <PromptBlock key={p.prompt_id} p={p} colSpan={4} />
                                        ))}
                                      </tbody>
                                    </table>
                                    {sorted.length > PROMPT_LIMIT && (
                                      <button
                                        onClick={e => { e.stopPropagation(); setShowAllPrompts(prev => ({ ...prev, [row.pmm_use_case]: !showAll })) }}
                                        className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                                        style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)' }}
                                      >
                                        {showAll ? `Show top ${PROMPT_LIMIT} ↑` : `Show all ${sorted.length} prompts ↓`}
                                      </button>
                                    )}
                                  </>
                                )
                              })()}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
