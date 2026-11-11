'use client'

import { ChevronDown } from 'lucide-react'
import { COMPARE_OPTIONS, GRAINS, PRESETS, type PresetId } from '@/lib/plg/range'
import type { CompareMode, Grain } from '@/lib/plg/compute'
import { daysBetween, fmtRange } from '@/lib/plg/dates'
import { Card, Segmented, T } from './ui'

export interface FilterState {
  preset: PresetId | null
  start: string
  end: string
  compare: CompareMode
  grain: Grain
}

export default function FilterCard({
  state, prevStart, prevEnd, dataStart, dataEnd, onChange,
}: {
  state: FilterState
  prevStart: string
  prevEnd: string
  dataStart: string | null
  dataEnd: string
  onChange: (patch: Partial<FilterState>) => void
}) {
  const dateInput = (value: string, onSet: (v: string) => void, label: string) => (
    <input
      type="date"
      aria-label={label}
      value={value}
      min={dataStart ?? undefined}
      max={dataEnd}
      onChange={e => e.target.value && onSet(e.target.value)}
      className="rounded-xl px-3 sm:px-4 py-2.5 text-[15px] focus:outline-none focus:ring-2"
      style={{ border: `1px solid ${T.border}`, background: '#FFF', fontFamily: T.mono, color: T.ink }}
    />
  )
  return (
    <Card className="p-4 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Segmented
          ariaLabel="Date range"
          options={PRESETS.map(p => ({ id: p.id, label: p.label }))}
          value={state.preset}
          onChange={id => onChange({ preset: id })}
        />
        <div className="flex flex-wrap items-center gap-3 text-[15px]" style={{ color: T.muted }}>
          <span>From</span>
          {dateInput(state.start, v => onChange({ preset: null, start: v }), 'Start date')}
          <span>to</span>
          {dateInput(state.end, v => onChange({ preset: null, end: v }), 'End date')}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-[13px] uppercase" style={{ letterSpacing: '0.14em', color: T.muted, fontFamily: T.mono }}>Grain</span>
          <Segmented ariaLabel="Chart grain" options={GRAINS} value={state.grain} onChange={g => onChange({ grain: g })} />
          <label className="flex items-center gap-3 text-[15px]" style={{ color: T.muted }}>
            Compare to
            <span className="relative inline-flex">
              <select
                value={state.compare}
                onChange={e => onChange({ compare: e.target.value as CompareMode })}
                className="appearance-none rounded-xl pl-4 pr-10 py-2.5 text-[15px] cursor-pointer focus:outline-none focus:ring-2"
                style={{ border: `1px solid ${T.border}`, background: '#FFF', fontFamily: T.mono, color: T.ink, minWidth: 220 }}
              >
                {COMPARE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: T.muted }} />
            </span>
          </label>
        </div>
        <p className="text-[15px]" style={{ color: T.ink }}>
          <span style={{ fontFamily: T.mono }}>{fmtRange(state.start, state.end)}</span>
          <span style={{ color: T.muted }}> · {daysBetween(state.start, state.end)} days · vs </span>
          <span style={{ color: T.muted, fontFamily: T.mono }}>{fmtRange(prevStart, prevEnd)}</span>
        </p>
      </div>
    </Card>
  )
}
