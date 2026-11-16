import type { DashboardPayload } from '@/lib/plg/load'
import { Delta, Eyebrow, InfoTip, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from './ui'

function Tile({ label, value, children, tip }: { label: string; value: React.ReactNode; children: React.ReactNode; tip?: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-6 sm:p-8 flex flex-col gap-3" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
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
  const rateRow = (label: string, cur: number | null, prev: number | null, tip: React.ReactNode) => (
    <p className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: `1px solid ${T.border}` }}>
      <span className="inline-flex items-center gap-1.5">{label} <InfoTip label={`About ${label}`}>{tip}</InfoTip></span>
      <span className="whitespace-nowrap"><span className="text-[22px]" style={mono}>{fmtPct(cur, 1)}</span> <Pp cur={cur} prev={prev} /></span>
    </p>
  )
  return (
    <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
      <Tile label="New workspaces" value={fmtInt(k.total)}
        tip={<>Every workspace created in the selected dates, whatever the email or channel. Compared with the previous period of the same length.</>}>
        <p><Delta value={k.deltaPct}>{fmtPctSigned(k.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(k.prevTotal)})</p>
      </Tile>
      <Tile label="Tier 1–3 workspaces" value={fmtInt(t.cur)}
        tip={<>New HQ workspaces whose email domain matches a Salesforce account at Sales Tier 1, 2 or 3. HQ only, because the Q4 tier goals are set on HQ workspaces. Goal = the Q4 Tier 1–3 goal prorated to the selected dates.</>}>
        <p><Delta value={t.deltaPct}>{fmtPctSigned(t.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(t.prev)})</p>
        <p>{t.goal != null ? <><span style={mono}>{fmtPct(t.vsGoal, 0)}</span> vs goal of <span style={mono}>{fmtInt(t.goal)}</span> for these dates</> : 'No goal configured for part of these dates'}</p>
      </Tile>
      <Tile label="Non-personal share" value={fmtPct(m.nonPersonalShare, 0)}
        tip={<>Share of new workspaces signed up with a business email (HQ and low quality combined). Personal = a consumer email such as Gmail, Outlook or iCloud. The few left over are spam domains or not yet scored. “Share” changes are in percentage points.</>}>
        <p>Non-personal <span style={mono}>{fmtInt(m.cur.nonPersonal)}</span> · <Delta value={m.nonPersonalDelta}>{fmtPctSigned(m.nonPersonalDelta)}</Delta> · share <Pp cur={m.nonPersonalShare} prev={m.prevNonPersonalShare} /></p>
        <p>Personal <span style={mono}>{fmtInt(m.cur.personal)}</span> ({fmtPct(m.personalShare, 0)}) · <Delta value={m.personalDelta}>{fmtPctSigned(m.personalDelta)}</Delta> · share <Pp cur={m.personalShare} prev={m.prevPersonalShare} /></p>
      </Tile>
      <Tile label={`Conversion rates · vs ${prevLabel}`} value={null}>
        {r ? <>
          {rateRow('Visitor → HQ trial user', r.visitToHq, rp?.visitToHq ?? null, <>
            New HQ workspaces ({fmtInt(k.hqTotal)}) ÷ unique visitors ({fmtInt(r.visitors)}). Visitors = distinct browsers on clay.com and the signup pages, excluding UTC and Asia timezones. HQ = a business email whose company Clay could verify (company LinkedIn found, or a high or medium domain score). Same as the MBR.</>)}
          {rateRow('Trial → paid', r.trialToPaid, rp?.trialToPaid ?? null, <>
            New paid PLG workspaces ({fmtInt(r.paid)}, first invoice in the period) ÷ new HQ workspaces in the same period. Not a cohort: some payers signed up earlier. Same as the MBR.</>)}
          {rateRow('Activation', r.activation, rp?.activation ?? null, <>
            New workspaces that ran their first table within 7 days ({fmtInt(r.activated)}) ÷ all new workspaces. Not in the MBR. The most recent days are still filling in.</>)}
        </> : <p style={{ color: T.muted }}>Available on the live (Sigma) dashboard.</p>}
      </Tile>
    </div>
  )
}
