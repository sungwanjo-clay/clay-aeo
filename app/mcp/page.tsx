'use client'

// @ts-nocheck

import React, { useState, useEffect } from 'react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import {
  getClaygentCount,
  getClaygentTimeseriesByPlatform,
  getFollowupTimeseries,
  getMentionBreakdown,
} from '@/lib/queries/visibility'
import type { MentionTopicRow } from '@/lib/queries/visibility'
import KpiCard from '@/components/cards/KpiCard'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { getPlatformColor } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'
import { ChevronDown, ChevronRight, Bot } from 'lucide-react'
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
  const preview = cleaned.slice(0, 220)
  const hasMore = cleaned.length > 220
  return (
    <div className="rounded-lg px-3 py-2.5 mt-2"
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
function ResponseCard({ r }: { r: MentionTopicRow['prompts'][0]['responses'][0] }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(r.snippet || r.response_text)

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ background: getPlatformColor(r.platform) + '20', color: getPlatformColor(r.platform) }}>
          {r.platform}
        </span>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgba(26,25,21,0.4)' }}>
          {r.run_date}
        </span>
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

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: '1px solid rgba(26,25,21,0.07)' }}>
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
          {r.other_cited_domains.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span style={{ ...LABEL, fontSize: '9px' }} className="w-full mb-0.5">Also cited</span>
              {r.other_cited_domains.map(d => (
                <span key={d} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.55)' }}>
                  {d}
                </span>
              ))}
            </div>
          )}
          {r.response_text && <FullResponseBlock text={r.response_text} />}
        </div>
      )}
    </div>
  )
}

