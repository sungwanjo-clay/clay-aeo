import type { DashboardPayload } from '@/lib/plg/load'
import { Delta, Eyebrow, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from './ui'

function Tile({ label, value, children, title }: { label: string; value: React.ReactNode; children: React.ReactNode; title?: string }) {
  return (
    <div className="rounded-[22px] p-6 sm:p-8 flex flex-col gap-3" style={{ background: T.tile }} title={title}>
      <Eyebrow>{label}</Eyebrow>
      {value != null && <p className="text-[44px] sm:text-[52px] leading-none" style={{ fontFamily: T.mono, color: T.ink, letterSpacing: '-0.02em' }}>{value}</p>}
      <div className="text-[15px] sm:text-[16px] leading-snug flex flex-col gap-1" style={{ color: T.ink }}>{children}</div>
    </div>
  )
}

const mono = { fontFamily: T.mono } as const
function Pp({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return <span style={{ color: T.faint }}>–</span>
  const pp = (cur - prev) * 100
  return <span style={{ ...mono, color: deltaColor(pp) }}>{fmtPp(pp)}</span>
}

export default function KpiTiles({ v }: { v: DashboardPayload }) {
  const k = v.kpis
  const prevLabel = v.range.compare === 'previous_year' ? 'last year' : 'previous period'
  const t = k.tier13
  const m = k.domainMix
  const r = k.rates.cur; const rp = k.rates.prev
  const rateRow = (label: string, cur: number | null, prev: number | null, title: string) => (
    <p className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: `1px solid ${T.border}` }} title={title}>
      <span>{label}</span>
      <span className="whitespace-nowrap"><span className="text-[22px]" style={mono}>{fmtPct(cur, 1)}</span> <Pp cur={cur} prev={prev} /></span>
    </p>
  )
  return (
    <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
      <Tile label="New workspaces" value={fmtInt(k.total)}>
        <p><Delta value={k.deltaPct}>{fmtPctSigned(k.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(k.prevTotal)})</p>
      </Tile>
      <Tile label="Tier 1–3 workspaces" value={fmtInt(t.cur)} title="HQ (non-personal, high-quality) workspaces at Salesforce Tier 1–3 accounts, the population the Q4 tier goals are set on.">
        <p><Delta value={t.deltaPct}>{fmtPctSigned(t.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(t.prev)})</p>
        <p>{t.goal != null ? <><span style={mono}>{fmtPct(t.vsGoal, 0)}</span> vs goal of <span style={mono}>{fmtInt(t.goal)}</span> for these dates</> : 'No goal configured for part of these dates'}</p>
      </Tile>
      <Tile label="Non-personal share" value={fmtPct(m.nonPersonalShare, 0)}
        title="Non-personal = high- and low-quality business domains combined. Share of all new workspaces; the remainder is spam or not yet scored.">
        <p>Non-personal <span style={mono}>{fmtInt(m.cur.nonPersonal)}</span> · <Delta value={m.nonPersonalDelta}>{fmtPctSigned(m.nonPersonalDelta)}</Delta> · share <Pp cur={m.nonPersonalShare} prev={m.prevNonPersonalShare} /></p>
        <p>Personal <span style={mono}>{fmtInt(m.cur.personal)}</span> ({fmtPct(m.personalShare, 0)}) · <Delta value={m.personalDelta}>{fmtPctSigned(m.personalDelta)}</Delta> · share <Pp cur={m.personalShare} prev={m.prevPersonalShare} /></p>
      </Tile>
      <Tile label={`Conversion rates · vs ${prevLabel}`} value={null}>
        {r ? <>
          {rateRow('Visitor → HQ trial user', r.visitToHq, rp?.visitToHq ?? null, `HQ trial users (non-personal: high quality) ÷ ${fmtInt(r.visitors)} unique visitors (marketing site + signup, ex. UTC & Asia). MBR definition.`)}
          {rateRow('Trial → paid', r.trialToPaid, rp?.trialToPaid ?? null, `${fmtInt(r.paid)} new PLG paid workspaces (first invoice in the period) ÷ HQ trial users. MBR definition.`)}
          {rateRow('Activation', r.activation, rp?.activation ?? null, `${fmtInt(r.activated)} new workspaces that ran a first table within 7 days ÷ all new workspaces. The last 7 days are still filling in.`)}
        </> : <p style={{ color: T.muted }}>Available on the live (Sigma) dashboard.</p>}
      </Tile>
    </div>
  )
}
