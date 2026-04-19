'use client'

// @ts-nocheck

import React, { useState, useEffect, useMemo } from 'react'
import { generateDateRange } from '@/lib/utils/dateRange'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import {
  getClaygentCount,
  getClaygentTimeseriesByPlatform,
  getMentionBreakdown,
} from '@/lib/queries/visibility'
import type { MentionTopicRow } from '@/lib/queries/visibility'
import KpiCard from '@/components/cards/KpiCard'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { getPlatformColor } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'
import { ChevronDown, ChevronRight, Bot, ExternalLink } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, BarChart, Bar, Cell,
} from 'recharts'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}
const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }

const SENTIMENT_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  Positive:      { bg: 'rgba(61,170,106,0.12)', color: '#2a7a4a', label: 'Positive' },
  Neutral:       { bg: 'rgba(156,163,175,0.15)', color: '#6b7280', label: 'Neutral' },
  Negative:      { bg: 'rgba(229,54,42,0.1)', color: '#c0392b', label: 'Negative' },
  'Not Mentioned': { bg: 'rgba(156,163,175,0.1)', color: '#9ca3af', label: 'Not Mentioned' },
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null
  const s = SENTIMENT_STYLES[sentiment] ?? SENTIMENT_STYLES['Neutral']
  return (
    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/#+\s+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*>]\s+/gm, '').replace(/\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// ── Full response expandable block ────────────────────────────────────────────
function FullResponseBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const cleaned = stripMarkdown(text)
  const preview = cleaned.slice(0, 280)
  const hasMore = cleaned.length > 280
  return (
    <div className="rounded-lg px-3 py-2.5"
      style={{ background: 'rgba(26,25,21,0.03)', border: '1px solid rgba(26,25,21,0.07)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,25,21,0.4)' }}>
        Full AI Response
      </p>
      <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(26,25,21,0.7)' }}>
        {open ? cleaned : preview}{!open && hasMore ? '…' : ''}
      </p>
      {hasMore && (
        <button
          onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          className="mt-1.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
          style={{ color: 'rgba(26,25,21,0.4)' }}
        >
          {open ? 'Show less ↑' : 'Show full response ↓'}
        </button>
      )}
    </div>
  )
}

// ── Response card ─────────────────────────────────────────────────────────────
type ResponseRow = MentionTopicRow['prompts'][0]['responses'][0]