// ── Prompt row ────────────────────────────────────────────────────────────────
function PromptRow({ p }: { p: MentionTopicRow['prompts'][0] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        {open
          ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
          : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
        <span className="flex-1 text-[13px] font-medium" style={{ color: 'var(--clay-black)' }}>
          {p.prompt_text}
        </span>
        <span className="text-[11px] font-bold tabular-nums shrink-0 px-2 py-0.5 rounded"
          style={{ background: 'rgba(200,240,64,0.2)', color: 'var(--clay-black)' }}>
          {p.count} mention{p.count !== 1 ? 's' : ''}
        </span>
      </div>
      {open && (
        <div className="px-4 pb-3 space-y-2">
          {p.responses.map(r => <ResponseCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Topic accordion row ───────────────────────────────────────────────────────
function TopicRow({ row }: { row: MentionTopicRow }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        onClick={() => setOpen(v => !v)}
        style={{ borderBottom: open ? '1px solid rgba(26,25,21,0.07)' : 'none' }}
      >
        {open
          ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
        <span className="flex-1 text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
          {row.topic}
        </span>
        <span className="text-[11px]" style={{ color: 'rgba(26,25,21,0.4)' }}>
          {row.prompts.length} prompt{row.prompts.length !== 1 ? 's' : ''}
        </span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {row.count} mentions
        </span>
      </div>
      {open && (
        <div style={{ background: 'rgba(26,25,21,0.01)' }}>
          {row.prompts.map(p => <PromptRow key={p.prompt_id} p={p} />)}
        </div>
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
  const [followupTs, setFollowupTs] = useState<{ date: string; count: number }[]>([])
  const [breakdown, setBreakdown] = useState<MentionTopicRow[]>([])
  const [followupBreakdown, setFollowupBreakdown] = useState<MentionTopicRow[]>([])

  // Fast: KPIs + timeseries
  useEffect(() => {
    setLoading(true)
    Promise.all([
      getClaygentCount(supabase, f).catch(() => null),
      getClaygentTimeseriesByPlatform(supabase, f).catch(() => []),
      getFollowupTimeseries(supabase, f).catch(() => []),
    ]).then(([cnt, ts, fuTs]) => {
      if (cnt) setMentionCount(cnt)
      setMcpTs(ts ?? [])
      setFollowupTs(fuTs ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter])

  // Slow: topic/prompt/response breakdown for both columns
  useEffect(() => {
    setLoadingBreakdown(true)
    Promise.all([
      getMentionBreakdown(supabase, f, 'claygent_or_mcp_mentioned').catch(() => []),
      getMentionBreakdown(supabase, f, 'clay_recommended_followup').catch(() => []),
    ]).then(([bd, fuBd]) => {
      setBreakdown(bd ?? [])
      setFollowupBreakdown(fuBd ?? [])
      setLoadingBreakdown(false)
    }).catch(() => setLoadingBreakdown(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter])

  // Build merged chart data: one key per platform + followup overlay
  const platforms = [...new Set(mcpTs.map(r => r.platform))].filter(Boolean)
  const allDates = [...new Set([...mcpTs.map(r => r.date), ...followupTs.map(r => r.date)])].sort()
  const followupMap = new Map(followupTs.map(r => [r.date, r.count]))

  const chartData = allDates.map(date => {
    const row: Record<string, string | number> = { date }
    for (const p of platforms) {
      const found = mcpTs.find(r => r.date === date && r.platform === p)
      row[p] = found?.count ?? 0
    }
    row['Clay Follow-up'] = followupMap.get(date) ?? 0
    return row
  })

  const totalMcp = breakdown.reduce((s, t) => s + t.count, 0)
  const totalFollowup = followupBreakdown.reduce((s, t) => s + t.count, 0)
  const correlationPct = totalMcp > 0 ? ((totalFollowup / totalMcp) * 100) : null
  const countDelta = mentionCount ? mentionCount.current - mentionCount.previous : null

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
          Track when AI models mention ClayMCP or Claygent — where, how often, and whether it drives follow-up recommendations.
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
            label="Clay Follow-up Recs"
            value={loadingBreakdown ? '…' : totalFollowup.toLocaleString()}
            delta={null}
            deltaLabel="times recommended"
          />
          <KpiCard
            label="Follow-up Correlation"
            value={loadingBreakdown ? '…' : correlationPct != null ? `${correlationPct.toFixed(0)}%` : '—'}
            delta={null}
            deltaLabel="of MCP mentions → rec"
          />
          <KpiCard
            label="Topics Covered"
            value={loadingBreakdown ? '…' : breakdown.length.toLocaleString()}
            delta={null}
            deltaLabel="distinct topics"
          />
        </div>
      )}

      {/* Mentions over time + Follow-up overlay */}
      <div style={CARD} className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div style={LABEL} className="mb-0.5">MCP &amp; Claygent Mentions Over Time</div>
            <p className="text-xs" style={{ color: 'rgba(26,25,21,0.45)' }}>
              Mentions per platform (solid lines) vs Clay recommended as follow-up action (dashed).
            </p>
          </div>
        </div>
        {loading ? <SkeletonChart /> : chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,25,21,0.06)" />
              <XAxis dataKey="date" tickFormatter={(v: any) => formatShortDate(v)}
                tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'rgba(26,25,21,0.4)' }} tickLine={false} axisLine={false} />
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
                  activeDot={{ r: 4 }} name={p} />
              ))}
              <Line
                type="monotone" dataKey="Clay Follow-up"
                stroke="var(--clay-black)" strokeWidth={2}
                strokeDasharray="5 3"
                dot={{ r: 2, strokeWidth: 0, fill: 'var(--clay-black)' }}
                activeDot={{ r: 4 }} name="Clay Follow-up Rec" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center py-14 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            No mention data for this period
          </div>
        )}
      </div>

      {/* MCP / Claygent mention breakdown: topic → prompt → response */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-0.5">Where MCP &amp; Claygent Is Mentioned</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Grouped by topic, then prompt. Expand to see the exact date, platform, snippet, and full AI response.
        </p>
        {loadingBreakdown ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.05)' }} />
            ))}
          </div>
        ) : breakdown.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            No MCP / Claygent mentions found in this period
          </div>
        ) : (
          <div className="space-y-2">
            {breakdown.map(row => <TopicRow key={row.topic} row={row} />)}
          </div>
        )}
      </div>

      {/* Clay recommended as follow-up breakdown */}
      <div style={CARD} className="p-4">
        <div className="flex items-center gap-2 mb-0.5">
          <div style={LABEL}>Clay Recommended as Follow-up</div>
          {!loadingBreakdown && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{ background: 'rgba(200,240,64,0.2)', color: 'var(--clay-black)' }}>
              {totalFollowup} responses
            </span>
          )}
        </div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Responses where the AI specifically recommended Clay as a next action — correlation signal for MCP/Claygent discoverability.
        </p>
        {loadingBreakdown ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.05)' }} />
            ))}
          </div>
        ) : followupBreakdown.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
            No Clay follow-up recommendations found in this period
          </div>
        ) : (
          <div className="space-y-2">
            {followupBreakdown.map(row => <TopicRow key={row.topic} row={row} />)}
          </div>
        )}
      </div>

    </div>
  )
}
