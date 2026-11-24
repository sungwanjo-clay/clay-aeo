'use client'

import { useEffect, useRef, useState } from 'react'
import { T } from './ui'

/**
 * A section's own filter bar. It sticks under the page's sticky date bar (--plg-sticky) while its section is on
 * screen and scrolls away with the section, so the filters that apply stack: dates on top, then this section's cuts.
 * `inCard`: the bar sits inside a card (tighter bleed, card background), like the Portfolio companies table.
 */
export default function SectionBar({ children, inCard, label, top, barRef }: {
  children: React.ReactNode; inCard?: boolean; label?: string
  /** Where it sticks (default: under the page's sticky date bar). Tabs without that bar stack their own bars with this. */
  top?: string; barRef?: React.Ref<HTMLDivElement>
}) {
  return (
    <div ref={barRef} role="toolbar" aria-label={label ?? 'Section filters'}
      className={`sticky z-30 py-3 flex flex-wrap items-center gap-2 ${inCard ? '-mx-5 sm:-mx-8 px-5 sm:px-8' : '-mx-4 sm:-mx-10 xl:-mx-16 px-4 sm:px-10 xl:px-16'}`}
      style={{ top: top ?? 'var(--plg-sticky, 0px)', background: inCard ? T.card : T.page, borderBottom: `1px solid ${T.border}` }}>
      {children}
    </div>
  )
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  background: on ? T.ink : '#fff', color: on ? '#fff' : T.ink, border: `1px solid ${on ? T.ink : T.border}`,
})

export function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button type="button" aria-pressed={on} title={title} onClick={onClick} className="rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap" style={chipStyle(on)}>{children}</button>
}

/**
 * Multi-select dropdown (checkbox list) that fits in a filter bar. It stays open while you tick options and closes on
 * Done, a click outside, Escape, or scrolling the page (the bar is sticky, so an open list would ride along over the content).
 */
export function MultiSelect({ label, options, value, onChange }: { label: string; options: { id: string; label: string; n?: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const y0 = window.scrollY
    const scroll = () => { if (Math.abs(window.scrollY - y0) > 40) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, { passive: true })
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('scroll', scroll) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(o => !o)}
        className="cursor-pointer rounded-full px-3 py-1.5 text-[13px] select-none" style={chipStyle(value.length > 0)}>
        {label}{value.length ? ` · ${value.length}` : ''} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div role="listbox" aria-multiselectable className="absolute z-40 mt-2 w-[280px] max-w-[calc(100vw-2rem)] rounded-xl shadow-lg flex flex-col" style={{ background: '#fff', border: `1px solid ${T.border}` }}>
          <div className="max-h-[320px] overflow-auto p-2">
            {options.map(o => {
              const on = value.includes(o.id)
              return (
                <label key={o.id} className="flex items-center justify-between gap-2 px-2 py-1.5 text-[13px] rounded-lg cursor-pointer hover:bg-[#F3F2EF]">
                  <span className="flex items-center gap-2"><input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter(x => x !== o.id) : [...value, o.id])} />{o.label}</span>
                  {o.n != null && <span style={{ color: T.faint, fontFamily: T.mono }}>{o.n.toLocaleString('en-US')}</span>}
                </label>
              )
            })}
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderTop: `1px solid ${T.border}` }}>
            <button type="button" className="text-[13px] underline" style={{ color: value.length ? T.muted : T.faint }} disabled={!value.length} onClick={() => onChange([])}>Clear</button>
            <button type="button" className="rounded-full px-3 py-1 text-[13px]" style={{ background: T.ink, color: '#fff' }} onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
