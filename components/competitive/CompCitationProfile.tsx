'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { getCitationTypeColor } from '@/lib/utils/colors'
import { getPlatformColor } from '@/lib/utils/colors'
import type { CitationTypeGroup, CitationItem, CitationPromptRow } from '@/lib/queries/competitive'

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

// ── Response row inside a citation prompt ────────────────────────────────────
function CitationResponseRow({ r }: { r: CitationPromptRow['responses'][0] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid rgba(26,25,21,0.04)', background: open ? 'rgba(26,25,21,0.01)' : 'transparent' }}>
      <div
        className="grid items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[rgba(26,25,21,0.02)]"
        style={{ gridTemplateColumns: '80px 80px 56px 1fr 16px' }}
        onClick={() => setOpen(v => !v)}
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
        {r.clay_mention_snippet
          ? open
            ? <ChevronDown size={10} style={{ color: 'rgba(26,25,21,0.35)' }} />
            : <ChevronRight size={10} style={{ color: 'rgba(26,25,21,0.35)' }} />
          : null}
      </div>
      {open && r.clay_mention_snippet && (
        <div className="px-3 pb-2">
          <div className="rounded px-2.5 py-2" style={{ background: 'rgba(200,240,64,0.1)', border: '1px solid rgba(200,240,64,0.3)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'rgba(26,25,21,0.45)' }}>Clay mention snippet</p>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--clay-black)' }}>
              &ldquo;{stripMarkdown(r.clay_mention_snippet)}&rdquo;
            </p>
          </div>
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
        <td className="px-3 py-2.5 text-right text-[12px] font-bold tabular-nums" style={{ color: 'rgba(26,25,21,0.5)' }}>
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
              {p.responses.map(r => <CitationResponseRow key={r.id} r={r} />)}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Citation URL row inside a type group ─────────────────────────────────────
function CitationURLRow({
  item,
  onExpand,
  prompts,
  loadingPrompts,
}: {
  item: CitationItem
  onExpand: () => void
  prompts: CitationPromptRow[] | null
  loadingPrompts: boolean
}) {
  const [open, setOpen] = useState(false)
  const canDrill = item.response_ids.length > 0

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
          borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.04)',
          background: open ? 'rgba(26,25,21,0.01)' : 'transparent',
        }}
      >
        {/* URL + title */}
        <td className="py-2.5 pl-4 pr-2" style={{ maxWidth: '360px' }}>
          {item.title && (
            <p className="text-[12px] font-semibold mb-0.5" style={{ color: 'var(--clay-black)' }}>{item.title}</p>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 group"
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={9} className="opacity-40 group-hover:opacity-70 shrink-0" />
            <span className="text-[10px] truncate group-hover:underline" style={{ color: 'rgba(26,25,21,0.45)', maxWidth: '300px' }}>
              {item.url}
            </span>
          </a>
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
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.04)' }}>
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

// ── Citation type group row ────────────────────────────────────────────────────
function CitationTypeRow({
  group,
  onLoadPrompts,
  promptCache,
  loadingPrompts,
}: {
  group: CitationTypeGroup
  onLoadPrompts: (url: string, responseIds: string[]) => void
  promptCache: Record<string, CitationPromptRow[]>
  loadingPrompts: string | null
}) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const color = getCitationTypeColor(group.citation_type)
  const visible = showAll ? group.citations : group.citations.slice(0, 8)

  return (
    <React.Fragment>
      <tr
        onClick={() => setOpen(v => !v)}
        className="cursor-pointer hover:bg-[rgba(26,25,21,0.02)] transition-colors"
        style={{ background: `${color}08`, borderBottom: open ? 'none' : '1px solid rgba(26,25,21,0.07)' }}
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            {open
              ? <ChevronDown size={12} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
              : <ChevronRight size={12} style={{ color: 'rgba(26,25,21,0.4)', flexShrink: 0 }} />}
            <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
              style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
              {group.citation_type}
            </span>
          </div>
        </td>
        <td className="py-3 px-3 text-right text-[13px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
          {group.total.toLocaleString()}
        </td>
        <td className="py-3 px-2" style={{ width: '28px' }} />
      </tr>

      {open && (
        <tr style={{ borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
          <td colSpan={3} style={{ padding: '4px 12px 10px 12px' }}>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(26,25,21,0.08)' }}>
              {/* Sub-header */}
              <div className="grid px-3 py-1.5"
                style={{ gridTemplateColumns: '1fr 72px 28px', background: 'rgba(26,25,21,0.03)', borderBottom: '1px solid rgba(26,25,21,0.07)' }}>
                <span style={{ ...LABEL, fontSize: '9px' }}>Content / URL</span>
                <span className="text-right" style={{ ...LABEL, fontSize: '9px' }}>Cited</span>
                <span />
              </div>
              <table className="w-full">
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
              {group.citations.length > 8 && (
                <button
                  onClick={e => { e.stopPropagation(); setShowAll(v => !v) }}
                  className="w-full py-2 text-[10px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
                  style={{ borderTop: '1px solid rgba(26,25,21,0.06)', color: 'rgba(26,25,21,0.4)' }}
                >
                  {showAll ? `Show top 8 ↑` : `Show all ${group.citations.length} URLs ↓`}
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  groups: CitationTypeGroup[]
  selected: string
  onLoadPrompts: (url: string, responseIds: string[]) => Promise<void>
  promptCache: Record<string, CitationPromptRow[]>
  loadingPrompts: string | null
}

export default function CompCitationProfile({ groups, selected, onLoadPrompts, promptCache, loadingPrompts }: Props) {
  const CARD = { background: '#FFFFFF', border: '1px solid var(--clay-border)', borderRadius: '8px' }

  if (groups.length === 0) {
    return (
      <div style={CARD} className="p-4">
        <div style={LABEL} className="mb-1">Citation Profile — {selected}</div>
        <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
          Top content from {selected}'s domain cited by AI, grouped by citation type.
        </p>
        <div className="flex items-center justify-center py-10 text-[13px]" style={{ color: 'rgba(26,25,21,0.35)' }}>
          No citation data found for {selected}
        </div>
      </div>
    )
  }

  return (
    <div style={CARD} className="p-4">
      <div style={LABEL} className="mb-1">Citation Profile — {selected}</div>
      <p className="text-xs mb-4" style={{ color: 'rgba(26,25,21,0.45)' }}>
        Content from {selected}'s domain cited by AI models, grouped by type. Expand a type → URL → prompts → responses.
      </p>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--clay-border)' }}>
            <th className="pb-2 text-left px-4" style={LABEL}>Citation Type / Content</th>
            <th className="pb-2 text-right px-3" style={LABEL}>Total Citations</th>
            <th style={{ width: '28px' }} />
          </tr>
        </thead>
        <tbody>
          {groups.map(group => (
            <CitationTypeRow
              key={group.citation_type}
              group={group}
              onLoadPrompts={onLoadPrompts}
              promptCache={promptCache}
              loadingPrompts={loadingPrompts}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
