'use client'

import type { FunnelStep, StartupPeriod, StartupViewModel as SV } from '@/lib/plg/startup/compute'
import { STEPS } from '@/lib/plg/startup/compute'
import { STARTUP } from '@/lib/plg/startup/sql'
import { useState } from 'react'
import { Card, Delta, Eyebrow, H2, InfoTip, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp, fmtSigned } from '../ui'

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

function Tile({ label, value, children, muted, tip }: { label: string; value: React.ReactNode; children?: React.ReactNode; muted?: boolean; tip?: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
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
  const { T: c, P: p } = s
  if (s.beforeLaunch || c.visits < 1) {
    return <div className="grid gap-4 grid-cols-1"><Tile label="No program data" value="–">The startup program launched {STARTUP.launch}. Pick a later range.</Tile></div>
  }
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="MQALs · Tier 1–3 domains" value={fmtInt(c.mqal)}
        tip={<>Distinct Tier 1–3 company domains (Salesforce sales tier) among new workspaces created by startup-page visitors. Counts companies, so two workspaces from one company count once. Same basis as “New workspaces (Tier 1–3)” in the funnel.</>}>
        {dl(c.mqal, p.mqal)}
      </Tile>
      <Tile label="Total new workspaces" value={fmtInt(c.newWs)}
        tip={<>Workspaces created within {STARTUP.newWindowDays} days of a visit to the startup page, all tiers and email types.</>}>
        {dl(c.newWs, p.newWs)}<br /><span style={mono}>{fmtInt(c.newWsT13)}</span> at Tier 1–3
      </Tile>
      <Tile label="Offer redeemed" value={<NC why="No offer sent yet" />} muted tip={<>Workspaces that used the startup discount. No offer has been sent yet.</>}>
        No offer sent yet
      </Tile>
      <Tile label="Eligible workspaces" value={<NC why="Eligibility source isn’t in Snowflake yet" />} muted
        tip={<>New workspaces from companies that pass the Startup Offer Eligibility rule: verified Seed or Series A, VC-backed (Pre-Seed doesn’t qualify), and a net-new workspace. Backing from a partner firm can change the offer tier but doesn’t make a company eligible on its own. Comes from the eligibility workflow’s weekly snapshot in Snowflake, which isn’t hooked up yet.</>}>
        Source not hooked up yet
      </Tile>
    </div>
  )
}

function RateCards({ s }: { s: SV }) {
  if (s.beforeLaunch || s.T.visits < 1) return null
  const cards: { label: string; k: keyof StartupPeriod | null; p?: keyof StartupPeriod; desc: string; nc?: string }[] = [
    { label: 'Visit → application', k: null, desc: 'Applications ÷ visits', nc: 'Typeform responses aren’t in Snowflake' },
    { label: 'Visit → workspace', k: 'newWs', p: 'visits', desc: 'New workspaces ÷ visits' },
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
    </Card>
  )
}

