'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { MentionTopicRow, MentionPromptRow, MentionResponseRow } from '@/lib/queries/visibility'
import { supabase } from '@/lib/supabase/client'

interface Props {
  data: MentionTopicRow[]
  accentColor: string  // e.g. '#4A5AFF' or 'var(--clay-matcha)'
}

const labelStyle = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '9px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}

const PROMPT_LIMIT = 8

/** Strip common markdown so raw LLM output displays cleanly */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#+\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*>]\s+/gm, '')
    .replace(/\|\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Full response expandable ────────────────────────────────────────────────
function FullResponseBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const cleaned = stripMarkdown(text)
  const preview = cleaned.slice(0, 200)
  const hasMore = cleaned.length > 200

  return (
    <div className="rounded-lg px-3 py-2.5 mt-2"
      style={{ background: 'rgba(26,25,21,0.03)', border: '1px solid rgba(26,25,21,0.07)' }}>
      <p style={{ ...labelStyle, display: 'block', marginBottom: '4px' }}>Full AI Response</p>
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

// ── Single response row ─────────────────────────────────────────────────────
function ResponseRow({ r, accentColor, defaultOpen }: { r: MentionResponseRow; accentColor: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [responseText, setResponseText] = useState<string | null>(null)
  const [loadingText, setLoadingText] = useState(false)
  const hasDetail = !!r.snippet

  async function handleExpand() {
    const next = !open
    setOpen(next)
    if (next && responseText === null && !loadingText) {
      setLoadingText(true)
      const { data } = await supabase.from('responses').select('response_text').eq('id', r.id).single()
      setResponseText(data?.response_text ?? '')
      setLoadingText(false)
    }
  }

  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.04)', background: open ? 'rgba(26,25,21,0.01)' : 'transparent' }}>
      <div
        className="grid items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)]"
        style={{ gridTemplateColumns: '88px 76px 1fr 16px' }}
        onClick={handleExpand}
      >
        {/* Platform */}
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-center"
          style={{
            background: r.platform === 'ChatGPT' ? 'rgba(61,170,106,0.12)' : 'rgba(204,61,138,0.12)',
            color: r.platform === 'ChatGPT' ? '#3DAA6A' : '#CC3D8A',
          }}>
          {r.platform}
        </span>

        {/* Date */}
        <span className="text-[11px] tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>{r.run_date}</span>

        {/* Snippet preview or domain pills */}
        <div className="truncate">
          {r.snippet ? (
            <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--clay-black)' }}>
              &ldquo;{stripMarkdown(r.snippet).slice(0, 80)}{stripMarkdown(r.snippet).length > 80 ? '…' : ''}&rdquo;
            </span>
          ) : r.other_cited_domains.length > 0 ? (
            <div className="flex gap-1 flex-wrap">
              {r.other_cited_domains.slice(0, 4).map(d => (
                <span key={d} className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.55)' }}>
                  {d}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[11px]" style={{ color: 'rgba(26,25,21,0.3)' }}>No snippet</span>
          )}
        </div>

        {/* Expand chevron */}
        <div>
          {hasDetail && (open
            ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.35)' }} />
            : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.35)' }} />
          )}
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 pb-3">
          {r.snippet && (
            <div className="rounded-lg px-3 py-2.5"
              style={{ background: `color-mix(in srgb, ${accentColor} 8%, white)`, border: `1px solid color-mix(in srgb, ${accentColor} 25%, transparent)` }}>
              <p style={{ ...labelStyle, display: 'block', marginBottom: '4px' }}>Snippet</p>
              <p className="text-[12px] font-semibold leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                &ldquo;{stripMarkdown(r.snippet)}&rdquo;
              </p>
            </div>
          )}
          {loadingText && <div className="mt-2 h-10 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.05)' }} />}
          {!loadingText && responseText && <FullResponseBlock text={responseText} />}
          {r.other_cited_domains.length > 0 && (
            <div className="mt-2">
              <p style={{ ...labelStyle, display: 'block', marginBottom: '4px' }}>Other cited domains</p>
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

// ── Prompt row (expands to responses) ──────────────────────────────────────
function PromptRow({ p, accentColor, defaultOpen, requireSnippet }: { p: MentionPromptRow; accentColor: string; defaultOpen?: boolean; requireSnippet?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false)

  // When requireSnippet is true, only show responses that have a snippet
  const visibleResponses = requireSnippet ? p.responses.filter(r => r.snippet) : p.responses
  if (requireSnippet && visibleResponses.length === 0) return null

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
            <span className="text-[12px] font-semibold" style={{ color: 'var(--clay-black)' }}>{p.prompt_text}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right">
          <span className="text-[12px] font-bold tabular-nums px-2 py-0.5 rounded"
            style={{ background: 'rgba(26,25,21,0.06)', color: 'var(--clay-black)' }}>
            {visibleResponses.length}
          </span>
        </td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
          <td colSpan={2} style={{ padding: '0 12px 8px 20px' }}>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
              {/* Header */}
              <div className="grid gap-2 px-3 py-1.5"
                style={{ gridTemplateColumns: '88px 76px 1fr 16px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                {['Platform', 'Date', 'Snippet / Preview', ''].map(h => (
                  <span key={h} style={labelStyle}>{h}</span>
                ))}
              </div>
              {visibleResponses.map((r, idx) => <ResponseRow key={r.id} r={r} accentColor={accentColor} defaultOpen={defaultOpen && idx < 4} />)}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Topic row (expands to prompts) ─────────────────────────────────────────
function TopicRow({ topic, accentColor, requireSnippet }: { topic: MentionTopicRow; accentColor: string; requireSnippet?: boolean }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const visible = showAll ? topic.prompts : topic.prompts.slice(0, PROMPT_LIMIT)

  return (
    <React.Fragment>
      <tr
        onClick={() => setOpen(v => !v)}
        className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.06)' }}
      >
        <td className="py-3 text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
          <div className="flex items-center gap-2">
            {open
              ? <ChevronDown size={13} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
              : <ChevronRight size={13} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />}
            {topic.topic}
          </div>
        </td>
        <td className="py-3 text-right">
          <span className="text-[13px] font-bold tabular-nums px-2 py-0.5 rounded"
            style={{ background: `color-mix(in srgb, ${accentColor} 12%, white)`, color: 'var(--clay-black)' }}>
            {topic.count}
          </span>
        </td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
          <td colSpan={2} style={{ paddingBottom: '10px', paddingLeft: '4px', paddingRight: '4px' }}>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
              {/* Prompt header */}
              <div className="grid px-3 py-1.5"
                style={{ gridTemplateColumns: '1fr 64px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                <span style={labelStyle}>Prompt</span>
                <span className="text-right" style={labelStyle}>Mentions</span>
              </div>
              <table className="w-full">
                <tbody>
                  {visible.map((p, idx) => <PromptRow key={p.prompt_id} p={p} accentColor={accentColor} defaultOpen={idx < 4} requireSnippet={requireSnippet} />)}
                </tbody>
              </table>
              {topic.prompts.length > PROMPT_LIMIT && (
                <button
                  onClick={e => { e.stopPropagation(); setShowAll(v => !v) }}
                  className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                  style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)' }}
                >
                  {showAll ? `Show top ${PROMPT_LIMIT} ↑` : `Show all ${topic.prompts.length} prompts ↓`}
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Exported table ──────────────────────────────────────────────────────────
export default function MentionBreakdownTable({ data, accentColor, requireSnippet }: Props & { requireSnippet?: boolean }) {
  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>
        No data in this period
      </p>
    )
  }

  return (
    <table className="w-full">
      <thead>
        <tr style={{ borderBottom: '1px solid var(--clay-border-dashed)' }}>
          <th className="pb-2 text-left" style={labelStyle}>Topic</th>
          <th className="pb-2 text-right" style={labelStyle}>Mentions</th>
        </tr>
      </thead>
      <tbody>
        {data.map(topic => (
          <TopicRow key={topic.topic} topic={topic} accentColor={accentColor} requireSnippet={requireSnippet} />
        ))}
      </tbody>
    </table>
  )
}
