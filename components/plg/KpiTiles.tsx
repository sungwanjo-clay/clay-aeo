import type { DashboardPayload } from '@/lib/plg/load'
import { fmtShort } from '@/lib/plg/dates'
import { Def, Delta, Eyebrow, InfoTip, Pill, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from './ui'

function Tile({ label, value, children, tip, badge, className = '' }: { label: string; value: React.ReactNode; children: React.ReactNode; tip?: React.ReactNode; badge?: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[22px] p-6 sm:p-8 flex flex-col gap-3 ${className}`} style={{ background: T.tile }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
        {badge}
      </div>
      {value != null && <p className="text-[44px] sm:text-[52px] leading-none" style={{ fontFamily: T.mono, color: T.ink, letterSpacing: '-0.02em' }}>{value}</p>}
      <div className="text-[15px] sm:text-[16px] leading-snug flex flex-col gap-1" style={{ color: T.ink }}>{children}</div>
    </div>
  )
}

const mono = { fontFamily: T.mono } as const
export const SOT_DASH_URL = 'https://claude.ai/artifact/1jxaG3mZJXJjVXEPypTMRF?sk=FvlvORPXOjz6MMmpzacEmg#overview'

/** Cumulative actual (solid, dot at today) vs the straight pace line to quarter end (dashed). */
function PaceSpark({ series }: { series: { d: string; actual: number | null; pace: number }[] }) {
  const W = 260; const H = 64; const pad = 4
  const max = Math.max(1, ...series.map(p => Math.max(p.pace, p.actual ?? 0)))
  const x = (i: number) => pad + (i / Math.max(1, series.length - 1)) * (W - pad * 2)
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2)
  const pace = series.map((p, i) => `${x(i).toFixed(1)},${y(p.pace).toFixed(1)}`).join(' ')
  const act = series.map((p, i) => (p.actual == null ? null : [x(i), y(p.actual)] as const)).filter(Boolean) as (readonly [number, number])[]
  const last = act.at(-1)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[64px] mt-1" role="img"
      aria-label={`Cumulative actual ${series.filter(p => p.actual != null).at(-1)?.actual ?? 0} vs pace line`}>
      <polyline points={pace} fill="none" stroke="#7A7770" strokeWidth={1.25} strokeDasharray="3 3" />
      {act.length > 1 && <polygon points={`${act[0][0]},${H - pad} ${act.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} ${last![0]},${H - pad}`} fill={T.pos} fillOpacity={0.1} />}
      <polyline points={act.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} fill="none" stroke={T.pos} strokeWidth={2} />
      {last && <circle cx={last[0]} cy={last[1]} r={3.5} fill={T.pos} />}
    </svg>
  )
}
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
    <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
      {k.sot && <Tile label={`Tier 1–3 workspaces · ${k.sot.quarter} QTD`} value={fmtInt(k.sot.total)}
        badge={<Pill tone={k.sot.status}>{k.sot.status === 'on_track' ? 'On pace' : k.sot.status === 'at_risk' ? 'At risk' : 'Behind pace'}</Pill>}
        tip={<Def d="Workspaces created this quarter at Tier 1–3 Salesforce accounts (best tier per domain), personal emails excluded. Matches Marketing’s Q4 source-of-truth tile."
          src="CUSTOMERS → Salesforce account tier" note={<>Always quarter to date, whatever the filter. <a href={SOT_DASH_URL} target="_blank" rel="noreferrer" className="underline" style={{ color: '#9CC3FF' }}>Source dashboard ↗</a></>} />}>
        <p style={{ color: T.muted }}><span style={mono}>T1 {fmtInt(k.sot.tiers[0])} · T2 {fmtInt(k.sot.tiers[1])} · T3 {fmtInt(k.sot.tiers[2])}</span></p>
        <p>Target <span style={mono}>{fmtInt(k.sot.target)}</span> · pace line today <span style={mono}>{fmtInt(k.sot.pace)}</span> ({fmtPct(k.sot.vsPace, 0)})</p>
        <p><Delta value={k.sot.added}>+{fmtInt(k.sot.added)}</Delta> in the last 7 days · as of {fmtShort(k.sot.asOf)}</p>
        <PaceSpark series={k.sot.series} />
        <p className="flex justify-between text-[13px]" style={{ color: T.muted }}>
          <span><span style={{ color: T.pos }}>━</span> actual · <span>┅</span> pace line</span>
          <a href={SOT_DASH_URL} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: T.pos }}>Source dashboard ↗</a>
        </p>
      </Tile>}
      <Tile label="New workspaces" value={fmtInt(k.total)}>
        <p><Delta value={k.deltaPct}>{fmtPctSigned(k.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(k.prevTotal)})</p>
      </Tile>
      <Tile label="Tier 1–3 HQ workspaces" value={fmtInt(t.cur)}
        tip={<Def d="New high-quality (HQ) workspaces at Tier 1–3 Salesforce accounts. Goal = the Q4 goal prorated to these dates."
          src="Blended attribution → CUSTOMERS domain → Salesforce tier" note="HQ only, so about 1–2% below the quarter-to-date tile." />}>
        <p><Delta value={t.deltaPct}>{fmtPctSigned(t.deltaPct)}</Delta> vs {prevLabel} ({fmtInt(t.prev)})</p>
        <p>{t.goal != null ? <><span style={mono}>{fmtPct(t.vsGoal, 0)}</span> vs goal of <span style={mono}>{fmtInt(t.goal)}</span> for these dates</> : 'No goal configured for part of these dates'}</p>
      </Tile>
      <Tile label="Non-personal share" value={fmtPct(m.nonPersonalShare, 0)}
        tip={<Def d="Share of new workspaces with a business email (high and low quality). Personal = Gmail, Outlook, iCloud and the like." note="The rest are spam or not yet scored." />}>
        <p>Non-personal <span style={mono}>{fmtInt(m.cur.nonPersonal)}</span> · <Delta value={m.nonPersonalDelta}>{fmtPctSigned(m.nonPersonalDelta)}</Delta> · share <Pp cur={m.nonPersonalShare} prev={m.prevNonPersonalShare} /></p>
        <p>Personal <span style={mono}>{fmtInt(m.cur.personal)}</span> ({fmtPct(m.personalShare, 0)}) · <Delta value={m.personalDelta}>{fmtPctSigned(m.personalDelta)}</Delta> · share <Pp cur={m.personalShare} prev={m.prevPersonalShare} /></p>
      </Tile>
      <Tile label={`Conversion rates · vs ${prevLabel}`} value={null} className="xl:col-span-2 2xl:col-span-1">
        {r ? <>
          {rateRow('Visitor → HQ trial user', r.visitToHq, rp?.visitToHq ?? null, <Def
            d={<>New HQ workspaces ({fmtInt(k.hqTotal)}) ÷ unique visitors ({fmtInt(r.visitors)}) on clay.com and signup pages.</>}
            note="Excludes UTC and Asia time zones. MBR definition." />)}
          {rateRow('Trial → paid', r.trialToPaid, rp?.trialToPaid ?? null, <Def
            d={<>New paid PLG workspaces ({fmtInt(r.paid)}, first invoice in the period) ÷ new HQ workspaces in the same period.</>}
            note="Not a cohort: some payers signed up earlier. MBR definition." />)}
          {rateRow('Activation', r.activation, rp?.activation ?? null, <Def
            d={<>New workspaces that ran a first table within 7 days ({fmtInt(r.activated)}) ÷ new workspaces.</>}
            note="The latest week is still filling in." />)}
        </> : <p style={{ color: T.muted }}>Available on the live (Sigma) dashboard.</p>}
      </Tile>
    </div>
  )
}