function ResponseCard({ r }: { r: ResponseRow }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(r.snippet || r.response_text)

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
      {/* Header row — always visible */}
      <div
        className={`flex flex-wrap items-center gap-2 px-3 py-2.5 transition-colors ${hasDetail ? 'cursor-pointer hover:bg-[rgba(26,25,21,0.02)]' : ''}`}
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ background: getPlatformColor(r.platform) + '20', color: getPlatformColor(r.platform) }}>
          {r.platform}
        </span>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgba(26,25,21,0.4)' }}>
          {r.run_date}
        </span>
        <SentimentBadge sentiment={r.brand_sentiment} />
        {r.snippet && (
          <span className="text-[11px] flex-1 truncate italic" style={{ color: 'rgba(26,25,21,0.6)', minWidth: 0 }}>
            &ldquo;{r.snippet.slice(0, 120)}{r.snippet.length > 120 ? '…' : ''}&rdquo;
          </span>
        )}
        <div className="flex-1" />
        {hasDetail && (
          open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
        )}
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 pb-3 pt-2 space-y-3" style={{ borderTop: '1px solid rgba(26,25,21,0.07)' }}>
          {/* MCP/Claygent snippet highlight */}
          {r.snippet && (
            <div className="rounded px-2.5 py-2"
              style={{ background: 'rgba(200,240,64,0.08)', border: '1px solid rgba(200,240,64,0.3)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>
                MCP / Claygent mention
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                &ldquo;{stripMarkdown(r.snippet)}&rdquo;
              </p>
            </div>
          )}

          {/* Clay sentiment detail */}
          {r.brand_sentiment && r.brand_sentiment !== 'Not Mentioned' && (
            <div className="flex items-center gap-2">
              <span style={{ ...LABEL, fontSize: '9px' }}>Clay Sentiment</span>
              <SentimentBadge sentiment={r.brand_sentiment} />
            </div>
          )}

          {/* Other cited domains */}
          {r.other_cited_domains.length > 0 && (
            <div>
              <p style={{ ...LABEL, fontSize: '9px' }} className="mb-1.5">Also cited</p>
              <div className="flex flex-wrap gap-1">
                {r.other_cited_domains.map(d => (
                  <span key={d} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.55)' }}>
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Full AI response */}
          {r.response_text && <FullResponseBlock text={r.response_text} />}
        </div>
      )}
    </div>
  )
}

// ── Flat prompt row ───────────────────────────────────────────────────────────
interface FlatPrompt {
  prompt_id: string
  prompt_text: string
  count: number
  topic: string | null
  responses: ResponseRow[]
}

function PromptRow({ p }: { p: FlatPrompt }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        onClick={() => setOpen(v => !v)}
        style={{ borderBottom: open ? '1px solid rgba(26,25,21,0.07)' : 'none' }}
      >
        {open
          ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium truncate" style={{ color: 'var(--clay-black)' }}>
            {p.prompt_text}
          </p>
          {p.topic && (
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(26,25,21,0.4)' }}>{p.topic}</p>
          )}
        </div>
        <span className="text-[11px] font-bold tabular-nums shrink-0 px-2 py-0.5 rounded"
          style={{ background: 'rgba(200,240,64,0.2)', color: 'var(--clay-black)' }}>
          {p.count} mention{p.count !== 1 ? 's' : ''}
        </span>
      </div>
      {open && (
        <div className="p-3 space-y-2" style={{ background: 'rgba(26,25,21,0.01)' }}>
          {p.responses.map(r => <ResponseCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Paginated prompt list ──────────────────────────────────────────────────────
const PROMPT_PAGE_SIZE = 10
function PromptList({ prompts }: { prompts: FlatPrompt[] }) {
  const [visible, setVisible] = useState(PROMPT_PAGE_SIZE)
  const shown = prompts.slice(0, visible)
  const remaining = prompts.length - visible
  return (
    <div className="space-y-2">
      {shown.map(p => <PromptRow key={p.prompt_id} p={p} />)}
      {remaining > 0 && (
        <button
          onClick={() => setVisible(v => v + PROMPT_PAGE_SIZE)}
          className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
          style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Show {Math.min(remaining, PROMPT_PAGE_SIZE)} more of {remaining} remaining ↓
        </button>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function McpPage() {
  const { toQueryParams } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [loadingBreakdown, setLoadingBreakdown] = useState(true)

  const [mentionCount, setMentionCount] = useState<{ current: number; previous: number } | null>(null)
  const [mcpTs, setMcpTs] = useState<{ date: string; platform: string; count: number }[]>([])
  const [breakdown, setBreakdown] = useState<MentionTopicRow[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getClaygentCount(supabase, f).catch(() => null),
      getClaygentTimeseriesByPlatform(supabase, f).catch(() => []),
    ]).then(([cnt, ts]) => {
      if (cnt) setMentionCount(cnt)
      setMcpTs(ts ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter])

  useEffect(() => {
    setLoadingBreakdown(true)
    getMentionBreakdown(supabase, f, 'claygent_or_mcp_mentioned')
      .then(bd => { setBreakdown(bd ?? []); setLoadingBreakdown(false) })
      .catch(() => setLoadingBreakdown(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter])

  // Flatten topic→prompt→response to a simple ranked prompt list
  const flatPrompts = useMemo((): FlatPrompt[] => {
    const map = new Map<string, FlatPrompt>()
    for (const topic of breakdown) {
      for (const p of topic.prompts) {
        if (!map.has(p.prompt_id)) {
          map.set(p.prompt_id, {
            prompt_id: p.prompt_id,
            prompt_text: p.prompt_text,
            count: 0,
            topic: p.topic ?? null,
            responses: [],
          })
        }
        const entry = map.get(p.prompt_id)!
        entry.count += p.count
        entry.responses.push(...p.responses)
      }
    }
    return [...map.values()]
      .sort((a, b) => b.count - a.count)
  }, [breakdown])

  // Chart data
  const platforms = [...new Set(mcpTs.map(r => r.platform))].filter(Boolean)
  const allDates = generateDateRange(f.startDate.split('T')[0], f.endDate.split('T')[0])

  const chartData = allDates.map(date => {
    const row: Record<string, string | number> = { date }
    for (const p of platforms) {
      const found = mcpTs.find(r => r.date === date && r.platform === p)
      if (found) row[p] = found.count
    }
    return row
  })

  const countDelta = mentionCount ? mentionCount.current - mentionCount.previous : null
  const uniquePrompts = flatPrompts.length
  const topPlatform = useMemo(() => {
    const totals = new Map<string, number>()
    for (const r of mcpTs) totals.set(r.platform, (totals.get(r.platform) ?? 0) + r.count)
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1])
    return sorted[0]?.[0] ?? null
  }, [mcpTs])

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Bot size={18} style={{ color: 'var(--clay-black)' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>
            MCP &amp; Claygent
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'rgba(26,25,21,0.55)' }}>
          Track when AI models mention ClayMCP or Claygent — which prompts trigger it, on which platforms, and how Clay is described.
        </p>
      </div>

      {/* KPI tiles */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="MCP / Claygent Mentions"
            value={mentionCount != null ? mentionCount.current.toLocaleString() : '—'}
            delta={countDelta}
            deltaLabel="vs prev period"
          />
          <KpiCard
            label="Unique Prompts"
            value={loadingBreakdown ? '…' : uniquePrompts.toLocaleString()}
            delta={null}
            deltaLabel="prompts that triggered a mention"
          />
          <KpiCard
            label="Top Platform"
            value={topPlatform ?? '—'}
            delta={null}
            deltaLabel="most MCP/Claygent mentions"
          />
          <KpiCard
            label="Topics Covered"
            value={loadingBreakdown ? '…' : breakdown.length.toLocaleString()}
            delta={null}
            deltaLabel="distinct topics"
          />
        </div>
      )}

      {/* Mentions over time */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">MCP &amp; Claygent Mentions Over Time</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Daily mention count per platform.
        </p>
        {loading ? <SkeletonChart /> : chartData.length === 0 ? (
          <div className="flex items-center justify-center py-14 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            No mention data for this period
          </div>
        ) : chartData.length === 1 ? (
          // Single date — show as bar per platform instead of a line
          <div className="flex items-end gap-6 px-2 py-6">
            {platforms.map(p => {
              const val = chartData[0][p] as number
              return (
                <div key={p} className="flex flex-col items-center gap-1">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>{val}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: getPlatformColor(p) + '20', color: getPlatformColor(p) }}>
                    {p}
                  </span>
                </div>
              )
            })}
            <p className="text-xs ml-2" style={{ color: 'rgba(26,25,21,0.4)' }}>
              All mentions on {formatShortDate(chartData[0].date as string)} — run again tomorrow to see a trend.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
              <XAxis dataKey="date" tickFormatter={(v: any) => formatShortDate(v)}
                tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(val: any, name: any) => [val, name]}
                labelFormatter={(l: any) => formatShortDate(String(l))}
                contentStyle={{ fontSize: 11, border: '1px solid var(--clay-border)', borderRadius: '8px' }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              {platforms.map(p => (
                <Line key={p} type="monotone" dataKey={p}
                  stroke={getPlatformColor(p)} strokeWidth={2}
                  dot={{ r: 2.5, strokeWidth: 0, fill: getPlatformColor(p) }}
                  activeDot={{ r: 4 }} name={p} connectNulls={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Flat prompt list */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-0.5">Where MCP &amp; Claygent Is Mentioned</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Top prompts by mention count. Expand any prompt to see the full AI response, Clay's sentiment, and other cited sources.
        </p>
        {loadingBreakdown ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.05)' }} />
            ))}
          </div>
        ) : flatPrompts.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            No MCP / Claygent mentions found in this period
          </div>
        ) : (
          <PromptList prompts={flatPrompts} />
        )}
      </div>

    </div>
  )
}
