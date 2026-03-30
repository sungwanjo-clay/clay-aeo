'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getPlatformColor } from '@/lib/utils/colors'
import type { SentimentVsClayData, SentimentThemeGroup, SentimentThemeSnippet } from '@/lib/queries/competitive'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/#+\s+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*>]\s+/gm, '').replace(/\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// Sentiment → colours
function sentimentStyle(s: string) {
  if (s === 'Positive') return { bg: 'rgba(200,240,64,0.18)', text: '#3a6200', border: 'rgba(200,240,64,0.5)' }
  if (s === 'Negative') return { bg: 'rgba(229,54,42,0.08)', text: 'var(--clay-pomegranate)', border: 'rgba(229,54,42,0.25)' }
  return { bg: 'rgba(26,25,21,0.05)', text: 'rgba(26,25,21,0.55)', border: 'rgba(26,25,21,0.12)' }
}

// ── Stacked mini-bar ───────────────────────────────────────────────────────────
function SentimentBar({ pos, neu, neg, height = 6 }: { pos: number; neu: number; neg: number; height?: number }) {
  return (
    <div className="w-full rounded-full overflow-hidden flex"
      style={{ height: `${height}px`, background: 'rgba(26,25,21,0.06)', minWidth: '80px' }}>
      <div style={{ width: `${pos}%`, background: '#C8F040', transition: 'width 0.4s' }} />
      <div style={{ width: `${neu}%`, background: 'rgba(26,25,21,0.2)', transition: 'width 0.4s' }} />
      <div style={{ width: `${neg}%`, background: '#E5362A', transition: 'width 0.4s', opacity: 0.7 }} />
    </div>
  )
}

// ── Full response expandable block ────────────────────────────────────────────
function FullResponseBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const cleaned = stripMarkdown(text)
  const preview = cleaned.slice(0, 200)
  const hasMore = cleaned.length > 200
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

