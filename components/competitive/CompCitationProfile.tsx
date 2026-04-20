'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { getCitationTypeColor } from '@/lib/utils/colors'
import { getPlatformColor } from '@/lib/utils/colors'
import type { CitationFlatItem, CitationPromptRow } from '@/lib/queries/competitive'

const LABEL = {
  color: 'rgba(26,25,21,0.45)',
  fontSize: '10px',
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
}

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

// ── Full response expandable block ────────────────────────────────────────────
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

// ── Response row inside a citation prompt ─────────────────────────────────────
function CitationResponseRow({ r, defaultOpen = false }: { r: CitationPromptRow['responses'][0]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const hasDetail = !!r.clay_mention_snippet
  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.04)', background: open ? 'rgba(26,25,21,0.01)' : 'transparent' }}>
      <div
        className="grid items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)]"
        style={{ gridTemplateColumns: '80px 80px 56px 1fr 16px' }}
        onClick={() => hasDetail && setOpen(v => !v)}
      >
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-center"
          style={{ background: getPlatformColor(r.platform) + '20', color: getPlatformColor(r.platform) }}>
          {r.platform}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>{r.run_date}</span>
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-center"
          style={{
            background: r.clay_mentioned === 'Yes' ? 'rgba(200,240,64,0.25)' : 'rgba(229,54,42,0.08)',
            color: r.clay_mentioned === 'Yes' ? 'var(--clay-black)' : 'var(--clay-pomegranate)',
          }}>
          {r.clay_mentioned === 'Yes' ? 'Clay ✓' : 'Clay —'}
        </span>
        <div />
        {hasDetail
          ? open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.35)' }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.35)' }} />
          : null}
      </div>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {r.clay_mention_snippet && (
            <div className="rounded px-2.5 py-2"
              style={{ background: 'rgba(200,240,64,0.1)', border: '1px solid rgba(200,240,64,0.3)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: 'rgba(26,25,21,0.45)' }}>Clay mention snippet</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
                &ldquo;{stripMarkdown(r.clay_mention_snippet)}&rdquo;
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Prompt row inside a citation URL ─────────────────────────────────────────
function CitationPromptBlock({ p }: { p: CitationPromptRow }) {
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
              ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
              : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
            <span className="text-[12px] font-medium" style={{ color: 'var(--clay-black)' }}>{p.prompt_text}</span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-right text-[12px] font-bold tabular-nums"
          style={{ color: 'rgba(26,25,21,0.5)' }}>
          {p.responses.length}
        </td>
      </tr>
      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
          <td colSpan={2} style={{ padding: '0 12px 10px 20px' }}>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
              <div className="grid gap-2 px-3 py-1.5"
                style={{ gridTemplateColumns: '80px 80px 56px 1fr 16px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                {['Platform', 'Date', 'Clay', 'Snippet', ''].map(h => (
                  <span key={h} style={{ ...LABEL, fontSize: '9px' }}>{h}</span>
                ))}
              </div>
              {p.responses.map((r, idx) => <CitationResponseRow key={r.id} r={r} defaultOpen={idx < 4} />)}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Citation URL row (flat, no type grouping) ─────────────────────────────────
function CitationURLRow({
  item,
  onExpand,
  prompts,
  loadingPrompts,
}: {
  item: CitationFlatItem
  onExpand: () => void
  prompts: CitationPromptRow[] | null
  loadingPrompts: boolean
}) {
  const [open, setOpen] = useState(false)
  const canDrill = item.response_ids.length > 0
  const typeColor = getCitationTypeColor(item.citation_type)

  function handleClick() {
    if (!open && canDrill && !prompts) onExpand()
    setOpen(v => !v)
  }

  return (
    <React.Fragment>
      <tr
        onClick={handleClick}
        className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{
          borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.06)',
          background: open ? 'rgba(26,25,21,0.01)' : 'transparent',
        }}
      >
        {/* Type badge + URL + title */}
        <td className="py-2.5 pl-4 pr-2" style={{ maxWidth: '360px' }}>
          <div className="flex items-start gap-2">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5"
              style={{ background: `${typeColor}20`, color: typeColor, border: `1px solid ${typeColor}40` }}>
              {item.citation_type}
            </span>
            <div className="min-w-0">
              {item.title && (
                <p className="text-[12px] font-semibold mb-0.5 truncate" style={{ color: 'var(--clay-black)' }}>{item.title}</p>
              )}
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 group"
                onClick={e => e.stopPropagation()}
              >
                <ExternalLink size={9} className="opacity-40 group-hover:opacity-70 shrink-0" />
                <span className="text-[10px] truncate group-hover:underline"
                  style={{ color: 'rgba(26,25,21,0.45)', maxWidth: '300px' }}>
                  {item.url}
                </span>
              </a>
            </div>
          </div>
        </td>
        {/* Count */}
        <td className="py-2.5 px-3 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {item.count.toLocaleString()}
        </td>
        {/* Expand */}
        <td className="py-2.5 px-2 text-center" style={{ width: '28px' }}>
          {canDrill && (
            open
              ? <ChevronDown size={11} style={{ color: 'rgba(26,25,21,0.4)' }} />
              : <ChevronRight size={11} style={{ color: 'rgba(26,25,21,0.4)' }} />
          )}
        </td>
      </tr>
      {open && canDrill && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.06)' }}>
          <td colSpan={3} style={{ padding: '4px 12px 10px 32px' }}>
            {loadingPrompts ? (
              <p className="text-[11px] py-2" style={{ color: 'rgba(26,25,21,0.4)' }}>Loading prompts…</p>
            ) : !prompts || prompts.length === 0 ? (
              <p className="text-[11px] py-2" style={{ color: 'rgba(26,25,21,0.35)' }}>No prompt data found</p>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
                <div className="grid px-3 py-1.5"
                  style={{ gridTemplateColumns: '1fr 72px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                  <span style={{ ...LABEL, fontSize: '9px' }}>Prompt</span>
                  <span className="text-right" style={{ ...LABEL, fontSize: '9px' }}>Responses</span>
                </div>
                <table className="w-full">
                  <tbody>
                    {prompts.map(p => <CitationPromptBlock key={p.prompt_id} p={p} />)}
                  </tbody>
                </table>
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
  citations: CitationFlatItem[]
  selected: string
  onLoadPrompts: (url: string, responseIds: string[]) => Promise<void>
  promptCache: Record<string, CitationPromptRow[]>
  loadingPrompts: string | null
  headerSlot?: React.ReactNode
}

export default function CompCitationProfile({ citations, selected, onLoadPrompts, promptCache, loadingPrompts, headerSlot }: Props) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? citations : citations.slice(0, 15)
  const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }

  if (citations.length === 0) {
    return (
      <div style={CARD} className="p-4">
        {headerSlot}
        <div style={LABEL} className="mb-1">Citation Profile — {selected}</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Top content from {selected}&apos;s domain cited by AI.
        </p>
        <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
          No citation data found for {selected}
        </div>
      </div>
    )
  }

  return (
    <div style={CARD} className="p-4">
      {headerSlot}
      <div style={LABEL} className="mb-1">Citation Profile — {selected}</div>
      <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
        Content from {selected}&apos;s domain cited by AI models. Expand a URL to see the prompts and responses that drove the citation.
      </p>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
            <th className="pb-2 text-left px-4" style={LABEL}>Content / URL</th>
            <th className="pb-2 text-right px-3" style={LABEL}>Times Cited</th>
            <th style={{ width: '28px' }} />
          </tr>
        </thead>
        <tbody>
          {visible.map(item => (
            <CitationURLRow
              key={item.url}
              item={item}
              onExpand={() => onLoadPrompts(item.url, item.response_ids)}
              prompts={promptCache[item.url] ?? null}
              loadingPrompts={loadingPrompts === item.url}
            />
          ))}
        </tbody>
      </table>
      {citations.length > 15 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="w-full mt-2 py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
          style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)' }}
        >
          {showAll ? 'Show top 15 ↑' : `Show all ${citations.length} URLs ↓`}
        </button>
      )}
    </div>
  )
}
