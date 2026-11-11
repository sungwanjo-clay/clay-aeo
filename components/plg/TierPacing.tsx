import type { DashboardPayload } from '@/lib/plg/load'
import { PACING, UNASSIGNED_TIER_BUCKET } from '@/lib/plg/config'
import { Card, Delta, H2, Pill, T, fmtInt, fmtPctSigned } from './ui'

const STATUS_LABEL = { on_track: 'On track', at_risk: 'At risk', behind: 'Behind' } as const
const STATUS_COLOR = { on_track: T.onTrack, at_risk: T.atRisk, behind: T.behind } as const

export function PaceBar({ pct, status, width = '100%' }: { pct: number | null; status: keyof typeof STATUS_COLOR | null; width?: string }) {
  const fill = pct == null ? 0 : Math.min(pct, PACING.barMax) / PACING.barMax
  const tick = 1 / PACING.barMax
  return (
    <div className="relative h-[12px] rounded-full" style={{ width, background: T.barTrack }}
      role="meter" aria-valuemin={0} aria-valuemax={PACING.barMax * 100} aria-valuenow={pct == null ? undefined : Math.round(pct * 100)}>
      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${fill * 100}%`, background: status ? STATUS_COLOR[status] : T.faint }} />
      <div className="absolute -top-[5px] -bottom-[5px] w-[2px] rounded" style={{ left: `calc(${tick * 100}% - 1px)`, background: T.ink }} />
    </div>
  )
}

export default function TierPacing({ v }: { v: DashboardPayload }) {
  return (
    <Card className="p-5 sm:p-10 flex flex-col gap-5">
      <H2>Pacing by tier</H2>
      <p className="text-[16px] leading-relaxed" style={{ color: T.muted }}>
        Actual ÷ goal for the selected dates. On track ≥{PACING.onTrack * 100}%, at risk {PACING.atRisk * 100}–{PACING.onTrack * 100}%, behind &lt;{PACING.atRisk * 100}%.
      </p>
      <ul className="flex flex-col">
        {v.tiers.map(t => (
          <li key={t.tier} className="grid grid-cols-[60px_1fr] items-center gap-3 sm:gap-4 py-6" style={{ borderBottom: `1px solid ${T.border}` }}>
            <span className="text-[18px] font-bold" style={{ color: T.ink }}>{t.tier}</span>
            <div className="flex flex-col gap-2 min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0"><PaceBar pct={t.pct} status={t.status} /></div>
                <div className="w-[152px] shrink-0 flex justify-end">
                  {t.status
                    ? <Pill tone={t.status}>{Math.round((t.pct ?? 0) * 100)}% · {STATUS_LABEL[t.status]}</Pill>
                    : <Pill>No goal</Pill>}
                </div>
              </div>
              <p className="text-[13px] flex flex-wrap gap-x-2" style={{ fontFamily: T.mono, color: T.ink }}>
                <span className="whitespace-nowrap">{fmtInt(t.actual)} · goal {fmtInt(t.goal)}</span>
                <span className="whitespace-nowrap"><Delta value={t.deltaPct}>{fmtPctSigned(t.deltaPct)}</Delta> vs {v.range.compare === 'previous_year' ? 'last year' : 'prev. period'}</span>
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[14px]" style={{ color: T.muted }}>
        Bar scale 0–{PACING.barMax * 100}% of goal. Tick = 100%. Tier = SFDC account Sales Tier via customer domain; {UNASSIGNED_TIER_BUCKET ? `unmatched domains count as ${UNASSIGNED_TIER_BUCKET}.` : 'unmatched domains are excluded.'}
      </p>
    </Card>
  )
}
