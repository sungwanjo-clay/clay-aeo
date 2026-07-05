'use client'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import { useEffect, useState } from 'react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import {
  getSentimentBreakdown,
  getSentimentTimeseries,
  getSentimentNarratives,
  getCompetitivePositioningEntries,
} from '@/lib/queries/sentiment'
import type { NarrativeGroup, PositioningEntry } from '@/lib/queries/sentiment'
import KpiCard from '@/components/cards/KpiCard'
import SentimentAreaChart from '@/components/charts/SentimentAreaChart'
import { SkeletonCard, SkeletonChart } from '@/components/shared/Skeleton'
import { getPlatformColor } from '@/lib/utils/colors'
import { formatShortDate } from '@/lib/utils/formatters'
import { ChevronDown, ChevronRight, AlertTriangle, TrendingUp, Sparkles, Search } from 'lucide-react'

const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const LABEL = { color: 'rgba(26,25,21,0.45)', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }

type SentimentFilter = 'all' | 'Negative' | 'Neutral' | 'Positive'

function getSentimentStyle(s: string) {
  if (s === 'Negative') return { bg: 'rgba(229,54,42,0.08)', text: 'var(--clay-pomegranate)', border: '#E5362A', dot: 'var(--clay-pomegranate)' }
  if (s === 'Positive') return { bg: 'rgba(61,170,106,0.1)', text: 'var(--clay-matcha)', border: '#3DAA6A', dot: 'var(--clay-matcha)' }
  return { bg: 'rgba(26,25,21,0.06)', text: 'rgba(26,25,21,0.55)', border: 'rgba(26,25,21,0.2)', dot: 'rgba(26,25,21,0.35)' }
}

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const style = getSentimentStyle(sentiment)
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
      style={{ background: style.bg, color: style.text }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: style.dot }} />
      {sentiment}
    </span>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  if (!platform) return null
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white shrink-0"
      style={{ background: getPlatformColor(platform) }}>
      {platform}
    </span>
  )
}

const NARRATIVE_PAGE_SIZE = 10