// ── Single response snippet card ──────────────────────────────────────────────
function SnippetCard({ s }: { s: SentimentThemeSnippet }) {
  const [open, setOpen] = useState(false)
  const style = sentimentStyle(s.theme_sentiment)
  const hasDetail = !!(s.theme_snippet || s.positioning_vs_competitors || s.clay_mention_snippet || s.response_text)

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${style.border}` }}>
      {/* Header */}
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ background: style.bg }}
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}>
          {s.theme_sentiment}
        </span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 text-center"
          style={{ background: getPlatformColor(s.platform) + '20', color: getPlatformColor(s.platform) }}>
          {s.platform}
        </span>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgba(26,25,21,0.45)' }}>{s.run_date}</span>
        {/* Theme snippet preview */}
        {s.theme_snippet && (
          <span className="text-[11px] flex-1 truncate italic" style={{ color: 'rgba(26,25,21,0.6)', minWidth: 0 }}>
            &ldquo;{stripMarkdown(s.theme_snippet).slice(0, 100)}{s.theme_snippet.length > 100 ? '…' : ''}&rdquo;
          </span>
        )}
        <div className="flex-1" />
        {hasDetail && (
          open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
        )}
      </div>

      {/* Expanded */}
      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: `1px solid ${style.border}` }}>
          {s.positioning_vs_competitors && (
            <div className="rounded px-2.5 py-2"
              style={{ background: 'rgba(74,90,255,0.05)', border: '1px solid rgba(74,90,255,0.18)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#4A5AFF', opacity: 0.8 }}>
                Positioning vs competitors
              </p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                {stripMarkdown(s.positioning_vs_competitors)}
              </p>
            </div>
          )}
          {s.clay_mention_snippet && (
            <div className="rounded px-2.5 py-2"
              style={{ background: 'rgba(200,240,64,0.08)', border: '1px solid rgba(200,240,64,0.3)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>
                Clay mention
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                &ldquo;{stripMarkdown(s.clay_mention_snippet)}&rdquo;
              </p>
            </div>
          )}
          {s.response_text && <FullResponseBlock text={s.response_text} />}
        </div>
      )}
    </div>
  )
}

// ── Theme group row ────────────────────────────────────────────────────────────
function ThemeRow({ group }: { group: SentimentThemeGroup }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const style = sentimentStyle(group.dominantSentiment)
  const visible = showAll ? group.snippets : group.snippets.slice(0, 5)

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid rgba(26,25,21,0.08)` }}>
      {/* Theme header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        onClick={() => setOpen(v => !v)}
        style={{ borderBottom: open ? '1px solid rgba(26,25,21,0.07)' : 'none' }}
      >
        {/* Chevron */}
        <div className="shrink-0">
          {open
            ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />
            : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />}
        </div>

        {/* Theme name + dominant badge */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--clay-black)' }}>
            {group.theme}
          </span>
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
            style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}` }}>
            {group.dominantSentiment}
          </span>
        </div>

        {/* Mini sentiment bar */}
        <div className="hidden sm:block" style={{ width: '100px' }}>
          <SentimentBar pos={group.positivePct} neu={group.neutralPct} neg={group.negativePct} />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 shrink-0 text-right">
          <div className="hidden sm:flex items-center gap-2 text-[10px]" style={{ color: 'rgba(26,25,21,0.45)' }}>
            {group.positive > 0 && (
              <span style={{ color: '#3a6200', fontWeight: 700 }}>+{group.positive}</span>
            )}
            {group.neutral > 0 && (
              <span style={{ color: 'rgba(26,25,21,0.4)', fontWeight: 600 }}>{group.neutral}</span>
            )}
            {group.negative > 0 && (
              <span style={{ color: 'var(--clay-pomegranate)', fontWeight: 700 }}>−{group.negative}</span>
            )}
          </div>
          <span className="text-[12px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.4)' }}>
            {group.total} responses
          </span>
        </div>
      </div>

      {/* Expanded snippet list */}
      {open && (
        <div className="p-3 space-y-2" style={{ background: 'rgba(26,25,21,0.01)' }}>
          {visible.map((s, i) => <SnippetCard key={`${s.id}-${i}`} s={s} />)}
          {group.snippets.length > 5 && (
            <button
              onClick={e => { e.stopPropagation(); setShowAll(v => !v) }}
              className="w-full py-1.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
              style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)', marginTop: '4px' }}
            >
              {showAll ? 'Show fewer ↑' : `Show all ${group.snippets.length} responses ↓`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  data: SentimentVsClayData | null
  selected: string
  loading: boolean
}

export default function CompSentimentVsClay({ data, selected, loading }: Props) {
  const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
  const isClay = selected === 'Clay'

  const heading = isClay ? 'Clay Sentiment by Theme' : `Sentiment vs ${selected} — by Theme`
  const subtitle = isClay
    ? 'How AI models talk about Clay, grouped by the themes they associate with the brand.'
    : `Clay's positioning in the ${data?.coMentionCount?.toLocaleString() ?? '…'} responses where both Clay and ${selected} appear — grouped by theme. Negative-dominant themes surface first.`

  if (loading) {
    return (
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">{heading}</div>
        <div className="animate-pulse space-y-3 mt-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-lg" style={{ background: 'rgba(26,25,21,0.05)' }} />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.themeGroups.length === 0) {
    return (
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">{heading}</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>{subtitle}</p>
        <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
          {isClay ? 'No theme data available' : `No co-mention theme data found for ${selected}`}
        </div>
      </div>
    )
  }

  return (
    <div style={CARD} className="p-4">
      <div style={LABEL} className="mb-1">{heading}</div>
      <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>{subtitle}</p>

      {/* Overall summary bar */}
      <div className="flex items-center gap-3 mb-5 p-3 rounded-lg"
        style={{ background: 'rgba(26,25,21,0.03)', border: '1px solid rgba(26,25,21,0.07)' }}>
        <div className="flex-1">
          <SentimentBar pos={data.clayPositivePct} neu={data.clayNeutralPct} neg={data.clayNegativePct} height={10} />
        </div>
        <div className="flex items-center gap-4 shrink-0 text-[11px]">
          <span style={{ color: '#3a6200', fontWeight: 700 }}>{data.clayPositivePct.toFixed(0)}% Positive</span>
          <span style={{ color: 'rgba(26,25,21,0.4)', fontWeight: 600 }}>{data.clayNeutralPct.toFixed(0)}% Neutral</span>
          <span style={{ color: 'var(--clay-pomegranate)', fontWeight: 700 }}>{data.clayNegativePct.toFixed(0)}% Negative</span>
          {data.clayAvgScore != null && (
            <span style={{ color: 'rgba(26,25,21,0.4)' }}>
              Avg <span style={{ color: 'var(--clay-black)', fontWeight: 700 }}>{data.clayAvgScore.toFixed(1)}/10</span>
            </span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3">
        <span style={LABEL}>Themes — {data.themeGroups.length} found</span>
        <div className="flex items-center gap-3 text-[10px] ml-auto" style={{ color: 'rgba(26,25,21,0.4)' }}>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#C8F040' }} /> Positive
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'rgba(26,25,21,0.25)' }} /> Neutral
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#E5362A', opacity: 0.7 }} /> Negative
          </span>
        </div>
      </div>

      {/* Theme rows */}
      <div className="space-y-2">
        {data.themeGroups.map(group => (
          <ThemeRow key={group.theme} group={group} />
        ))}
      </div>
    </div>
  )
}
