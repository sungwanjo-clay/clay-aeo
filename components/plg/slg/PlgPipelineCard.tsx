'use client'

import type { SlgCounts, SlgView } from '@/lib/plg/slg/compute'
import { PLG_PLAYS } from '@/lib/plg/slg/sql'
import { usd } from '@/lib/plg/insights'
import { Card, Delta, Eyebrow, H2, InfoTip, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-2.5 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const rel = (c: number, p: number) => (p ? (c - p) / p : null)

function Tile({ label, value, tip, children }: { label: string; value: string; tip: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-5 flex flex-col gap-2" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow><InfoTip label={`About ${label}`}>{tip}</InfoTip></div>
      <p className="text-[34px] leading-none" style={{ ...mono, color: T.ink }}>{value}</p>
      <p className="text-[14px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}
const vs = (c: number, p: number, money = false) => {
  const d = rel(c, p)
  return <><Delta value={d}>{fmtPctSigned(d)}</Delta> <span style={{ color: T.muted }}>vs period before ({money ? usd(p) : fmtInt(p)})</span></>
}

/** Workspaces tab: the SLG Team Pulse's S1 / S2 / pipeline, limited to touchpoints from PLG plays. */
export default function PlgPipelineCard({ s, loading, error }: { s: SlgView | null; loading?: boolean; error?: string | null }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-5 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }}>
      <div className="flex flex-col gap-1.5">
        <H2>Sales pipeline sourced by PLG plays</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>
          The SLG Team Pulse’s S1, S2 and pipeline, counted the same way, for opportunities whose sourcing touchpoint is a GTM play triggered by
          product behavior. It is part of the team’s Hybrid Outbound number, never added to it, and moves no credit between channels.
        </p>
      </div>
      {error && !s ? <p className="text-[15px]" style={{ color: T.neg }}>{error}</p>
        : !s ? <p className="text-[15px]" style={{ color: T.muted }}>Querying Sigma for SLG pipeline…</p>
        : <Body s={s} />}
    </Card>
  )
}