function NarrativeFeed({ narratives, loading }: { narratives: NarrativeGroup[]; loading: boolean }) {
  const [filter, setFilter] = useState<SentimentFilter>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(NARRATIVE_PAGE_SIZE)

  const counts = {
    Negative: narratives.filter(n => n.sentiment === 'Negative').length,
    Neutral: narratives.filter(n => n.sentiment === 'Neutral').length,
    Positive: narratives.filter(n => n.sentiment === 'Positive').length,
  }

  const filtered = narratives
    .filter(n => filter === 'all' || n.sentiment === filter)
    .filter(n => !search || n.theme.toLowerCase().includes(search.toLowerCase()) || n.snippets.some(s => s.text.toLowerCase().includes(search.toLowerCase())))
  const visibleItems = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visibleCount

  const FILTERS: { key: SentimentFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: narratives.length },
    { key: 'Negative', label: 'Negative', count: counts.Negative },
    { key: 'Neutral', label: 'Neutral', count: counts.Neutral },
    { key: 'Positive', label: 'Positive', count: counts.Positive },
  ]

  function toggleExpand(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  return (
    <div style={CARD} className="overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--clay-border)' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
              Narrative Intelligence
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'rgba(26,25,21,0.5)' }}>
              Every theme AI generates about Clay. Negative ones need attention — fix the narrative or the source.
            </p>
          </div>
          <div className="relative shrink-0">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(26,25,21,0.35)' }} />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setVisibleCount(NARRATIVE_PAGE_SIZE) }}
              placeholder="Search themes or snippets…"
              className="pl-7 pr-3 py-1.5 text-[12px] font-medium focus:outline-none"
              style={{ background: 'rgba(26,25,21,0.04)', border: '1px solid var(--clay-border-dashed)', borderRadius: '8px', width: '220px', color: 'var(--clay-black)' }}
            />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {FILTERS.map(({ key, label, count }) => {
            const isActive = filter === key
            const style = key === 'all' ? null : getSentimentStyle(key as string)
            return (
              <button
                key={key}
                onClick={() => { setFilter(key); setVisibleCount(NARRATIVE_PAGE_SIZE) }}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold transition-all"
                style={{
                  background: isActive ? (style ? style.bg : 'rgba(26,25,21,0.08)') : 'transparent',
                  color: isActive ? (style ? style.text : 'var(--clay-black)') : 'rgba(26,25,21,0.45)',
                  border: isActive ? `1px solid ${style ? style.border : 'rgba(26,25,21,0.2)'}` : '1px solid transparent',
                }}
              >
                {label}
                <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'rgba(26,25,21,0.08)', color: 'rgba(26,25,21,0.5)' }}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="p-4 space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.06)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>No narratives found</div>
      ) : (
        <div>
          {visibleItems.map((item, idx) => {
            const style = getSentimentStyle(item.sentiment)
            const key = `${item.theme}|||${item.sentiment}`
            const isExpanded = expanded.has(key)
            const isNeg = item.sentiment === 'Negative'
            const isPos = item.sentiment === 'Positive'
            const topSnippet = item.snippets[0]
            const remaining = item.snippets.slice(1)

            return (
              <div key={key}
                style={{
                  borderBottom: '1px solid rgba(26,25,21,0.06)',
                  borderLeft: `3px solid ${style.border}`,
                  background: isNeg ? 'rgba(229,54,42,0.025)' : isPos ? 'rgba(61,170,106,0.025)' : 'transparent',
                }}
              >
                {/* Row header */}
                <div className="px-4 py-3">
                  <div className="flex items-start gap-2 flex-wrap">
                    <SentimentBadge sentiment={item.sentiment} />
                    <span className="text-[12px] font-bold" style={{ color: 'var(--clay-black)' }}>{item.theme}</span>
                    {isNeg && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(229,54,42,0.1)', color: 'var(--clay-pomegranate)' }}>
                        <AlertTriangle size={8} />
                        Fix narrative
                      </span>
                    )}
                    {isPos && (
                      <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(61,170,106,0.1)', color: 'var(--clay-matcha)' }}>
                        <TrendingUp size={8} />
                        Amplify
                      </span>
                    )}
                    <span className="ml-auto text-[10px] font-bold" style={{ color: 'rgba(26,25,21,0.35)' }}>
                      {item.occurrences}× seen
                    </span>
                  </div>

                  {/* Top snippet preview */}
                  {topSnippet && (
                    <div className="mt-2">
                      <p className="text-[12px] italic leading-relaxed" style={{ color: 'rgba(26,25,21,0.7)' }}>
                        &ldquo;{topSnippet.text}&rdquo;
                      </p>
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <PlatformBadge platform={topSnippet.platform} />
                        {topSnippet.topic && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.55)' }}>
                            {topSnippet.topic}
                          </span>
                        )}
                        {topSnippet.date && (
                          <span className="text-[10px]" style={{ color: 'rgba(26,25,21,0.3)' }}>
                            {formatShortDate(topSnippet.date)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expand button for more snippets */}
                  {remaining.length > 0 && (
                    <button
                      onClick={() => toggleExpand(key)}
                      className="mt-2 flex items-center gap-1 text-[11px] font-semibold transition-opacity hover:opacity-70"
                      style={{ color: 'rgba(26,25,21,0.45)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {isExpanded ? 'Hide' : `+${remaining.length} more occurrence${remaining.length > 1 ? 's' : ''}`}
                    </button>
                  )}

                  {/* Expanded snippets */}
                  {isExpanded && remaining.length > 0 && (
                    <div className="mt-3 space-y-2.5 pl-3" style={{ borderLeft: '1.5px solid var(--clay-border-dashed)' }}>
                      {remaining.slice(0, 8).map((s, i) => (
                        <div key={i}>
                          <p className="text-[12px] italic leading-relaxed" style={{ color: 'rgba(26,25,21,0.65)' }}>
                            &ldquo;{s.text}&rdquo;
                          </p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <PlatformBadge platform={s.platform} />
                            {s.topic && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.55)' }}>
                                {s.topic}
                              </span>
                            )}
                            {s.date && (
                              <span className="text-[10px]" style={{ color: 'rgba(26,25,21,0.3)' }}>
                                {formatShortDate(s.date)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                      {remaining.length > 8 && (
                        <p className="text-[11px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
                          + {remaining.length - 8} more not shown
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {remaining > 0 && (
            <button
              onClick={() => setVisibleCount(v => v + NARRATIVE_PAGE_SIZE)}
              className="w-full py-3 text-[11px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
              style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.45)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Show {Math.min(remaining, NARRATIVE_PAGE_SIZE)} more · {remaining} remaining ↓
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const FRAMING_PAGE_SIZE = 10

function CompetitiveFraming({ items, loading }: { items: PositioningEntry[]; loading: boolean }) {
  const topics = [...new Set(items.map(i => i.topic))].sort()
  const [activeTopic, setActiveTopic] = useState<string>('all')
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set())
  const [visibleCount, setVisibleCount] = useState(FRAMING_PAGE_SIZE)

  const filtered = activeTopic === 'all' ? items : items.filter(i => i.topic === activeTopic)
  const visibleItems = filtered.slice(0, visibleCount)
  const framingRemaining = filtered.length - visibleCount

  return (
    <div style={CARD} className="overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid var(--clay-border)' }}>
        <div className="flex items-start gap-2">
          <Sparkles size={14} style={{ color: 'var(--clay-blueberry)', marginTop: 2, flexShrink: 0 }} />
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
              Competitive Framing
            </h2>
            <p className="text-[12px] mt-0.5" style={{ color: 'rgba(26,25,21,0.5)' }}>
              How AI positions Clay relative to competitors across topics. Use this to understand which narratives need correction.
            </p>
          </div>
        </div>

        {/* Topic filter */}
        {topics.length > 1 && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <button
              onClick={() => setActiveTopic('all')}
              className="px-2.5 py-1 rounded text-[11px] font-bold transition-all"
              style={{
                background: activeTopic === 'all' ? 'rgba(26,25,21,0.08)' : 'transparent',
                color: activeTopic === 'all' ? 'var(--clay-black)' : 'rgba(26,25,21,0.45)',
                border: activeTopic === 'all' ? '1px solid rgba(26,25,21,0.2)' : '1px solid transparent',
              }}
            >
              All topics
            </button>
            {topics.slice(0, 8).map(t => (
              <button
                key={t}
                onClick={() => { setActiveTopic(t); setVisibleCount(FRAMING_PAGE_SIZE) }}
                className="px-2.5 py-1 rounded text-[11px] font-bold transition-all"
                style={{
                  background: activeTopic === t ? 'rgba(74,90,255,0.1)' : 'transparent',
                  color: activeTopic === t ? 'var(--clay-blueberry)' : 'rgba(26,25,21,0.45)',
                  border: activeTopic === t ? '1px solid rgba(74,90,255,0.3)' : '1px solid transparent',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="p-4 space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-16 rounded-lg animate-pulse" style={{ background: 'rgba(26,25,21,0.06)' }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>No positioning data</div>
      ) : (
        <div>
          {visibleItems.map((item, i) => {
            const isExpanded = expandedIdx.has(i)
            const isLong = item.snippet.length > 180
            const displayText = isExpanded || !isLong ? item.snippet : item.snippet.slice(0, 180) + '…'

            return (
              <div key={i} style={{ borderBottom: '1px solid rgba(26,25,21,0.06)', borderLeft: '3px solid var(--clay-blueberry)' }}
                className="px-4 py-3">
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <PlatformBadge platform={item.platform} />
                  {item.topic && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(74,90,255,0.08)', color: 'var(--clay-blueberry)' }}>
                      {item.topic}
                    </span>
                  )}
                  {item.date && (
                    <span className="text-[10px] ml-auto" style={{ color: 'rgba(26,25,21,0.3)' }}>
                      {formatShortDate(item.date)}
                    </span>
                  )}
                </div>
                <p className="text-[12px] italic leading-relaxed" style={{ color: 'rgba(26,25,21,0.7)' }}>
                  &ldquo;{displayText}&rdquo;
                </p>
                {isLong && (
                  <button
                    onClick={() => setExpandedIdx(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })}
                    className="mt-1 text-[11px] font-semibold hover:opacity-70"
                    style={{ color: 'rgba(26,25,21,0.4)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  >
                    {isExpanded ? 'Show less ↑' : 'Read more ↓'}
                  </button>
                )}
              </div>
            )
          })}
          {framingRemaining > 0 && (
            <button
              onClick={() => setVisibleCount(v => v + FRAMING_PAGE_SIZE)}
              className="w-full py-3 text-[11px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
              style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.45)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Show {Math.min(framingRemaining, FRAMING_PAGE_SIZE)} more · {framingRemaining} remaining ↓
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function SentimentPage() {
  const { toQueryParams, initialized } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [breakdown, setBreakdown] = useState<{ positive: number | null; neutral: number | null; negative: number | null; notMentioned: number | null; avgScore: number | null } | null>(null)
  const [timeseries, setTimeseries] = useState<{ date: string; positive: number; neutral: number; negative: number }[]>([])
  const [narratives, setNarratives] = useState<NarrativeGroup[]>([])
  const [positioning, setPositioning] = useState<PositioningEntry[]>([])

  useEffect(() => {
    if (!initialized) return
    setLoading(true)
    Promise.all([
      getSentimentBreakdown(supabase, f),
      getSentimentTimeseries(supabase, f),
      getSentimentNarratives(supabase, f),
      getCompetitivePositioningEntries(supabase, f),
    ]).then(([bdown, ts, narr, pos]) => {
      setBreakdown(bdown)
      setTimeseries(ts)
      setNarratives(narr)
      setPositioning(pos)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, initialized])

  const negCount = narratives.filter(n => n.sentiment === 'Negative').length

  return (
    <div className="p-3 md:p-6 space-y-4 md:space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.03em' }}>Sentiment</h1>
          <p className="text-[13px] mt-0.5" style={{ color: 'rgba(26,25,21,0.55)' }}>
            How AI describes Clay — and where to take action
          </p>
        </div>
        {!loading && negCount > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold shrink-0"
            style={{ background: 'rgba(229,54,42,0.08)', color: 'var(--clay-pomegranate)', border: '1px solid rgba(229,54,42,0.2)' }}>
            <AlertTriangle size={13} />
            {negCount} narrative{negCount > 1 ? 's' : ''} need attention
          </div>
        )}
      </div>

      {/* KPI row */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard label="Positive Sentiment" value={breakdown?.positive != null ? `${breakdown.positive.toFixed(1)}%` : '—'} delta={null} deltaLabel="of Clay mentions" />
          <KpiCard label="Neutral Sentiment" value={breakdown?.neutral != null ? `${breakdown.neutral.toFixed(1)}%` : '—'} delta={null} deltaLabel="of Clay mentions" />
          <KpiCard label="Negative Sentiment" value={breakdown?.negative != null ? `${breakdown.negative.toFixed(1)}%` : '—'} delta={null} deltaLabel="of Clay mentions" invertDelta />
          <KpiCard label="Brand Sentiment Score" value={breakdown?.avgScore != null ? `${breakdown.avgScore.toFixed(0)}/100` : '—'} delta={null} deltaLabel="avg score" />
        </div>
      )}

      {/* Sentiment Timeline */}
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-3">Sentiment Over Time</div>
        {loading ? <SkeletonChart /> : <SentimentAreaChart data={timeseries} />}
      </div>

      {/* Narrative Intelligence */}
      <NarrativeFeed narratives={narratives} loading={loading} />

      {/* Competitive Framing */}
      {(loading || positioning.length > 0) && (
        <CompetitiveFraming items={positioning} loading={loading} />
      )}

    </div>
  )
}
