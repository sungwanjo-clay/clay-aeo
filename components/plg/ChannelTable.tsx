'use client'

import { Fragment, useState } from 'react'
import type { DashboardPayload } from '@/lib/plg/load'
import type { ChannelRowData } from '@/lib/plg/compute'
import { DISPLAY_TIERS, UNASSIGNED, UNMATCHED_LABEL } from '@/lib/plg/config'
import { Card, H2, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtSigned } from './ui'
import SectionBar, { Chip } from './SectionBar'

type Mode = 'counts' | 'pct'

const th = 'px-2.5 py-4 text-[12px] font-medium uppercase whitespace-nowrap'

function Cells({ r, mode, kind, prevLabel }: { r: ChannelRowData; mode: Mode; kind: 'group' | 'child' | 'total'; prevLabel: string }) {
  const onDark = kind === 'total'
  const dc = (n: number | null) => (onDark ? '#FFFFFF' : deltaColor(n))
  const tierCell = (n: number) => (mode === 'pct' ? fmtPct(r.cur ? n / r.cur : null, 0) : fmtInt(n))
  return (
    <>
      <td className="px-2.5 py-4 text-right">{fmtInt(r.cur)}</td>
      <td className="px-2.5 py-4 text-right" title={`${prevLabel}: ${fmtInt(r.prev)}`}>{fmtInt(r.prev)}</td>
      <td className="px-2.5 py-4 text-right" style={{ color: dc(r.delta) }}>{r.delta === 0 ? '0' : fmtSigned(r.delta)}</td>
      <td className="px-2.5 py-4 text-right" style={{ color: dc(r.deltaPct) }}>{fmtPctSigned(r.deltaPct)}</td>
      {r.tiers.map((n, i) => <td key={DISPLAY_TIERS[i]} className="px-2.5 py-4 text-right">{tierCell(n)}</td>)}
    </>
  )
}

export default function ChannelTable({ v }: { v: DashboardPayload }) {
  const [mode, setMode] = useState<Mode>('counts')
  const [only, setOnly] = useState<string[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const t = v.table
  const groups = only.length ? t.groups.filter(g => only.includes(g.id)) : t.groups
  // Total of what's shown, so a filtered table still adds up.
  const sumRows = (rs: ChannelRowData[]): ChannelRowData => {
    const cur = rs.reduce((a, r) => a + r.cur, 0), prev = rs.reduce((a, r) => a + r.prev, 0)
    return { key: 'total', label: 'Total', cur, prev, delta: cur - prev, deltaPct: prev ? (cur - prev) / prev : null, tiers: t.total.tiers.map((_, i) => rs.reduce((a, r) => a + (r.tiers[i] ?? 0), 0)) }
  }
  const total = only.length ? sumRows(groups.map(g => g.row)) : t.total
  const prevLabel = v.range.compare === 'previous_year' ? 'Last yr' : 'Prev. period'
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <H2>New workspaces by channel and tier</H2>
          <p className="text-[16px]" style={{ color: T.muted }}>
            Blended attribution, all new workspaces. Tier = SFDC Sales Tier of the customer domain.
          </p>
        </div>
      </div>
      <SectionBar inCard label="Channel table filters">
        <span className="text-[12px] uppercase mr-1" style={{ color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono }}>Channel group</span>
        <Chip on={!only.length} onClick={() => setOnly([])}>All</Chip>
        {t.groups.map(g => <Chip key={g.id} on={only.includes(g.id)} onClick={() => setOnly(o => (o.includes(g.id) ? o.filter(x => x !== g.id) : [...o, g.id]))}>{g.row.label}</Chip>)}
        <Chip on={collapsed} onClick={() => setCollapsed(c => !c)} title="Show only the group rows">Groups only</Chip>
        <span className="sm:ml-auto"><Segmented ariaLabel="Tier columns" value={mode} onChange={setMode}
          options={[{ id: 'counts', label: 'Counts' }, { id: 'pct', label: '% of row' }]} /></span>
      </SectionBar>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[900px] border-collapse text-[15px]" style={{ fontFamily: T.mono, color: T.ink }}>
          <thead>
            <tr style={{ color: T.muted, letterSpacing: '0.12em', borderBottom: `1px solid ${T.border}` }}>
              <th className={`${th} text-left`}>Channel</th>
              <th className={`${th} text-right`}>Selected</th>
              <th className={`${th} text-right`}>{prevLabel}</th>
              <th className={`${th} text-right`}>Δ</th>
              <th className={`${th} text-right`}>%</th>
              {DISPLAY_TIERS.map(x => <th key={x} className={`${th} text-right`} title={x === UNASSIGNED ? 'Customer domain matches no SFDC account with a Sales Tier (mostly personal email)' : undefined}>{x === UNASSIGNED ? UNMATCHED_LABEL : x}</th>)}
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.id}>
                <tr className="font-bold" style={{ background: '#F1F0EC', borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-2.5 py-4 text-left" style={{ fontFamily: 'inherit' }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{g.row.label}</span>
                  </td>
                  <Cells r={g.row} mode={mode} kind="group" prevLabel={prevLabel} />
                </tr>
                {!collapsed && g.children.map(c => (
                  <tr key={c.key} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td className="py-4 pl-8 pr-2.5 text-left whitespace-nowrap" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.label}</td>
                    <Cells r={c} mode={mode} kind="child" prevLabel={prevLabel} />
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="font-bold" style={{ background: T.ink, color: '#FFFFFF' }}>
              <td className="px-2.5 py-4 text-left">{only.length ? 'Total (selected groups)' : 'Total'}</td>
              <Cells r={total} mode={mode} kind="total" prevLabel={prevLabel} />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}
