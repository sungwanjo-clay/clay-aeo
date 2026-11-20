'use client'

import { T } from './ui'

/**
 * A section's own filter bar. It sticks under the page's sticky date bar (--plg-sticky) while its section is on
 * screen and scrolls away with the section, so the filters that apply stack: dates on top, then this section's cuts.
 * `inCard`: the bar sits inside a card (tighter bleed, card background), like the Portfolio companies table.
 */
export default function SectionBar({ children, inCard, label }: { children: React.ReactNode; inCard?: boolean; label?: string }) {
  return (
    <div role="toolbar" aria-label={label ?? 'Section filters'}
      className={`sticky z-30 py-3 flex flex-wrap items-center gap-2 ${inCard ? '-mx-5 sm:-mx-8 px-5 sm:px-8' : '-mx-4 sm:-mx-10 xl:-mx-16 px-4 sm:px-10 xl:px-16'}`}
      style={{ top: 'var(--plg-sticky, 0px)', background: inCard ? T.card : T.page, borderBottom: `1px solid ${T.border}` }}>
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

/** Multi-select dropdown (checkbox list) that fits in a filter bar. */
export function MultiSelect({ label, options, value, onChange }: { label: string; options: { id: string; label: string; n?: number }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <details className="relative">
      <summary className="list-none cursor-pointer rounded-full px-3 py-1.5 text-[13px] select-none" style={chipStyle(value.length > 0)}>
        {label}{value.length ? ` · ${value.length}` : ''} ▾
      </summary>
      <div className="absolute z-40 mt-2 w-[280px] max-h-[360px] overflow-auto rounded-xl p-2 shadow-lg" style={{ background: '#fff', border: `1px solid ${T.border}` }}>
        {value.length > 0 && <button type="button" className="w-full text-left px-2 py-1.5 text-[13px] underline" style={{ color: T.muted }} onClick={() => onChange([])}>Clear</button>}
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
    </details>
  )
}
