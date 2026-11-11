import type { ReactNode } from 'react'

/** Design tokens for the PLG tab, matched to the Figma mock. */
export const T = {
  page: '#FBFAF7',
  card: '#FFFFFF',
  tile: '#F3F2EF',
  border: 'rgba(26,25,21,0.10)',
  ink: '#1A1915',
  muted: 'rgba(26,25,21,0.62)',
  faint: 'rgba(26,25,21,0.42)',
  pos: '#2F5BEA',        // positive deltas, actual line, on-track
  neg: '#C2410C',        // negative deltas
  zero: 'rgba(26,25,21,0.55)',
  onTrack: '#3B82F6',
  atRisk: '#F5C518',
  behind: '#F97316',
  barTrack: '#E7E5E0',
  amberBg: '#FDF6D8',
  amberInk: '#6B4E00',
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const

export const fmtInt = (n: number | null | undefined) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'))
export const fmtSigned = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtInt(Math.abs(n))
export const fmtPct = (p: number | null | undefined, d = 1) => (p == null ? '–' : `${(p * 100).toFixed(d)}%`)
export const fmtPctSigned = (p: number | null | undefined, d = 1) =>
  p == null ? '–' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(d)}%`
export const fmtPp = (pp: number) => `${pp > 0 ? '+' : pp < 0 ? '−' : ''}${Math.abs(pp).toFixed(1)}pp`
export const fmtK = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)))

export function deltaColor(n: number | null | undefined) {
  if (n == null || n === 0) return T.zero
  return n > 0 ? T.pos : T.neg
}

export function Delta({ value, children }: { value: number | null | undefined; children: ReactNode }) {
  return <span style={{ color: deltaColor(value), fontFamily: T.mono }}>{children}</span>
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[12px] font-medium uppercase ${className}`} style={{ letterSpacing: '0.14em', color: T.muted, fontFamily: T.mono }}>
      {children}
    </p>
  )
}

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={`rounded-[22px] ${className}`} style={{ background: T.card, border: `1px solid ${T.border}`, ...style }}>
      {children}
    </section>
  )
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="text-[22px] sm:text-[26px] font-bold" style={{ color: T.ink, letterSpacing: '-0.03em' }}>{children}</h2>
}

/** Pill-shaped segmented control (tabs, presets, grain, counts/% toggle). */
export function Segmented<V extends string>({
  options, value, onChange, size = 'md', ariaLabel,
}: {
  options: { id: V; label: string; disabled?: boolean; title?: string }[]
  value: V | null
  onChange: (v: V) => void
  size?: 'md' | 'lg'
  ariaLabel: string
}) {
  const pad = size === 'lg' ? 'px-4 sm:px-6 py-2.5 text-[15px] sm:text-[17px]' : 'px-3 sm:px-4 py-2 text-[14px]'
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-full p-1.5 gap-0.5" style={{ background: '#EFEEEA' }}>
      {options.map(o => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={`rounded-full font-medium transition-colors ${pad} disabled:cursor-not-allowed`}
            style={{
              background: active ? (size === 'lg' ? '#E8F6F8' : '#FFFFFF') : 'transparent',
              color: o.disabled ? T.faint : T.ink,
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export function Pill({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'amber' | 'behind' | 'at_risk' | 'on_track'; title?: string }) {
  const styles: Record<string, React.CSSProperties> = {
    neutral: { background: '#FFFFFF', border: `1px solid ${T.border}`, color: T.ink },
    amber: { background: T.amberBg, color: T.amberInk },
    behind: { background: '#FDECEC', color: '#7A1F12' },
    at_risk: { background: '#FDF6D8', color: '#5C4500' },
    on_track: { background: '#E6EEFF', color: '#1E3A8A' },
  }
  return (
    <span title={title} className="inline-flex items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] uppercase"
      style={{ letterSpacing: '0.1em', fontFamily: T.mono, ...styles[tone] }}>
      {children}
    </span>
  )
}
