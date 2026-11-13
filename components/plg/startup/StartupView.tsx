'use client'

import type { FunnelStep, StartupPeriod, StartupViewModel as SV } from '@/lib/plg/startup/compute'
import { STEPS } from '@/lib/plg/startup/compute'
import { STARTUP } from '@/lib/plg/startup/sql'
import { Card, Delta, Eyebrow, H2, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp, fmtSigned } from '../ui'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const mono = { fontFamily: T.mono } as const
const dp = (r: number | null) => (r != null && r < 0.1 ? 2 : 1)

function NC({ why }: { why?: string }) {
  return <span title={why} style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span>
}
function ppTxt(r: number, pr: number) {
  const pp = (r - pr) * 100
  return <span style={{ ...mono, color: deltaColor(pp) }}>{fmtPp(pp)}</span>
}

function Tile({ label, value, children, muted }: { label: string; value: React.ReactNode; children?: React.ReactNode; muted?: boolean }) {
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3" style={{ background: T.tile }}>
      <Eyebrow>{label}</Eyebrow>
      <p className={muted ? 'text-[22px] leading-tight' : 'text-[40px] leading-none'} style={{ fontFamily: T.mono, color: muted ? T.faint : T.ink }}>{value}</p>
      {children && <p className="text-[15px] leading-snug" style={{ color: T.ink }}>{children}</p>}
    </div>
  )
}
const dl = (cur: number, prev: number) => {
  const d = prev ? (cur - prev) / prev : null
  return <><Delta value={d}>{fmtPctSigned(d)}</Delta> vs previous period</>
}

function Kpis({ s }: { s: SV }) {
  const { T: c, P: p, move } = s
  if (s.beforeLaunch || c.visits < 1) {
    return <div className="grid gap-4 grid-cols-1"><Tile label="No program data" value="–">The startup program launched {STARTUP.launch}. Pick a later range.</Tile></div>
  }
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
      <Tile label="MQALs" value={fmtInt(c.mqal)}>
        <span className="inline-block rounded-full px-2.5 py-0.5 text-[12px] uppercase mr-1" style={{ background: '#EFEEEA', color: T.muted, letterSpacing: '0.08em', ...mono }}>Goal not set</span>
        Tier 1–3 domains<br />{dl(c.mqal, p.mqal)}
      </Tile>
      <Tile label="New workspaces" value={fmtInt(c.newWs)}>{dl(c.newWs, p.newWs)}<br />from <span style={mono}>{fmtInt(c.visits)}</span> visits</Tile>
      <Tile label="Offer redeemed" value={<NC why="No offer sent yet" />} muted>No offer sent yet · <span style={mono}>{fmtInt(c.activated)}</span> activated</Tile>
      <Tile label="Paid" value={fmtInt(c.paid)}>{dl(c.paid, p.paid)}<br />any paid plan, no discount yet</Tile>
      {move && <Tile label="Biggest rate change" value={<span className="text-[24px]">{move.rl}</span>}>
        <span style={mono}>{fmtPct(move.pr, dp(move.pr))} → {fmtPct(move.r, dp(move.r))}</span> {ppTxt(move.r, move.pr)}
      </Tile>}
    </div>
  )
}

function RateCards({ s }: { s: SV }) {
  if (s.beforeLaunch || s.T.visits < 1) return null
  const cards: { label: string; k: keyof StartupPeriod | null; p?: keyof StartupPeriod; desc: string; nc?: string }[] = [
    { label: 'Visit → email capture', k: null, desc: 'Email captures ÷ visits', nc: 'Typeform responses aren’t in Snowflake' },
    { label: 'MQAL rate', k: 'mqal', p: 'identified', desc: 'Tier 1–3 domains ÷ identified visitors' },
    { label: 'Redemption rate', k: null, desc: 'Redeemed ÷ new workspaces', nc: 'No offer sent yet' },
    { label: 'Activation rate', k: 'activated', p: 'newWs', desc: 'Activated ÷ new workspaces' },
  ]
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(c => {
        const r = c.k && c.p ? s.rate(s.T, c.k, c.p) : null
        const pr = c.k && c.p ? s.rate(s.P, c.k, c.p) : null
        return (
          <Card key={c.label} className="p-5 flex flex-col gap-2">
            <Eyebrow>{c.label}</Eyebrow>
            <p className="text-[32px] leading-none" style={{ ...mono, color: c.nc ? T.faint : T.ink }}>{c.nc ? <span className="text-[20px]"><NC why={c.nc} /></span> : fmtPct(r, dp(r))}</p>
            <p className="text-[14px]" style={{ color: T.muted }}>{r != null && pr != null ? <>{ppTxt(r, pr)} vs previous period ({fmtPct(pr, dp(pr))})</> : c.nc ?? c.desc}</p>
          </Card>
        )
      })}
    </div>
  )
}

