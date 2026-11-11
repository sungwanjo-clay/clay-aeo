import type { DashboardPayload } from '@/lib/plg/load'
import { Delta, Eyebrow, T, fmtInt, fmtPct, fmtPctSigned } from './ui'

function Tile({ label, value, children, title }: { label: string; value: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-[22px] p-6 sm:p-8 flex flex-col gap-3" style={{ background: T.tile }} title={title}>
      <Eyebrow>{label}</Eyebrow>
      <p className="text-[44px] sm:text-[52px] leading-none" style={{ fontFamily: T.mono, color: T.ink, letterSpacing: '-0.02em' }}>{value}</p>
      <p className="text-[15px] sm:text-[16px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}

export default function KpiTiles({ v }: { v: DashboardPayload }) {
  const k = v.kpis
  const prevLabel = v.range.compare === 'previous_year' ? 'last year' : 'previous period'
  const pr = k.projection
  const rateLabel = v.range.presetLabel ?? "selected dates'"
  return (
    <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
      <Tile label="New workspaces" value={fmtInt(k.total)}>
        <Delta value={k.deltaPct}>{fmtPctSigned(k.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(k.prevTotal)})
      </Tile>
      <Tile label="Pace vs goal" value={fmtPct(k.paceVsGoal)}>
        {k.goal != null
          ? <>{fmtInt(k.total)} of {fmtInt(k.goal)} goal for these dates</>
          : <>No goal configured for part of these dates</>}
      </Tile>
      <Tile
        label={`Projected ${pr?.label ?? ''} finish`}
        value={pr ? fmtInt(pr.value) : '–'}
        title={pr ? `QTD ${fmtInt(pr.qtdActual)} + ${fmtInt(pr.ratePerDay)}/day × ${pr.daysRemaining} days remaining` : undefined}
      >
        {pr ? (
          <>
            {fmtPct(pr.pctOfGoal, 0)} of {fmtInt(pr.quarterGoal)} at the {rateLabel} run rate. Always {pr.label}, whatever the filter.
            {pr.neededPerWeek != null && <> Need {fmtInt(pr.neededPerWeek)}/wk to hit goal.</>}
          </>
        ) : 'No quarter configured for the latest data date.'}
      </Tile>
      <Tile label="Tier 1–2 share" value={fmtPct(k.tier12.share)}>
        {fmtInt(k.tier12.count)} Tier 1–2 workspaces. Goal mix is {fmtPct(k.tier12.goalMix)}.
      </Tile>
    </div>
  )
}