function TiersAndReasons({ s }: { s: SV }) {
  const rows = s.T.tiers.map((t, i) => {
    const pt = s.P.tiers[i]
    const r = s.T.newWs ? t.newWs / s.T.newWs : null
    const pr = s.P.newWs ? pt.newWs / s.P.newWs : null
    return { ...t, r, pr }
  })
  const mx = Math.max(0.0001, ...rows.map(r => r.r ?? 0))
  const notQ = s.T.reasons.reduce((a, r) => a + r.people, 0)
  const top = s.T.reasons[0]?.people ?? 0
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>MQALs and new workspaces by tier</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>MQALs = Tier 1–3 company domains with a new workspace. Share = the tier’s new workspaces ÷ all new workspaces.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Tier</th><th className={`${th} text-right`}>MQALs</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Redeemed</th><th className={`${th} text-right`}>Share of new WS</th><th className={`${th} text-right`}>Δ share</th>
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
        <H2>Why new workspaces didn’t qualify</H2>
        <p className="text-[15px]" style={{ color: T.muted }}><span style={mono}>{fmtInt(notQ)}</span> new workspaces weren’t at a Tier 1–3 domain.</p>
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

type PartnerCut = 'partnered' | 'not'
const PARTNER_COLS: { h: string; tip?: string }[] = [
  { h: 'Firm' }, { h: 'Type', tip: 'VC fund or accelerator.' },
  { h: 'Verified portfolio', tip: 'Portfolio companies we verified from firm-first sources: Harmonic, PitchBook, Crunchbase, Dealroom, the firm’s portfolio page, official accelerator rosters (YC directory), partner-shared lists and funding announcements. Companies found only by matching our own workspaces aren’t counted, so the denominator doesn’t depend on Clay usage.' },
  { h: 'Shared by partner', tip: 'How many of the verified companies were on a list the firm shared with us. A coverage check, not the denominator.' },
  { h: 'With a workspace', tip: 'Distinct verified portfolio companies with at least one Clay workspace (free or paid) by the end of the selected dates. A company with several workspaces counts once.' },
  { h: 'Penetration', tip: 'With a workspace ÷ verified portfolio, as of the end of the selected dates.' },
  { h: 'Eligible', tip: 'Companies confirmed eligible since tracking began: verified Seed or Series A, VC-backed, with a net-new workspace. Stays in the count if the company later pays or raises again.' },
  { h: 'Needs check', tip: 'Fits on funding, but has an existing free workspace or an unconfirmed match, so the net-new workspace check is still open. Not counted as eligible or ineligible.' },
  { h: 'Redeemed', tip: 'Eligible companies that redeemed the startup offer, counted once per company.' },
  { h: 'Redemption rate', tip: 'Redeemed ÷ eligible, cumulative since tracking began. New redemptions in the period are shown underneath.' },
  { h: 'Referrals', tip: 'Recorded referrals from the firm. Separate from portfolio backing and promo codes.' },
]

function ColDefs({ cols }: { cols: { h: string; tip?: string }[] }) {
  return (
    <details className="text-[14px]" style={{ color: T.ink }}>
      <summary className="cursor-pointer select-none" style={{ color: T.muted }}>What each column means</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 grid-cols-1 md:grid-cols-[180px_1fr]">
        {cols.filter(c => c.tip).map(c => <div key={c.h} className="contents"><dt className="font-semibold">{c.h}</dt><dd style={{ color: T.muted }}>{c.tip}</dd></div>)}
      </dl>
    </details>
  )
}

function Partners() {
  const [cut, setCut] = useState<PartnerCut>('partnered')
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <H2>Partner penetration</H2>
        <Segmented ariaLabel="Firm cut" value={cut} onChange={setCut}
          options={[{ id: 'partnered', label: 'Partnered firms' }, { id: 'not', label: 'Not partnered' }]} />
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 text-[15px]" style={{ color: T.ink }}>
        <p><b>Penetration</b> = verified portfolio companies with a Clay workspace ÷ verified portfolio companies. How much of the portfolio uses Clay.</p>
        <p><b>Redemption rate</b> = eligible companies that redeemed ÷ companies confirmed eligible. A smaller denominator: only Seed to Series A, VC-backed, with a net-new workspace.</p>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}>
          {PARTNER_COLS.map((c, i) =>
            <th key={c.h} className={`${th} ${i < 2 ? 'text-left' : 'text-right'}`}>
              {c.h}
            </th>)}
        </tr></thead>
        <tbody><tr><td colSpan={PARTNER_COLS.length} className="px-3 py-4 text-[14px]">
          <NC why="The portfolio roster isn’t in Snowflake yet" /> · needs the portfolio roster and weekly eligibility snapshot in Snowflake
        </td></tr></tbody>
      </table></div>
      <p className="text-[14px]" style={{ color: T.muted }}>{cut === 'partnered' ? 'Partnered = the Partner box is checked in the firm list. Firms marked To approve show as pending.' : 'Not partnered = firms in the list without the Partner box checked.'}</p>
      <ColDefs cols={PARTNER_COLS} />
      <p className="text-[13px]" style={{ color: T.muted }}>A company backed by two firms counts in both rows but once in the total. Redemption shows Not connected, not zero, until offer redemptions are in Snowflake.</p>
    </Card>
  )
}

