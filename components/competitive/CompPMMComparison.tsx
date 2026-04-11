'use client'

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getPlatformColor } from '@/lib/utils/colors'
import type { PMMCompRow, PMMCompPromptRow } from '@/lib/queries/competitive'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}
const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }
const COMP_COLORS = ['#4A5AFF', '#FF6B35', '#CC3D8A', '#3DB8CC', '#3DAA6A']

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/#+\s+/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*>]\s+/gm, '').replace(/\|\s*/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

// ── Full response expandable block ─────────────────────────────────────────────
function FullResponseBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const cleaned = stripMarkdown(text)
  const preview = cleaned.slice(0, 200)
  const hasMore = cleaned.length > 200
  return (
    <div className="rounded-lg px-3 py-2.5 mt-2"
      style={{ background: 'rgba(26,25,21,0.03)', border: '1px solid rgba(26,25,21,0.07)' }}>
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: 'rgba(26,25,21,0.45)' }}>Full AI Response</p>
      <p className="text-[12px] leading-relaxed" style={{ color: 'rgba(26,25,21,0.75)' }}>
        {open ? cleaned : preview}{!open && hasMore ? '…' : ''}
      </p>
      {hasMore && (
        <button onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
          className="mt-1.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
          style={{ color: 'rgba(26,25,21,0.45)' }}>
          {open ? 'Show less ↑' : 'Show full response ↓'}
        </button>
      )}
    </div>
  )
}

// ── Response row ───────────────────────────────────────────────────────────────
function CompResponseRow({ r, compName, defaultOpen = false }: { r: PMMCompPromptRow['responses'][0]; compName: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const hasDetail = !!(r.clay_mention_snippet || r.response_text)
  const clayYes = r.clay_mentioned === 'Yes'
  const compYes = r.competitor_mentioned
  // Show the competitor badge whenever we have a real competitor to display
  const showComp = !!compName

  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
      <div
        className={`flex items-center gap-3 px-3 py-2.5 ${hasDetail ? 'cursor-pointer hover:bg-[rgba(26,25,21,0.02)]' : ''} transition-colors`}
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
          style={{ background: getPlatformColor(r.platform) + '20', color: getPlatformColor(r.platform), minWidth: '52px', textAlign: 'center' }}>
          {r.platform}
        </span>
        <span className="text-[11px] tabular-nums shrink-0 w-20" style={{ color: 'rgba(26,25,21,0.45)' }}>{r.run_date}</span>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded"
            style={{
              background: clayYes ? 'rgba(200,240,64,0.2)' : 'rgba(229,54,42,0.07)',
              color: clayYes ? 'var(--clay-positive-text)' : 'var(--clay-pomegranate)',
              border: `1px solid ${clayYes ? 'rgba(200,240,64,0.5)' : 'rgba(229,54,42,0.2)'}`,
            }}>
            <span>{clayYes ? '✓' : '✗'}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide">Clay</span>
          </div>
          {showComp && (
            <div className="flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded"
              style={{
                background: compYes ? 'rgba(74,90,255,0.1)' : 'rgba(26,25,21,0.05)',
                color: compYes ? '#4A5AFF' : 'rgba(26,25,21,0.35)',
                border: `1px solid ${compYes ? 'rgba(74,90,255,0.25)' : 'rgba(26,25,21,0.1)'}`,
              }}>
              <span>{compYes ? '✓' : '✗'}</span>
              <span className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ maxWidth: '64px' }}>{compName}</span>
            </div>
          )}
        </div>
        <div className="flex-1" />
        {hasDetail && (
          <span className="text-[10px] font-semibold shrink-0" style={{ color: 'rgba(26,25,21,0.3)' }}>
            {open ? '↑' : 'View response ↓'}
          </span>
        )}
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid rgba(26,25,21,0.05)', background: 'rgba(26,25,21,0.01)' }}>
          {r.clay_mention_snippet && (
            <div className="rounded-lg px-3 py-2 mt-2"
              style={{ background: 'rgba(200,240,64,0.08)', border: '1px solid rgba(200,240,64,0.25)' }}>
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>How Clay was mentioned</p>
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                &ldquo;{stripMarkdown(r.clay_mention_snippet)}&rdquo;
              </p>
            </div>
          )}
          {r.response_text && <FullResponseBlock text={r.response_text} />}
        </div>
      )}
    </div>
  )
}

