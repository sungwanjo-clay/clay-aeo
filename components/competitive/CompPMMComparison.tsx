'use client'

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
      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
        style={{ color: 'rgba(26,25,21,0.45)' }}>Full AI Response</p>
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

// ── Response row ──────────────────────────────────────────────────────────────
function CompResponseRow({ r, selected }: { r: PMMCompPromptRow['responses'][0]; selected: string }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(r.clay_mention_snippet || r.response_text)
  const clayYes = r.clay_mentioned === 'Yes'
  const compYes = r.competitor_mentioned
  const showComp = selected !== 'Clay'

  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.05)' }}>
      <div
        className={`flex items-center gap-3 px-3 py-2.5 ${hasDetail ? 'cursor-pointer hover:bg-[rgba(26,25,21,0.02)]' : ''} transition-colors`}
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        {/* Platform badge */}
        <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
          style={{ background: getPlatformColor(r.platform) + '20', color: getPlatformColor(r.platform), minWidth: '52px', textAlign: 'center' }}>
          {r.platform}
        </span>

        {/* Date */}
        <span className="text-[11px] tabular-nums shrink-0 w-20" style={{ color: 'rgba(26,25,21,0.45)' }}>
          {r.run_date}
        </span>

        {/* Clay mention indicator */}
        <div className="flex items-center gap-1.5">
          <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded`}
            style={{
              background: clayYes ? 'rgba(200,240,64,0.2)' : 'rgba(229,54,42,0.07)',
              color: clayYes ? 'var(--clay-positive-text)' : 'var(--clay-pomegranate)',
              border: `1px solid ${clayYes ? 'rgba(200,240,64,0.5)' : 'rgba(229,54,42,0.2)'}`,
            }}>
            <span>{clayYes ? '✓' : '✗'}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide">Clay</span>
          </div>

          {/* Competitor mention indicator — only when a non-Clay competitor is selected */}
          {showComp && (
            <div className={`flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded`}
              style={{
                background: compYes ? 'rgba(74,90,255,0.1)' : 'rgba(26,25,21,0.05)',
                color: compYes ? '#4A5AFF' : 'rgba(26,25,21,0.35)',
                border: `1px solid ${compYes ? 'rgba(74,90,255,0.25)' : 'rgba(26,25,21,0.1)'}`,
              }}>
              <span>{compYes ? '✓' : '✗'}</span>
              <span className="text-[9px] font-bold uppercase tracking-wide truncate" style={{ maxWidth: '64px' }}>{selected}</span>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Expand hint */}
        {hasDetail && (
          <span className="text-[10px] font-semibold shrink-0" style={{ color: 'rgba(26,25,21,0.3)' }}>
            {open ? '↑' : 'View response ↓'}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {open && (
        <div className="px-3 pb-3 space-y-2" style={{ borderTop: '1px solid rgba(26,25,21,0.05)', background: 'rgba(26,25,21,0.01)' }}>
          {r.clay_mention_snippet && (
            <div className="rounded-lg px-3 py-2 mt-2"
              style={{ background: 'rgba(200,240,64,0.08)', border: '1px solid rgba(200,240,64,0.25)' }}>
              <p className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>
                How Clay was mentioned
              </p>
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

// ── Prompt row inside a topic ─────────────────────────────────────────────────
const PROMPT_LIMIT = 10

function CompPromptRow({ p, selected, nonClayComps }: { p: PMMCompPromptRow; selected: string; nonClayComps: string[] }) {
  const [open, setOpen] = useState(false)
  const [showAllResponses, setShowAllResponses] = useState(false)

  const compColor = nonClayComps.length > 0
    ? COMP_COLORS[nonClayComps.indexOf(selected) % COMP_COLORS.length]
    : COMP_COLORS[0]

  const visibleResponses = showAllResponses ? p.responses : p.responses.slice(0, PROMPT_LIMIT)

  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
      {/* Prompt header row */}
      <div
        className="grid items-center gap-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ gridTemplateColumns: '1fr 72px 72px 64px', padding: '8px 12px 8px 16px' }}
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
          <span className="text-[12px] font-medium leading-tight truncate" style={{ color: 'var(--clay-black)' }}>
            {p.prompt_text}
          </span>
        </div>
        <span className="text-right text-[12px] font-bold tabular-nums" style={{ color: compColor }}>
          {p.competitor_visibility.toFixed(1)}%
        </span>
        <span className="text-right text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {p.clay_visibility.toFixed(1)}%
        </span>
        <span className="text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.45)' }}>
          {p.total_responses}
        </span>
      </div>

      {/* Expanded response list */}
      {open && (
        <div style={{ padding: '0 12px 10px 16px' }}>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
            {/* Response sub-header */}
            <div className="flex items-center gap-2 px-3 py-1.5"
              style={{ background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
              <span style={{ ...LABEL, fontSize: '9px', width: '52px' }}>Platform</span>
              <span style={{ ...LABEL, fontSize: '9px', width: '80px' }}>Date</span>
              <span style={{ ...LABEL, fontSize: '9px' }}>Clay mentioned · Competitor mentioned</span>
            </div>
            {visibleResponses.map(r => <CompResponseRow key={r.id} r={r} selected={selected} />)}
            {p.responses.length > PROMPT_LIMIT && (
              <button
                onClick={e => { e.stopPropagation(); setShowAllResponses(v => !v) }}
                className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                style={{ color: 'rgba(26,25,21,0.45)', background: 'none', borderTop: '1px solid rgba(26,25,21,0.07)', cursor: 'pointer' }}
              >
                {showAllResponses
                  ? 'Show fewer ↑'
                  : `Show all ${p.responses.length} responses ↓`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Topic row ─────────────────────────────────────────────────────────────────
const TOPIC_PROMPT_LIMIT = 10

function CompTopicRow({
  row,
  selected,
  nonClayComps,
  onExpand,
  prompts,
  loading,
  extraCols,
}: {
  row: { pmm_use_case: string; total_responses: number; byComp: Record<string, number>; clay_visibility: number }
  selected: string
  nonClayComps: string[]
  onExpand: () => void
  prompts: PMMCompPromptRow[] | null
  loading: boolean
  extraCols: string[] // non-Clay competitors to show columns for
}) {
  const [open, setOpen] = useState(false)
  const [showAllPrompts, setShowAllPrompts] = useState(false)

  function handleClick() {
    if (!open && !prompts) onExpand()
    setOpen(v => !v)
  }

  const visiblePrompts = showAllPrompts ? (prompts ?? []) : (prompts ?? []).slice(0, TOPIC_PROMPT_LIMIT)

  return (
    <React.Fragment>
      <tr
        onClick={handleClick}
        className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.06)' }}
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {open
              ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.35)', flexShrink: 0 }} />}
            <span className="text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
              {row.pmm_use_case}
            </span>
          </div>
        </td>
        {/* Per non-Clay competitor columns */}
        {extraCols.map((comp, i) => (
          <td key={comp} className="py-3 px-3 text-right text-[13px] font-bold tabular-nums"
            style={{ color: COMP_COLORS[i % COMP_COLORS.length] }}>
            {(row.byComp[comp] ?? 0).toFixed(1)}%
          </td>
        ))}
        {/* Clay column */}
        <td className="py-3 px-3 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {row.clay_visibility.toFixed(1)}%
        </td>
        <td className="py-3 px-3 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.45)' }}>
          {row.total_responses.toLocaleString()}
        </td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
          <td colSpan={extraCols.length + 3} style={{ padding: '4px 12px 12px 12px' }}>
            {loading ? (
              <p className="px-4 py-3 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.4)' }}>Loading prompts…</p>
            ) : !prompts || prompts.length === 0 ? (
              <p className="px-4 py-3 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No prompt data</p>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
                {/* Prompt sub-header — same grid as CompPromptRow */}
                <div className="grid items-center gap-2"
                  style={{ gridTemplateColumns: '1fr 72px 72px 64px', padding: '6px 12px 6px 16px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                  <span style={LABEL}>Prompt</span>
                  <span className="text-right" style={{ ...LABEL, color: COMP_COLORS[Math.max(0, nonClayComps.indexOf(selected)) % COMP_COLORS.length] }}>{selected} %</span>
                  <span className="text-right" style={LABEL}>Clay %</span>
                  <span className="text-right" style={LABEL}>Responses</span>
                </div>
                <div>
                  {visiblePrompts.map(p => (
                    <CompPromptRow key={p.prompt_id} p={p} selected={selected} nonClayComps={nonClayComps} />
                  ))}
                </div>
                {prompts.length > TOPIC_PROMPT_LIMIT && (
                  <button
                    onClick={e => { e.stopPropagation(); setShowAllPrompts(v => !v) }}
                    className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                    style={{ color: 'rgba(26,25,21,0.45)', background: 'none', borderTop: '1px solid rgba(26,25,21,0.07)', cursor: 'pointer' }}
                  >
                    {showAllPrompts
                      ? 'Show fewer prompts ↑'
                      : `Show all ${prompts.length} prompts ↓`}
                  </button>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  allRows: Record<string, PMMCompRow[]>
  selectedComps: string[]
  selected: string   // activeComp for drilldown
  onDrilldown: (pmmUseCase: string) => Promise<PMMCompPromptRow[]>
}

export default function CompPMMComparison({ allRows, selectedComps, selected, onDrilldown }: Props) {
  const [drillCache, setDrillCache] = useState<Record<string, PMMCompPromptRow[]>>({})
  const [loadingDrill, setLoadingDrill] = useState<string | null>(null)

  async function handleExpand(pmm: string) {
    if (drillCache[pmm]) return
    setLoadingDrill(pmm)
    const data = await onDrilldown(pmm)
    setDrillCache(prev => ({ ...prev, [pmm]: data }))
    setLoadingDrill(null)
  }

  // Columns: non-Clay competitors + Clay
  const nonClayComps = selectedComps.filter(c => c !== 'Clay')

  // Merge all topics across all loaded competitors
  const allTopics = new Set<string>()
  for (const rows of Object.values(allRows)) {
    for (const r of rows) allTopics.add(r.pmm_use_case)
  }

  // Build merged rows: one per topic with per-competitor visibility + Clay vis
  const mergedRows = Array.from(allTopics).map(topic => {
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
    // Primary sort: selected competitor visibility (or clay if selected is Clay)
    const sortVal = byComp[selected] ?? clay_visibility
    return { pmm_use_case: topic, byComp, clay_visibility, total_responses, sortVal }
  }).sort((a, b) => b.sortVal - a.sortVal)

  const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }

  const subtitle = nonClayComps.length > 0
    ? `Visibility scores per PMM topic. Expand a topic to see which prompts are driving the gap.`
    : `Clay's visibility per PMM topic. Expand a topic to see prompts.`

  return (
    <div style={CARD} className="p-4">
      <div style={LABEL} className="mb-1">
        Visibility by PMM Topic — {nonClayComps.length > 0 ? `${nonClayComps.join(', ')} vs Clay` : 'Clay'}
      </div>
      <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>{subtitle}</p>

      {mergedRows.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
          No PMM topic data available
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
              <th className="pb-2 text-left px-4" style={LABEL}>Topic</th>
              {nonClayComps.map((comp, i) => (
                <th key={comp} className="pb-2 text-right px-3" style={{ ...LABEL, color: COMP_COLORS[i % COMP_COLORS.length] }}>
                  {comp} %
                </th>
              ))}
              <th className="pb-2 text-right px-3" style={LABEL}>Clay %</th>
              <th className="pb-2 text-right px-3" style={LABEL}>Responses</th>
            </tr>
          </thead>
          <tbody>
            {mergedRows.map(row => (
              <CompTopicRow
                key={row.pmm_use_case}
                row={row}
                selected={selected}
                nonClayComps={nonClayComps}
                extraCols={nonClayComps}
                onExpand={() => handleExpand(row.pmm_use_case)}
                prompts={drillCache[row.pmm_use_case] ?? null}
                loading={loadingDrill === row.pmm_use_case}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
