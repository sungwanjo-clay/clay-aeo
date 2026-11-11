'use client'

import { Fragment, useState } from 'react'
import type { DashboardPayload } from '@/lib/plg/load'
import type { ChannelRowData } from '@/lib/plg/compute'
import { paceStatus } from '@/lib/plg/compute'
import { TIERS } from '@/lib/plg/config'
import { PaceBar } from './TierPacing'
import { Card, H2, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtSigned } from './ui'

type Mode = 'counts' | 'pct'

const th = 'px-2.5 py-4 text-[12px] font-medium uppercase whitespace-nowrap'

function Cells({ r, mode, kind, prevLabel }: { r: ChannelRowData; mode: Mode; kind: 'group' | 'child' | 'total'; prevLabel: string }) {
  const onDark = kind === 'total'
  const dc = (n: number | null) => (onDark ? '#FFFFFF' : deltaColor(n))
  const tierCell = (n: number) => (mode === 'pct' ? fmtPct(r.cur ? n / r.cur : null, 0) : fmtInt(n))
  const showGoal = kind !== 'child'
  return (
    <>
      <td className="px-2.5 py-4 text-right">{fmtInt(r.cur)}</td>
      <td className="px-2.5 py-4 text-right" title={`${prevLabel}: ${fmtInt(r.prev)}`}>{fmtInt(r.prev)}</td>
      <td className="px-2.5 py-4 text-right" style={{ color: dc(r.delta) }}>{r.delta === 0 ? '0' : fmtSigned(r.delta)}</td>
      <td className="px-2.5 py-4 text-right" style={{ color: dc(r.deltaPct) }}>{fmtPctSigned(r.deltaPct)}</td>
      <td className="px-2.5 py-4 text-right">{showGoal ? (r.goal != null ? fmtInt(r.goal) : '–') : ''}</td>
      <td className="px-2.5 py-4">
        {showGoal && r.vsGoal != null && kind !== 'total' && (
          <PaceBar pct={r.vsGoal} status={paceStatus(r.vsGoal)} width="110px" />
        )}
      </td>
      <td className="px-2.5 py-4 text-right">{showGoal && r.vsGoal != null ? fmtPct(r.vsGoal, 0) : ''}</td>
      {r.tiers.map((n, i) => <td key={TIERS[i]} className="px-2.5 py-4 text-right">{tierCell(n)}</td>)}
    </>
  )
}

export default function ChannelTable({ v }: { v: DashboardPayload }) {
  const [mode, setMode] = useState<Mode>('counts')
  const t = v.table
  const prevLabel = v.range.compare === 'previous_year' ? 'Last yr' : 'Prev. period'
  return (
    <Card className="p-5 sm:p-10 flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <H2>New workspaces by channel and tier</H2>
          <p className="text-[16px]" style={{ color: T.muted }}>
            Blended attribution. Goals set at channel-group level and prorated to the selected dates.
          </p>
        </div>
        <Segmented ariaLabel="Tier columns" value={mode} onChange={setMode}
          options={[{ id: 'counts', label: 'Counts' }, { id: 'pct', label: '% of row' }]} />
      </div>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[1040px] border-collapse text-[15px]" style={{ fontFamily: T.mono, color: T.ink }}>
          <thead>
            <tr style={{ color: T.muted, letterSpacing: '0.12em', borderBottom: `1px solid ${T.border}` }}>
              <th className={`${th} text-left`}>Channel</th>
              <th className={`${th} text-right`}>Selected</th>
              <th className={`${th} text-right`}>{prevLabel}</th>
              <th className={`${th} text-right`}>Δ</th>
              <th className={`${th} text-right`}>%</th>
              <th className={`${th} text-right`}>Goal</th>
              <th className={th} />
              <th className={`${th} text-right`}>vs goal</th>
              {TIERS.map(x => <th key={x} className={`${th} text-right`}>{x}</th>)}
            </tr>
          </thead>
          <tbody>
            {t.groups.map(g => (
              <Fragment key={g.id}>
                <tr className="font-bold" style={{ background: '#F1F0EC', borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-2.5 py-4 text-left" style={{ fontFamily: 'inherit' }}>
                    <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{g.row.label}</span>
                  </td>
                  <Cells r={g.row} mode={mode} kind="group" prevLabel={prevLabel} />
                </tr>
                {g.children.map(c => (
                  <tr key={c.key} style={{ borderBottom: `1px solid ${T.border}` }}>
                    <td className="py-4 pl-8 pr-2.5 text-left whitespace-nowrap" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{c.label}</td>
                    <Cells r={c} mode={mode} kind="child" prevLabel={prevLabel} />
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="font-bold" style={{ background: T.ink, color: '#FFFFFF' }}>
              <td className="px-2.5 py-4 text-left">Total</td>
              <Cells r={t.total} mode={mode} kind="total" prevLabel={prevLabel} />
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}