// ── Prompt row ─────────────────────────────────────────────────────────────────
const RESPONSE_LIMIT = 10

function CompPromptRow({ p, selected, nonClayComps }: { p: PMMCompPromptRow; selected: string; nonClayComps: string[] }) {
  const [open, setOpen] = useState(false)
  const [showAllResponses, setShowAllResponses] = useState(false)

  // The competitor to display in response badges — always the first non-Clay comp
  // regardless of which tab is active (selected can be 'Clay' when viewing Clay's perspective)
  const compName = nonClayComps.length > 0 ? nonClayComps[0] : (selected !== 'Clay' ? selected : null)

  const compColor = nonClayComps.length > 0
    ? COMP_COLORS[nonClayComps.indexOf(selected) !== -1 ? nonClayComps.indexOf(selected) : 0]
    : COMP_COLORS[0]

  const visibleResponses = showAllResponses ? p.responses : p.responses.slice(0, RESPONSE_LIMIT)
  const gap = p.clay_visibility - p.competitor_visibility
  const clayLeads = gap > 0

  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
      {/* Prompt header */}
      <div
        className="flex items-center gap-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ padding: '8px 16px 8px 20px' }}
        onClick={() => setOpen(v => !v)}
      >
        <div className="shrink-0">
          {open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.4)' }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.4)' }} />}
        </div>
        <span className="flex-1 text-[12px] font-medium leading-tight min-w-0" style={{ color: 'var(--clay-black)' }}>
          {p.prompt_text}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          {nonClayComps.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold tabular-nums" style={{ color: compColor }}>
                {p.competitor_visibility.toFixed(1)}%
              </span>
              <span className="text-[9px]" style={{ color: 'rgba(26,25,21,0.3)' }}>vs</span>
              <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                {p.clay_visibility.toFixed(1)}%
              </span>
              <span className="text-[9px] font-bold px-1 py-0.5 rounded"
                style={{
                  background: clayLeads ? 'rgba(61,170,106,0.1)' : 'rgba(255,107,53,0.1)',
                  color: clayLeads ? 'var(--clay-matcha)' : 'var(--clay-tangerine)',
                }}>
                {clayLeads ? `+${gap.toFixed(1)}` : gap.toFixed(1)}pp
              </span>
            </div>
          )}
          {nonClayComps.length === 0 && (
            <span className="text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
              {p.clay_visibility.toFixed(1)}%
            </span>
          )}
          <span className="text-[10px] tabular-nums" style={{ color: 'rgba(26,25,21,0.35)' }}>
            {p.total_responses} resp.
          </span>
        </div>
      </div>

      {/* Expanded response list */}
      {open && (
        <div style={{ padding: '0 12px 10px 20px' }}>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
            <div className="flex items-center gap-2 px-3 py-1.5"
              style={{ background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
              <span style={{ ...LABEL, fontSize: '9px', width: '52px' }}>Platform</span>
              <span style={{ ...LABEL, fontSize: '9px', width: '80px' }}>Date</span>
              <span style={{ ...LABEL, fontSize: '9px' }}>
                Clay mentioned{compName ? ` · ${compName} mentioned` : ''}
              </span>
            </div>
            {visibleResponses.map((r, idx) => (
              <CompResponseRow key={r.id} r={r} compName={compName} defaultOpen={idx < 4} />
            ))}
            {p.responses.length > RESPONSE_LIMIT && (
              <button
                onClick={e => { e.stopPropagation(); setShowAllResponses(v => !v) }}
                className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                style={{ color: 'rgba(26,25,21,0.45)', background: 'none', borderTop: '1px solid rgba(26,25,21,0.07)', cursor: 'pointer' }}
              >
                {showAllResponses ? 'Show fewer ↑' : `Show all ${p.responses.length} responses ↓`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Topic battle row (new visual) ──────────────────────────────────────────────
const PROMPT_LIMIT = 10

interface MergedRow {
  pmm_use_case: string
  clay_visibility: number
  byComp: Record<string, number>
  total_responses: number
}

function TopicBattleRow({
  row,
  selected,
  nonClayComps,
  globalMax,
  onExpand,
  prompts,
  loading,
}: {
  row: MergedRow
  selected: string
  nonClayComps: string[]
  globalMax: number
  onExpand: () => void
  prompts: PMMCompPromptRow[] | null
  loading: boolean
}) {
  const [open, setOpen] = useState(false)
  const [showAllPrompts, setShowAllPrompts] = useState(false)

  function handleClick() {
    if (!open && !prompts) onExpand()
    setOpen(v => !v)
  }

  // Primary competitor for gap badge = selected (if not Clay), else first competitor
  const primaryComp = selected !== 'Clay' ? selected : nonClayComps[0] ?? null
  const primaryVal = primaryComp ? (row.byComp[primaryComp] ?? 0) : null
  const gap = primaryVal !== null ? row.clay_visibility - primaryVal : null
  const clayLeads = gap !== null ? gap > 0 : null

  const scale = (val: number) => `${Math.min(100, (val / Math.max(globalMax, 1)) * 100)}%`

  const visiblePrompts = showAllPrompts ? (prompts ?? []) : (prompts ?? []).slice(0, PROMPT_LIMIT)

  return (
    <div style={{
      borderBottom: '1px solid var(--clay-border)',
      borderLeft: `3px solid ${clayLeads === null ? 'transparent' : clayLeads ? 'var(--clay-matcha)' : 'var(--clay-tangerine)'}`,
    }}>
      {/* Topic header — click to expand prompts */}
      <div
        className="px-4 py-3 cursor-pointer hover:bg-[rgba(26,25,21,0.01)] transition-colors"
        onClick={handleClick}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0">
              {open
                ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />
                : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.4)' }} />}
            </div>
            <span className="text-[13px] font-semibold truncate" style={{ color: 'var(--clay-black)' }}>
              {row.pmm_use_case}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold tabular-nums shrink-0"
              style={{ background: 'rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)' }}>
              {row.total_responses.toLocaleString()} resp.
            </span>
          </div>

          {/* Gap badge */}
          {gap !== null && (
            <span className="text-[10px] font-bold px-2 py-1 rounded shrink-0"
              style={{
                background: clayLeads ? 'rgba(61,170,106,0.1)' : 'rgba(255,107,53,0.1)',
                color: clayLeads ? 'var(--clay-matcha)' : 'var(--clay-tangerine)',
                border: `1px solid ${clayLeads ? 'rgba(61,170,106,0.2)' : 'rgba(255,107,53,0.2)'}`,
              }}>
              {clayLeads
                ? `Clay leads +${gap.toFixed(1)}pp`
                : `Clay trails −${Math.abs(gap).toFixed(1)}pp`}
              {primaryComp && nonClayComps.length > 1 && (
                <span className="opacity-60"> vs {primaryComp.length > 8 ? primaryComp.slice(0, 8) + '…' : primaryComp}</span>
              )}
            </span>
          )}
        </div>

        {/* Bar visualization */}
        <div className="space-y-1.5 ml-5">
          {/* Clay bar */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold w-16 shrink-0 truncate" style={{ color: 'var(--clay-black)' }}>Clay</span>
            <div className="flex-1 rounded-full overflow-hidden" style={{ height: '7px', background: 'rgba(26,25,21,0.07)' }}>
              <div className="h-full rounded-full transition-all duration-300"
                style={{ width: scale(row.clay_visibility), background: 'var(--clay-black)' }} />
            </div>
            <span className="text-[12px] font-bold tabular-nums w-11 text-right" style={{ color: 'var(--clay-black)' }}>
              {row.clay_visibility.toFixed(1)}%
            </span>
          </div>

          {/* Competitor bars */}
          {nonClayComps.map((comp, i) => {
            const val = row.byComp[comp] ?? 0
            const color = COMP_COLORS[i % COMP_COLORS.length]
            return (
              <div key={comp} className="flex items-center gap-2">
                <span className="text-[10px] font-semibold w-16 shrink-0 truncate" style={{ color }}>
                  {comp}
                </span>
                <div className="flex-1 rounded-full overflow-hidden" style={{ height: '7px', background: 'rgba(26,25,21,0.07)' }}>
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: scale(val), background: color }} />
                </div>
                <span className="text-[12px] font-semibold tabular-nums w-11 text-right" style={{ color }}>
                  {val.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Expanded: prompt drill-down */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(26,25,21,0.07)', background: 'rgba(26,25,21,0.01)' }}>
          {loading ? (
            <div className="flex items-center gap-2 px-6 py-4 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.4)' }}>
              <div className="w-3 h-3 rounded-full animate-pulse" style={{ background: 'rgba(26,25,21,0.2)' }} />
              Loading prompts…
            </div>
          ) : !prompts || prompts.length === 0 ? (
            <p className="px-6 py-4 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No prompt data for this topic</p>
          ) : (
            <>
              {/* Prompt sub-header */}
              <div className="flex items-center justify-between gap-2 px-5 py-2"
                style={{ background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
                <span style={{ ...LABEL }}>Prompt</span>
                <div className="flex items-center gap-4 shrink-0">
                  {nonClayComps.length > 0 && (
                    <span style={{ ...LABEL, color: COMP_COLORS[Math.max(0, nonClayComps.indexOf(selected)) % COMP_COLORS.length] }}>
                      {selected !== 'Clay' ? selected : nonClayComps[0]} %
                    </span>
                  )}
                  <span style={LABEL}>Clay %</span>
                  <span style={LABEL}>Gap</span>
                  <span style={LABEL}>Resp.</span>
                </div>
              </div>

              {/* Prompt rows sorted by biggest gap vs Clay */}
              {visiblePrompts
                .slice()
                .sort((a, b) => (a.clay_visibility - a.competitor_visibility) - (b.clay_visibility - b.competitor_visibility))
                .map(p => (
                  <CompPromptRow key={p.prompt_id} p={p} selected={selected} nonClayComps={nonClayComps} />
                ))}

              {prompts.length > PROMPT_LIMIT && (
                <button
                  onClick={e => { e.stopPropagation(); setShowAllPrompts(v => !v) }}
                  className="w-full py-2.5 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                  style={{ color: 'rgba(26,25,21,0.45)', background: 'none', borderTop: '1px solid rgba(26,25,21,0.07)', cursor: 'pointer' }}
                >
                  {showAllPrompts ? 'Show fewer ↑' : `Show all ${prompts.length} prompts ↓`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
interface Props {
  allRows: Record<string, PMMCompRow[]>
  selectedComps: string[]
  selected: string
  onDrilldown: (pmmUseCase: string) => Promise<PMMCompPromptRow[]>
}

type SortMode = 'actionable' | 'clay' | 'volume'

export default function CompPMMComparison({ allRows, selectedComps, selected, onDrilldown }: Props) {
  const [drillCache, setDrillCache] = useState<Record<string, PMMCompPromptRow[]>>({})
  const [loadingDrill, setLoadingDrill] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortMode>('actionable')

  const nonClayComps = selectedComps.filter(c => c !== 'Clay')

  async function handleExpand(pmm: string) {
    if (drillCache[pmm]) return
    setLoadingDrill(pmm)
    const data = await onDrilldown(pmm)
    setDrillCache(prev => ({ ...prev, [pmm]: data }))
    setLoadingDrill(null)
  }

  // Build merged rows
  const allTopics = new Set<string>()
  for (const rows of Object.values(allRows)) {
    for (const r of rows) allTopics.add(r.pmm_use_case)
  }

  const mergedRows: MergedRow[] = Array.from(allTopics).map(topic => {
    const byComp: Record<string, number> = {}
    let clay_visibility = 0
    let total_responses = 0
    for (const [comp, rows] of Object.entries(allRows)) {
      const row = rows.find(r => r.pmm_use_case === topic)
      if (row) {
        byComp[comp] = row.competitor_visibility
        if (row.clay_visibility) clay_visibility = row.clay_visibility
        if (row.total_responses > total_responses) total_responses = row.total_responses
      }
    }
    return { pmm_use_case: topic, byComp, clay_visibility, total_responses }
  })

  // Primary competitor for gap calc
  const primaryComp = selected !== 'Clay' ? selected : nonClayComps[0] ?? null

  const sorted = [...mergedRows].sort((a, b) => {
    if (sortBy === 'actionable' && primaryComp) {
      // Topics where Clay trails most = most actionable = sort ascending by gap
      const gapA = a.clay_visibility - (a.byComp[primaryComp] ?? 0)
      const gapB = b.clay_visibility - (b.byComp[primaryComp] ?? 0)
      return gapA - gapB
    }
    if (sortBy === 'clay') return b.clay_visibility - a.clay_visibility
    return b.total_responses - a.total_responses
  })

  // Global max for consistent bar scaling
  const globalMax = Math.max(
    ...mergedRows.flatMap(r => [r.clay_visibility, ...nonClayComps.map(c => r.byComp[c] ?? 0)]),
    10
  )

  const sortOptions: { key: SortMode; label: string }[] = nonClayComps.length > 0
    ? [{ key: 'actionable', label: 'Most Actionable' }, { key: 'clay', label: 'Clay Visibility' }, { key: 'volume', label: 'Volume' }]
    : [{ key: 'clay', label: 'Clay Visibility' }, { key: 'volume', label: 'Volume' }]

  // Auto-correct sort if no competitor and actionable is selected
  const effectiveSort: SortMode = sortBy === 'actionable' && nonClayComps.length === 0 ? 'clay' : sortBy

  const subtitle = nonClayComps.length > 0
    ? `Expand any topic to drill into the specific prompts driving those numbers. Topics where Clay trails are shown first.`
    : `Clay's visibility by PMM topic. Expand to see prompts.`

  return (
    <div style={CARD} className="overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-4 flex-wrap"
        style={{ borderBottom: '1px solid var(--clay-border)' }}>
        <div>
          <div style={LABEL} className="mb-0.5">Visibility by PMM Topic</div>
          <p className="text-[12px]" style={{ color: 'rgba(26,25,21,0.5)' }}>{subtitle}</p>
        </div>

        {/* Sort tabs */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] font-bold uppercase mr-1" style={{ color: 'rgba(26,25,21,0.35)' }}>Sort:</span>
          {sortOptions.map(s => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              className="text-[10px] font-bold px-2.5 py-1.5 rounded transition-all"
              style={{
                background: (effectiveSort === s.key) ? 'var(--clay-black)' : 'rgba(26,25,21,0.05)',
                color: (effectiveSort === s.key) ? '#fff' : 'rgba(26,25,21,0.5)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend — only when competitors selected */}
      {nonClayComps.length > 0 && (
        <div className="px-4 py-2 flex items-center gap-4 flex-wrap"
          style={{ borderBottom: '1px solid rgba(26,25,21,0.06)', background: 'rgba(26,25,21,0.015)' }}>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--clay-black)' }} />
            <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,25,21,0.6)' }}>Clay</span>
          </div>
          {nonClayComps.map((comp, i) => (
            <div key={comp} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: COMP_COLORS[i % COMP_COLORS.length] }} />
              <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,25,21,0.6)' }}>{comp}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 ml-auto">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-1.5 rounded" style={{ background: 'var(--clay-matcha)', opacity: 0.8 }} />
              <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,25,21,0.45)' }}>Clay leads</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-1.5 rounded" style={{ background: 'var(--clay-tangerine)', opacity: 0.8 }} />
              <span className="text-[10px] font-semibold" style={{ color: 'rgba(26,25,21,0.45)' }}>Clay trails</span>
            </div>
          </div>
        </div>
      )}

      {/* Topic rows */}
      {mergedRows.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
          No PMM topic data available
        </div>
      ) : (
        sorted.map(row => (
          <TopicBattleRow
            key={row.pmm_use_case}
            row={row}
            selected={selected}
            nonClayComps={nonClayComps}
            globalMax={globalMax}
            onExpand={() => handleExpand(row.pmm_use_case)}
            prompts={drillCache[row.pmm_use_case] ?? null}
            loading={loadingDrill === row.pmm_use_case}
          />
        ))
      )}
    </div>
  )
}
