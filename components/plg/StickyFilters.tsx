'use client'

import { useEffect, useRef, useState } from 'react'
import { COMPARE_OPTIONS, PRESETS } from '@/lib/plg/range'
import type { FilterState } from './FilterCard'
import { T } from './ui'

/**
 * Compact filter bar that pins to the top once the full filter card scrolls out of view: date preset, comparison, the
 * selected dates, and jump links to the tab's sections. Sets --plg-sticky on the page so nested sticky bars (the Media
 * deep dive, Portfolio filters) sit just below it.
 */
export default function StickyFilters({ anchor, state, label, prevLabel, onChange, sections }: {
  /** Element that, while visible, keeps this bar hidden (the full filter card). */
  anchor: React.RefObject<HTMLElement | null>
  state: FilterState
  label: string
  prevLabel: string
  onChange: (patch: Partial<FilterState>) => void
  sections?: { id: string; label: string }[]
}) {
  const [shown, setShown] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = anchor.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [anchor])
  useEffect(() => {
    const h = shown ? bar.current?.offsetHeight ?? 0 : 0
    document.documentElement.style.setProperty('--plg-sticky', `${h}px`)
  }, [shown, sections?.length])
  const sel = 'rounded-full px-3 py-1.5 text-[14px] focus:outline-none focus:ring-2'
  return (
    <div ref={bar} aria-hidden={!shown}
      // Fixed overlay, so showing and hiding it never moves the page.
      className="fixed top-0 inset-x-0 z-40 px-4 sm:px-10 xl:px-16 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 transition-opacity"
      style={{ background: 'rgba(251,250,247,0.96)', backdropFilter: 'blur(6px)', borderBottom: `1px solid ${T.border}`, boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', visibility: shown ? 'visible' : 'hidden' }}>
      <select aria-label="Date range" value={state.preset ?? ''} onChange={e => e.target.value && onChange({ preset: e.target.value as FilterState['preset'] })}
        className={sel} style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
        {!state.preset && <option value="">Custom dates</option>}
        {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <select aria-label="Compare with" value={state.compare} onChange={e => onChange({ compare: e.target.value as FilterState['compare'] })}
        className={sel} style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
        {COMPARE_OPTIONS.map(o => <option key={o.id} value={o.id}>vs {o.label.toLowerCase()}</option>)}
      </select>
      <span className="text-[13px]" style={{ color: T.muted, fontFamily: T.mono }}>{label} · vs {prevLabel}</span>
      {sections && sections.length > 0 && (
        <nav aria-label="Sections" className="flex flex-wrap items-center gap-1 sm:ml-auto">
          {sections.map(s => (
            <a key={s.id} href={`#${s.id}`} onClick={e => {
              e.preventDefault()
              const el = document.getElementById(s.id)
              if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - (bar.current?.offsetHeight ?? 0) - 12, behavior: 'smooth' })
            }}
              className="rounded-full px-3 py-1 text-[13px] font-medium hover:underline" style={{ color: T.ink }}>{s.label}</a>
          ))}
        </nav>
      )}
    </div>
  )
}