/** Clay account and offer status are separate fields: a company can be paid and have redeemed. */
const ACCOUNT_STATES = [
  { l: 'Not on Clay', bg: '#FFFFFF', ink: T.ink, bd: T.border },
  { l: 'Free workspace', bg: '#EFEEEA', ink: T.ink },
  { l: 'Paid', bg: '#E6EEFF', ink: '#1E3A8A' },
]
const OFFER_STATES = [
  { l: 'Eligible', bg: '#E8F6F8', ink: '#0E4F57' },
  { l: 'Needs check', bg: T.amberBg, ink: T.amberInk },
  { l: 'Not eligible', bg: '#EFEEEA', ink: T.muted },
  { l: 'Redeemed', bg: '#E6EEFF', ink: '#1E3A8A' },
  { l: 'Unknown', bg: '#FFFFFF', ink: T.faint, bd: T.border },
]
function Chip({ l, bg, ink, bd }: { l: string; bg: string; ink: string; bd?: string }) {
  return <span className="inline-flex rounded-full px-2.5 py-1 text-[13px] whitespace-nowrap" style={{ background: bg, color: ink, border: bd ? `1px solid ${bd}` : undefined }}>{l}</span>
}

const COMPANY_COLS: { h: string; tip?: string }[] = [
  { h: 'Company' }, { h: 'Backed by', tip: 'Firms in the firm list that back the company, with the source and evidence link for each.' },
  { h: 'Stage', tip: 'Latest verified round, from the weekly snapshot.' }, { h: 'Last round' },
  { h: 'Headcount 6-mo', tip: 'Headcount growth over the last six months.' },
  { h: 'Score', tip: 'Provisional opportunity score from funding recency and six-month headcount growth. Missing signals stay unknown rather than scoring zero. Separate from offer eligibility.' },
  { h: 'Clay account' }, { h: 'Offer' },
]

function Companies() {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Portfolio companies</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>The outreach list: filter to Not on Clay + Eligible for net-new prospects. Paid and redeemed companies are left out of the offer queue.</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]" style={{ color: T.muted }}>
        <span className="inline-flex flex-wrap items-center gap-1.5">Clay account {ACCOUNT_STATES.map(c => <Chip key={c.l} {...c} />)}</span>
        <span className="inline-flex flex-wrap items-center gap-1.5">Offer {OFFER_STATES.map(c => <Chip key={c.l} {...c} />)}</span>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}>
          {COMPANY_COLS.map((c, i) =>
            <th key={c.h} className={`${th} ${i < 3 || i > 5 ? 'text-left' : 'text-right'}`}>
              {c.h}
            </th>)}
        </tr></thead>
        <tbody><tr><td colSpan={COMPANY_COLS.length} className="px-3 py-4 text-[14px]">
          <NC why="The portfolio roster isn’t in Snowflake yet" /> · fills from the same roster and eligibility snapshot as the table above
        </td></tr></tbody>
      </table></div>
      <ColDefs cols={COMPANY_COLS} />
      <p className="text-[13px]" style={{ color: T.muted }}>Needs check = fits on funding but has an existing free workspace or an unconfirmed match; it isn’t counted as eligible or ineligible until the net-new workspace check is done.</p>
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
  'How many eligible workspaces will get the offer, and when does the first send go out?',
]

export default function StartupView({ s, loading }: { s: SV; loading: boolean }) {
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <Kpis s={s} />
      <RateCards s={s} />
      <Funnel s={s} />
      <TiersAndReasons s={s} />
      <Partners />
      <Companies />
      <Campaigns s={s} />
      <section className="flex flex-col gap-3">
        <Eyebrow>Discuss</Eyebrow>
        <ul className="list-disc pl-6 flex flex-col gap-2 text-[17px]" style={{ color: T.ink }}>{DISCUSS.map(q => <li key={q}>{q}</li>)}</ul>
      </section>
    </div>
  )
}