function Funnel({ s }: { s: SV }) {
  const cell = (st: Extract<FunnelStep, { name: string }>) => {
    if (!st.k) return { cur: null, prev: null, r: null, pr: null }
    return { cur: s.T[st.k] as number, prev: s.P[st.k] as number, r: st.p ? s.rate(s.T, st.k, st.p) : null, pr: st.p ? s.rate(s.P, st.k, st.p) : null }
  }
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Funnel</H2>
      <p className="text-[15px] max-w-[880px]" style={{ color: T.muted }}>
        Inbound visitors qualify into MQALs when their domain is a Tier 1–3 account, and partner portfolio lists add pre-approved MQALs. Both get the offer email. The downstream steps show whether the discount turned into paying customers.
        {' '}MQALs here are Tier 1–3 domains, not the sales hand-raise MQAL.
      </p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[880px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step</th><th className={`${th} text-right`}>Count</th><th className={`${th} text-right`}>Change</th>
            <th className={`${th} text-right`}>% change</th><th className={`${th} text-left`}>Conversion from previous step</th><th className={`${th} text-right`}>Rate change</th>
          </tr></thead>
          <tbody>{STEPS.map((st, i) => {
            if ('h' in st) return (
              <tr key={`h-${i}`}><td colSpan={6} className="px-3 pt-5 pb-1">
                <span className="text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>{st.h}</span>
                {st.n && <span className="ml-3 text-[13px]" style={{ color: T.faint }}>{st.n}</span>}
              </td></tr>
            )
            const c = cell(st)
            const d = c.cur != null && c.prev != null ? c.cur - c.prev : null
            return (
              <tr key={st.name} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3">
                  <p className="font-semibold">{st.name}</p>
                  <p className="text-[13px]" style={{ color: T.muted }}>{st.lever}</p>
                </td>
                <td className={num} style={mono}>{st.nc ? <NC why={st.nc} /> : fmtInt(c.cur)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(d) }}>{d == null ? '–' : fmtSigned(d)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(d) }}>{c.prev ? fmtPctSigned((c.cur! - c.prev) / c.prev) : '–'}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {st.nc && st.rl ? <span className="text-[14px]">{st.rl} <NC why={st.nc} /></span>
                    : c.r != null ? <span className="text-[14px]">
                      <span className="rounded-full px-2.5 py-1" style={st.key ? { background: '#E8F6F8' } : undefined}>{st.rl} <b style={mono}>{fmtPct(c.r, dp(c.r))}</b></span>
                      {c.pr != null && <span className="ml-2 text-[13px]" style={{ color: T.muted, ...mono }}>{fmtPct(c.pr, dp(c.pr))} prev. period</span>}
                    </span> : <span style={{ color: T.faint }}>–</span>}
                </td>
                <td className={num}>{c.r != null && c.pr != null ? ppTxt(c.r, c.pr) : '–'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>
        Change columns compare with the previous period. Highlighted rates are the ones we manage to. Identified = the visitor’s browser later signed in to a Clay workspace
        (Clay staff and visitors seen in more than {STARTUP.maxWorkspacesPerVisitor} workspaces are excluded). New workspaces created in the last {STARTUP.newWindowDays} days of the range are still accruing.
      </p>
    </Card>
  )
}

function TiersAndReasons({ s }: { s: SV }) {
  const rows = s.T.tiers.map((t, i) => {
    const pt = s.P.tiers[i]
    const r = t.mqal ? t.newWs / t.mqal : null
    const pr = pt.mqal ? pt.newWs / pt.mqal : null
    return { ...t, r, pr }
  })
  const mx = Math.max(0.0001, ...rows.map(r => r.r ?? 0))
  const notQ = s.T.reasons.reduce((a, r) => a + r.people, 0)
  const top = s.T.reasons[0]?.people ?? 0
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>MQALs to workspaces by tier</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Denominator is MQALs (Tier 1–3 domains), numerator is new workspaces.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Tier</th><th className={`${th} text-right`}>MQALs</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Redeemed</th><th className={`${th} text-right`}>MQAL → workspace</th><th className={`${th} text-right`}>Δ rate</th>
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.tier} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold">{r.tier}</td>
              <td className={num} style={mono}>{fmtInt(r.mqal)}</td>
              <td className={num} style={mono}>{fmtInt(r.newWs)}</td>
              <td className={num}><NC why="No offer sent yet" /></td>
              <td className="px-3 py-3">
                <div className="flex gap-2.5 items-center justify-end">
                  <div className="h-[10px] w-[120px] rounded-full overflow-hidden" style={{ background: T.barTrack }}>
                    <div className="h-full rounded-full" style={{ width: `${((r.r ?? 0) / mx) * 100}%`, background: T.pos }} />
                  </div>
                  <span className="min-w-[48px] text-right" style={mono}>{fmtPct(r.r)}</span>
                </div>
              </td>
              <td className={num}>{r.r != null && r.pr != null ? ppTxt(r.r, r.pr) : '–'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Why visitors didn’t qualify</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>
          <span style={mono}>{fmtInt(notQ)}</span> identified visitors weren’t at a Tier 1–3 domain. Criteria are a lever too. (Captured emails aren’t in Snowflake, so this uses identified visitors.)
        </p>
        <div className="flex flex-col gap-2.5">
          {s.T.reasons.map(r => (
            <div key={r.reason} className="grid items-center gap-3 text-[15px]" style={{ gridTemplateColumns: 'minmax(140px, 190px) 1fr 48px', color: T.ink }}>
              <span>{r.reason}</span>
              <div className="h-[12px] rounded-full overflow-hidden" style={{ background: T.barTrack }}>
                <div className="h-full rounded-full" style={{ width: `${top ? (r.people / top) * 100 : 0}%`, background: '#A8A49C' }} />
              </div>
              <span className="text-right" style={mono}>{fmtInt(r.people)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Partners() {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Partner penetration</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Penetration = portfolio companies with a Clay workspace by the end of the selected dates ÷ portfolio companies shared with us.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}>
          {['Partner', 'Type', 'Portfolio', 'MQALs in period', 'Workspaces to date', 'Penetration', 'New WS in period', 'Δ vs comp.'].map((h, i) =>
            <th key={h} className={`${th} ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>)}
        </tr></thead>
        <tbody><tr><td colSpan={8} className="px-3 py-4 text-[14px]"><NC why="Partner portfolio lists aren’t in Snowflake" /> · needs the VC and accelerator portfolio lists in Snowflake (partner, type and portfolio company domains).</td></tr></tbody>
      </table></div>
    </Card>
  )
}

function Campaigns({ s }: { s: SV }) {
  const rows = s.T.campaigns
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Paid campaigns</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Cost per capture alone rewards cheap, unqualified emails. Judge campaigns on cost per MQAL and cost per new workspace.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[1140px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}>
          {['Campaign', 'Platform', 'Visits', 'Spend', 'Email captures', 'Cost / capture', 'MQALs', 'Cost / MQAL', 'New WS', 'Cost / new WS', 'Δ cost / new WS'].map((h, i) =>
            <th key={h} className={`${th} ${i < 2 ? 'text-left' : 'text-right'}`}>{h}</th>)}
        </tr></thead>
        <tbody>{rows.length ? rows.map(r => (
          <tr key={`${r.platform}|${r.campaign}`} style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="px-3 py-3 font-semibold" style={mono}>{r.campaign}</td>
            <td className="px-3 py-3">{r.platform}</td>
            <td className={num} style={mono}>{fmtInt(r.visits)}</td>
            <td className={num}><NC why="No ad spend table in Snowflake" /></td>
            <td className={num}><NC why="Typeform responses aren’t in Snowflake" /></td>
            <td className={num} style={{ color: T.faint }}>–</td>
            <td className={num} style={mono}>{fmtInt(r.mqal)}</td>
            <td className={num} style={{ color: T.faint }}>–</td>
            <td className={num} style={mono}>{fmtInt(r.newWs)}</td>
            <td className={num} style={{ color: T.faint }}>–</td>
            <td className={num} style={{ color: T.faint }}>–</td>
          </tr>)) : <tr><td colSpan={11} className="px-3 py-4" style={{ color: T.muted }}>No paid-click visits to the page in this range.</td></tr>}</tbody>
      </table></div>
      <p className="text-[13px]" style={{ color: T.muted }}>Paid = a gclid, fbclid or LinkedIn click id, or a paid utm_medium. Spend and cost columns need ad spend in Snowflake.</p>
    </Card>
  )
}

const DISCUSS = [
  'Where is the biggest leak between visit and new workspace, and who owns it?',
  'Is the MQAL rate low because of who applies or because the criteria are too strict?',
  'Partner-list MQALs skip the form. Do they open and convert as well as inbound MQALs?',
]

export default function StartupView({ s, loading }: { s: SV; loading: boolean }) {
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <Kpis s={s} />
      <RateCards s={s} />
      <Funnel s={s} />
      <TiersAndReasons s={s} />
      <Partners />
      <Campaigns s={s} />
      <section className="flex flex-col gap-3">
        <Eyebrow>Discuss</Eyebrow>
        <ul className="list-disc pl-6 flex flex-col gap-2 text-[17px]" style={{ color: T.ink }}>{DISCUSS.map(q => <li key={q}>{q}</li>)}</ul>
      </section>
    </div>
  )
}