function Body({ s }: { s: SlgView }) {
  const c = s.cur, p = s.prev
  const share = c.team.s2 ? c.plg.s2 / c.team.s2 : null, pshare = p.team.s2 ? p.plg.s2 / p.team.s2 : null
  const pipeShare = c.team.pipe ? c.plg.pipe / c.team.pipe : null
  return <>
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="PLG-sourced S1" value={fmtInt(c.plg.s1)}
        tip={<>New-business opportunities that entered Stage 1 (or went straight to S2) in the range, sourced by a PLG play touchpoint. Dated by S1, or by the earlier of S1 and S2 for S2 opportunities, as in the SLG Team Pulse.</>}>
        {vs(c.plg.s1, p.plg.s1)}
      </Tile>
      <Tile label="PLG-sourced S2" value={fmtInt(c.plg.s2)}
        tip={<>Sourced opportunities that entered Stage 2 in the range (IS_TIED_TO_S2_OPP, dated by the S2 enter date), from PLG play touchpoints.</>}>
        {vs(c.plg.s2, p.plg.s2)}
      </Tile>
      <Tile label="PLG-sourced S2 pipeline" value={usd(c.plg.pipe)}
        tip={<>Current amount on those S2 opportunities (OPP_CURRENT_AMOUNT).</>}>
        {vs(c.plg.pipe, p.plg.pipe, true)}
      </Tile>
      <Tile label="Share of team S2" value={fmtPct(share, 1)}
        tip={<>PLG-sourced S2 ÷ all team S2 in the SLG Team Pulse (every channel except Partner Referral and Sales Outbound). Share of team S2 pipeline: {fmtPct(pipeShare, 1)}.</>}>
        {share != null && pshare != null ? <><span style={{ ...mono, color: deltaColor((share - pshare) * 100) }}>{fmtPp((share - pshare) * 100)}</span> <span style={{ color: T.muted }}>vs period before ({fmtPct(pshare, 1)})</span></> : '–'}
        <br /><span style={{ color: T.muted }}>Team: {fmtInt(c.team.s2)} S2 · {usd(c.team.pipe)} pipeline</span>
      </Tile>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}>
          <th className={`${th} text-left`}>Play type</th>
          <th className={`${th} text-right`} title="Hand-raise touchpoints that count as new-business MQALs">MQALs</th>
          <th className={`${th} text-right`}>S1</th><th className={`${th} text-right`}>S2</th><th className={`${th} text-right`}>S2 pipeline</th><th className={`${th} text-right`}>Pipeline before</th>
        </tr></thead>
        <tbody>
          {(['signup', 'expansion'] as const).map(g => <GroupRow key={g} label={PLG_PLAYS[g].label} def={PLG_PLAYS[g].def} c={c.groups[g]} p={p.groups[g]} />)}
          <GroupRow label="All PLG plays" c={c.plg} p={p.plg} bold />
        </tbody>
      </table>
    </div>
    <details className="text-[14px]">
      <summary className="cursor-pointer select-none" style={{ color: T.muted }}>By play ({s.campaigns.length} with activity in either period) and the matching rules</summary>
      <div className="pt-3 flex flex-col gap-3">
        <div className="overflow-auto max-h-[420px] rounded-xl" style={{ border: `1px solid ${T.border}` }}>
          <table className="w-full min-w-[760px] text-[14px]" style={{ color: T.ink }}>
            <thead className="sticky top-0" style={{ background: '#fff' }}><tr style={head}>
              <th className={`${th} text-left`}>Salesforce campaign</th><th className={`${th} text-right`}>MQALs</th><th className={`${th} text-right`}>S1</th><th className={`${th} text-right`}>S2</th><th className={`${th} text-right`}>S2 pipeline</th><th className={`${th} text-right`}>Before</th>
            </tr></thead>
            <tbody>{s.campaigns.map(x => (
              <tr key={`${x.group}|${x.campaign}`} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2"><p>{x.campaign}</p><p className="text-[12px]" style={{ color: T.muted }}>{PLG_PLAYS[x.group].label}</p></td>
                <td className="px-3 py-2 text-right" style={mono}>{fmtInt(x.cur.mqal)}</td>
                <td className="px-3 py-2 text-right" style={mono}>{fmtInt(x.cur.s1)}</td>
                <td className="px-3 py-2 text-right" style={mono}>{fmtInt(x.cur.s2)}</td>
                <td className="px-3 py-2 text-right" style={mono}>{usd(x.cur.pipe)}</td>
                <td className="px-3 py-2 text-right" style={{ ...mono, color: T.muted }}>{usd(x.prev.pipe)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <p style={{ color: T.muted }}>
          A touchpoint counts when it is a <b>{PLG_PLAYS.touchpointType}</b> touchpoint (a response to a GTM play’s Salesforce campaign) and the
          campaign name matches: <b>{PLG_PLAYS.signup.label}</b> {PLG_PLAYS.signup.like.map(x => `“${x.replace(/%/g, '')}”`).join(', ')};
          {' '}<b>{PLG_PLAYS.expansion.label}</b> {PLG_PLAYS.expansion.like.map(x => `“${x.replace(/%/g, '')}”`).join(', ')}.
          Re-heat plays that mix demo requesters with workspace creators are left out ({PLG_PLAYS.exclude.map(x => `“${x.replace(/%/g, '')}”`).join(', ')}).
          Workspace creators only become touchpoints when they respond to a play, so this counts what PLG sources through sales, not every opportunity at an account that uses the product.
        </p>
      </div>
    </details>
  </>
}

function GroupRow({ label, def, c, p, bold }: { label: string; def?: string; c: SlgCounts; p: SlgCounts; bold?: boolean }) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.border}`, background: bold ? '#FAF9F6' : undefined }}>
      <td className="px-3 py-2.5"><p className={bold ? 'font-semibold' : ''}>{label}</p>{def && <p className="text-[13px]" style={{ color: T.muted }}>{def}</p>}</td>
      <td className="px-3 py-2.5 text-right" style={mono}>{fmtInt(c.mqal)}</td>
      <td className="px-3 py-2.5 text-right" style={mono}>{fmtInt(c.s1)}</td>
      <td className="px-3 py-2.5 text-right" style={mono}>{fmtInt(c.s2)}</td>
      <td className="px-3 py-2.5 text-right" style={mono}>{usd(c.pipe)}</td>
      <td className="px-3 py-2.5 text-right" style={{ ...mono, color: T.muted }}>{usd(p.pipe)}</td>
    </tr>
  )
}
