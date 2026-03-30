'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown } from 'lucide-react'
import { getPlatformColor } from '@/lib/utils/colors'
import type { PMMCompRow, PMMCompPromptRow } from '@/lib/queries/competitive'

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

function DeltaChip({ delta }: { delta: number }) {
  const pos = delta >= 0
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5"
      style={{ borderRadius: '4px', background: pos ? 'rgba(200,240,64,0.3)' : '#FFE0DD', color: pos ? 'var(--clay-black)' : 'var(--clay-pomegranate)' }}>
      {pos ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {pos ? '+' : ''}{delta.toFixed(1)}%
    </span>
  )
}

// ── Response row ──────────────────────────────────────────────────────────────
function CompResponseRow({ r, selected }: { r: PMMCompPromptRow['responses'][0]; selected: string }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(r.clay_mention_snippet || r.response_text)
  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.04)', background: open ? 'rgba(26,25,21,0.01)' : 'transparent' }}>
      <div
        className="grid items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)]"
        style={{ gridTemplateColumns: '80px 76px 72px 72px 1fr 16px' }}
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-center"
          style={{ background: getPlatformColor(r.platform) + '20', color: getPlatformColor(r.platform) }}>
          {r.platform}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>{r.run_date}</span>
        {/* Competitor mentioned */}
        <span className="text-[10px] font-bold px-1 py-0.5 rounded text-center"
          style={{ background: r.competitor_mentioned ? 'rgba(74,90,255,0.12)' : 'rgba(26,25,21,0.06)', color: r.competitor_mentioned ? '#4A5AFF' : 'rgba(26,25,21,0.4)' }}>
          {selected}: {r.competitor_mentioned ? 'Yes' : 'No'}
        </span>
        {/* Clay mentioned */}
        <span className="text-[10px] font-bold px-1 py-0.5 rounded text-center"
          style={{ background: r.clay_mentioned === 'Yes' ? 'rgba(200,240,64,0.25)' : 'rgba(229,54,42,0.08)', color: r.clay_mentioned === 'Yes' ? 'var(--clay-black)' : 'var(--clay-pomegranate)' }}>
          Clay: {r.clay_mentioned === 'Yes' ? 'Yes' : 'No'}
        </span>
        <div />
        {hasDetail
          ? open ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.35)' }} /> : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.35)' }} />
          : null}
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {r.clay_mention_snippet && (
            <div className="rounded px-2.5 py-2" style={{ background: 'rgba(200,240,64,0.1)', border: '1px solid rgba(200,240,64,0.3)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>Clay mention snippet</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
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

// ── Prompt row inside a topic (div-based to avoid nested table layout issues) ─
function CompPromptRow({ p, selected }: { p: PMMCompPromptRow; selected: string }) {
  const [open, setOpen] = useState(false)
  const COLS = '1fr 80px 80px 80px 72px'

  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
      {/* Main row */}
      <div
        className="grid items-center gap-2 px-3 cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ gridTemplateColumns: COLS, paddingLeft: '20px', paddingTop: '8px', paddingBottom: '8px' }}
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
          <span className="text-[12px] font-medium leading-tight" style={{ color: 'var(--clay-black)' }}>
            {p.prompt_text}
          </span>
        </div>
        <span className="text-right text-[12px] font-bold tabular-nums" style={{ color: '#4A5AFF' }}>
          {p.competitor_visibility.toFixed(1)}%
        </span>
        <span className="text-right text-[12px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {p.clay_visibility.toFixed(1)}%
        </span>
        <div className="flex justify-end">
          <DeltaChip delta={p.delta} />
        </div>
        <span className="text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.45)' }}>
          {p.total_responses}
        </span>
      </div>

      {/* Expanded response list */}
      {open && (
        <div style={{ padding: '0 12px 10px 20px' }}>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
            <div className="grid gap-2 px-3 py-1.5"
              style={{ gridTemplateColumns: '80px 76px 72px 72px 1fr 16px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
              {['Platform', 'Date', selected, 'Clay', 'Snippet', ''].map(h => (
                <span key={h} style={{ ...LABEL, fontSize: '9px' }}>{h}</span>
              ))}
            </div>
            {p.responses.map(r => <CompResponseRow key={r.id} r={r} selected={selected} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Topic row ─────────────────────────────────────────────────────────────────
function CompTopicRow({
  row,
  selected,
  onExpand,
  prompts,
  loading,
}: {
  row: PMMCompRow
  selected: string
  onExpand: () => void
  prompts: PMMCompPromptRow[] | null
  loading: boolean
}) {
  const [open, setOpen] = useState(false)

  function handleClick() {
    if (!open && !prompts) onExpand()
    setOpen(v => !v)
  }

  const compAhead = row.delta > 0

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
        <td className="py-3 px-3 text-right text-[13px] font-bold tabular-nums" style={{ color: '#4A5AFF' }}>
          {row.competitor_visibility.toFixed(1)}%
        </td>
        <td className="py-3 px-3 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {row.clay_visibility.toFixed(1)}%
        </td>
        <td className="py-3 px-3 text-right">
          <DeltaChip delta={row.delta} />
        </td>
        <td className="py-3 px-3 text-right text-[12px] tabular-nums" style={{ color: 'rgba(26,25,21,0.45)' }}>
          {row.total_responses.toLocaleString()}
        </td>
      </tr>

      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
          <td colSpan={5} style={{ padding: '4px 12px 12px 12px' }}>
            {loading ? (
              <p className="px-4 py-3 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.4)' }}>Loading prompts…</p>
            ) : !prompts || prompts.length === 0 ? (
              <p className="px-4 py-3 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>No prompt data</p>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
                <div className="grid px-3 py-1.5"
                  style={{ gridTemplateColumns: '1fr 80px 80px 80px 72px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)', paddingLeft: '20px' }}>
                  {['Prompt', selected, 'Clay', 'Δ', 'Responses'].map((h, i) => (
                    <span key={h} className={i > 0 ? 'text-right' : ''} style={{ ...LABEL, fontSize: '9px' }}>{h}</span>
                  ))}
                </div>
                <div>
                  {prompts.map(p => <CompPromptRow key={p.prompt_id} p={p} selected={selected} />)}
                </div>
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
  rows: PMMCompRow[]
  selected: string
  onDrilldown: (pmmUseCase: string) => Promise<PMMCompPromptRow[]>
  headerSlot?: React.ReactNode
}

export default function CompPMMComparison({ rows, selected, onDrilldown, headerSlot }: Props) {
  const [drillCache, setDrillCache] = useState<Record<string, PMMCompPromptRow[]>>({})
  const [loadingDrill, setLoadingDrill] = useState<string | null>(null)

  async function handleExpand(pmm: string) {
    if (drillCache[pmm]) return
    setLoadingDrill(pmm)
    const data = await onDrilldown(pmm)
    setDrillCache(prev => ({ ...prev, [pmm]: data }))
    setLoadingDrill(null)
  }

  const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }

  return (
    <div style={CARD} className="p-4">
      {headerSlot}
      <div style={LABEL} className="mb-1">Visibility by PMM Topic — {selected} vs Clay</div>
      <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
        Side-by-side visibility scores per topic. Δ = {selected} minus Clay. Expand a row to see which prompts are driving the gap.
      </p>
      {rows.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
          No PMM topic data available
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
              <th className="pb-2 text-left px-4" style={LABEL}>Topic</th>
              <th className="pb-2 text-right px-3" style={{ ...LABEL, color: '#4A5AFF' }}>{selected} %</th>
              <th className="pb-2 text-right px-3" style={LABEL}>Clay %</th>
              <th className="pb-2 text-right px-3" style={LABEL}>Δ</th>
              <th className="pb-2 text-right px-3" style={LABEL}>Responses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <CompTopicRow
                key={row.pmm_use_case}
                row={row}
                selected={selected}
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
