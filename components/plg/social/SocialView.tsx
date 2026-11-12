'use client'

import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SocialView as SV } from '@/lib/plg/social/compute'
import { ACTIVATION_DAYS, CHANNELS, CREATOR_WINDOW_DAYS } from '@/lib/plg/social/config'
import { fmtShort } from '@/lib/plg/dates'
import { Card, Delta, Eyebrow, H2, Pill, Segmented, T, deltaColor, fmtInt, fmtK, fmtPct, fmtPctSigned, fmtSigned } from '../ui'

export type SocialChannel = 'all' | 'peter'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const tableHead = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const

function Tile({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3" style={{ background: T.tile }}>
      <Eyebrow>{label}</Eyebrow>
      <p className="text-[40px] leading-none" style={{ fontFamily: T.mono, color: T.ink }}>{value}</p>
      <p className="text-[15px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}

export function ChannelPills({ value, onChange }: { value: SocialChannel; onChange: (c: SocialChannel) => void }) {
  const pills = [{ id: 'all' as const, label: 'All channels', ok: true }, ...CHANNELS.filter(c => c.creator).map(c => ({ id: c.id, label: c.label, ok: !!c.youtubeId }))]
  return (
    <div className="flex flex-wrap gap-3" role="tablist" aria-label="YouTube channel">
      {pills.map(p => {
        const active = p.id === value
        return (
          <button key={p.id} role="tab" aria-selected={active} disabled={!p.ok}
            title={p.ok ? undefined : 'Channel not connected yet: add its YouTube channel id and link tags'}
            onClick={() => p.ok && onChange(p.id as SocialChannel)}
            className="rounded-full px-5 py-2.5 text-[16px] disabled:cursor-not-allowed"
            style={{ border: `1px solid ${active ? T.ink : T.border}`, background: '#fff', color: p.ok ? (active ? T.muted : T.ink) : T.faint }}>
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

function Trend({ s }: { s: SV }) {
  const [metric, setMetric] = useState<'views' | 'visitors' | 'workspaces'>('workspaces')
  const tr = s.trend.find(x => x.metric === metric)!
  const data = tr.cur.map((p, i) => ({ label: fmtShort(p.d), cur: p.v, prev: tr.prev[i]?.v ?? null }))
  const cur = tr.cur.reduce((a, p) => a + p.v, 0); const prev = tr.prev.reduce((a, p) => a + p.v, 0)
  const names = { views: 'YouTube views', visitors: 'Site visitors', workspaces: 'New workspaces' }
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H2>Trend</H2>
          <p className="text-[15px] mt-1" style={{ color: T.muted }}>
            <span style={{ fontFamily: T.mono, color: T.ink }}>{fmtInt(cur)}</span> <Delta value={prev ? (cur - prev) / prev : null}>{fmtPctSigned(prev ? (cur - prev) / prev : null)}</Delta> vs previous ({fmtInt(prev)})
          </p>
        </div>
        <Segmented ariaLabel="Trend metric" value={metric} onChange={setMetric}
          options={(['views', 'visitors', 'workspaces'] as const).map(m => ({ id: m, label: names[m] }))} />
      </div>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ECEAE5" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={20} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <YAxis tickFormatter={fmtK} tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <Tooltip formatter={(v: unknown, n: unknown) => [fmtInt(Number(v)), n === 'cur' ? 'Selected' : 'Previous']} />
            <Bar dataKey="cur" fill={T.pos} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line dataKey="prev" stroke="#7A7770" strokeDasharray="4 4" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {metric === 'views' && s.yt.lagging && <p className="text-[13px]" style={{ color: T.muted }}>YouTube reports run about two days behind: data through {fmtShort(s.yt.lastDay!)}.</p>}
    </Card>
  )
}

function Funnel({ s }: { s: SV }) {
  const heads = s.funnel.map((f, i) => (i === 0 || s.funnel[i - 1].stage !== f.stage ? f.stage : null))
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Funnel by step</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Step rate = this step ÷ the step above it, compared with the previous period. No step goals are set yet.</p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[720px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}>
            <th className={`${th} text-left`}>Step · lever · source</th><th className={`${th} text-right`}>Count</th>
            <th className={`${th} text-right`}>Δ</th><th className={`${th} text-right`}>Step rate</th><th className={`${th} text-right`}>Prev. rate</th>
          </tr></thead>
          <tbody>
            {s.funnel.map((f, i) => {
              const head = heads[i]
              return [
                head && <tr key={`h-${f.id}`}><td colSpan={5} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono }}>{head}</td></tr>,
                <tr key={f.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-3 py-3">
                    <p className="font-semibold">{f.label}</p>
                    <p className="text-[13px]" style={{ color: T.muted }}>{f.lever} · {f.source}</p>
                    {f.note && <p className="text-[12px] mt-0.5" style={{ color: T.faint }}>{f.note}</p>}
                  </td>
                  <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(f.cur)}</td>
                  <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: deltaColor(f.cur != null && f.prev != null ? f.cur - f.prev : null) }}>
                    {f.cur != null && f.prev != null ? fmtPctSigned(f.prev ? (f.cur - f.prev) / f.prev : null) : '–'}
                  </td>
                  <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: f.rate != null && f.prevRate != null ? deltaColor(f.rate - f.prevRate) : T.ink }}>{fmtPct(f.rate)}</td>
                  <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: T.muted }}>{fmtPct(f.prevRate)}</td>
                </tr>,
              ]
            })}
            <tr><td colSpan={5} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono }}>Not tracked yet</td></tr>
            {s.notTracked.map(n => (
              <tr key={n.step} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3" colSpan={5}>
                  <p className="font-semibold" style={{ color: T.muted }}>{n.step}</p>
                  <p className="text-[13px]" style={{ color: T.faint }}>To unlock: {n.unlock}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Sources({ s }: { s: SV }) {
  if (!s.sources || !s.wsSources) return null
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
      <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
        <H2>Where YouTube visitors come from</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Every Clay site visitor with a YouTube referrer or YouTube UTM, grouped by how the link was tagged.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>Source</th><th className={`${th} text-right`}>YT views</th><th className={`${th} text-right`}>Visitors</th><th className={`${th} text-right`}>Δ</th><th className={`${th} text-right`}>Offer page</th></tr></thead>
          <tbody>{s.sources.map(r => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3">{r.label}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{r.views == null ? '–' : fmtInt(r.views)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.visitors)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: deltaColor(r.visitors - r.prevVisitors) }}>{fmtPctSigned(r.prevVisitors ? (r.visitors - r.prevVisitors) / r.prevVisitors : null)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.offer)}</td>
            </tr>))}
          </tbody></table></div>
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
        <H2>Workspaces credited to YouTube</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Blended first-touch attribution, the same model as the Workspaces tab{s.kpis.workspaces.mention != null && <>. Another <span style={{ fontFamily: T.mono }}>{fmtInt(s.kpis.workspaces.mention)}</span> said “YouTube” in the signup survey but were credited to a higher-priority channel (mostly MCP)</>}.</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>How credited</th><th className={`${th} text-right`}>New</th><th className={`${th} text-right`}>Δ</th><th className={`${th} text-right`}>HQ</th><th className={`${th} text-right`}>Activated</th><th className={`${th} text-right`}>Paid</th></tr></thead>
          <tbody>{s.wsSources.map(r => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3">{r.label}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.cur)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: deltaColor(r.cur - r.prev) }}>{r.cur - r.prev === 0 ? '0' : fmtSigned(r.cur - r.prev)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.hq)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.act)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.paid)}</td>
            </tr>))}
          </tbody></table></div>
      </Card>
    </div>
  )
}

function TrackedLinks({ s }: { s: SV }) {
  if (s.scope !== 'peter') return null
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Tracked links</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Visitors per tagged link (utm_campaign starting pk_yt_), plus the offer page, which Peter’s descriptions reach through clay.link/pkytcohorts. Short links (dub.sh) can only be tied to a video if they carry a pk_yt_ tag.</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={tableHead}><th className={`${th} text-left`}>Link</th><th className={`${th} text-right`}>Visitors</th><th className={`${th} text-right`}>Previous</th></tr></thead>
        <tbody>
          <tr style={{ borderBottom: `1px solid ${T.border}` }}><td className="px-3 py-3">Offer page · cohorts.clay.com/wedge <Pill tone="amber" title="The offer-page link has no creator tag; credited to Peter because only his descriptions link it">Medium confidence</Pill></td>
            <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(s.offerVisitors)}</td><td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: T.muted }}>{fmtInt(s.funnel.find(f => f.id === 'offer')?.prev)}</td></tr>
          {s.campaigns.map(c => (
            <tr key={c.campaign} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3" style={{ fontFamily: T.mono }}>{c.campaign}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(c.visitors)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: T.muted }}>{fmtInt(c.prev)}</td>
            </tr>))}
        </tbody></table></div>
    </Card>
  )
}

function AfterSignup({ s }: { s: SV }) {
  const n = s.kpis.workspaces.cur
  const chip = (label: string, v: number) => (
    <span className="text-[15px]" style={{ color: T.ink }}>{label} <span style={{ fontFamily: T.mono }}>{fmtInt(v)} · {fmtPct(n ? v / n : null, 0)}</span></span>
  )
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-5">
      <H2>After signup: did they pay, expand or churn?</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>{fmtInt(n)} workspaces created in this range, status today. Expanded = upgraded from a paid plan or bought a credit pack after the first invoice. Churned = paid, then cancelled and no longer a customer.</p>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        {chip('Still free', s.outcome.free)}{chip('Paid', s.outcome.paidOnly)}{chip('Paid & expanded', s.outcome.expanded)}{chip('Paid, then churned', s.outcome.churned)}
      </div>
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <div className="overflow-x-auto"><table className="w-full text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>Current plan</th><th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Expanded</th><th className={`${th} text-right`}>Churned</th></tr></thead>
          <tbody>{s.plans.map(p => (
            <tr key={p.plan} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold">{p.plan}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(p.n)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtPct(n ? p.n / n : null)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(p.exp)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: p.churn ? T.neg : T.ink }}>{fmtInt(p.churn)}</td>
            </tr>))}</tbody></table></div>
        <div className="overflow-x-auto"><table className="w-full text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>Signup month</th><th className={`${th} text-right`}>New</th><th className={`${th} text-right`}>Activated</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Expanded</th><th className={`${th} text-right`}>Churned</th></tr></thead>
          <tbody>{s.months.map(m => (
            <tr key={m.month} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold">{new Date(`${m.month}-01T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(m.n)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(m.act)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(m.paid)} <span style={{ color: T.muted }}>{fmtPct(m.n ? m.paid / m.n : null, 0)}</span></td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(m.exp)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(m.churn)}</td>
            </tr>))}</tbody></table></div>
      </div>
    </Card>
  )
}

function PersonaAndTiers({ s }: { s: SV }) {
  const total = s.personas.reduce((a, p) => a + p.n, 0)
  const answered = s.personas.filter(p => p.label !== 'Not answered')
  const answeredTotal = answered.reduce((a, p) => a + p.n, 0)
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Signups by persona</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Onboarding survey “team” answer for new workspaces · {fmtInt(answeredTotal)} of {fmtInt(total)} answered.</p>
        <ul className="flex flex-col gap-2.5">{answered.map(p => (
          <li key={p.label} className="grid grid-cols-[150px_1fr_56px] items-center gap-4 text-[15px]">
            <span>{p.label}</span>
            <div className="h-[14px] rounded" style={{ background: '#F1F0EC' }}><div className="h-full rounded" style={{ width: `${answeredTotal ? (p.n / answeredTotal) * 100 : 0}%`, background: T.pos }} /></div>
            <span className="text-right" style={{ fontFamily: T.mono }}>{fmtPct(answeredTotal ? p.n / answeredTotal : null, 0)}</span>
          </li>))}</ul>
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Tier mix{s.tiers.existing ? ': new vs existing' : ''}</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>{s.tiers.existing ? 'Existing = workspaces created before the person first clicked one of Peter’s links. They still count as influence.' : 'SFDC Sales Tier of the customer domain, new workspaces credited to YouTube.'}</p>
        <table className="w-full text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>Tier</th><th className={`${th} text-right`}>New</th>{s.tiers.existing && <><th className={`${th} text-right`}>Existing</th><th className={`${th} text-right`}>New share</th></>}</tr></thead>
          <tbody>{s.tiers.labels.map((l, i) => (
            <tr key={l} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold">{l}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(s.tiers.fresh[i])}</td>
              {s.tiers.existing && <>
                <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(s.tiers.existing[i])}</td>
                <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtPct(s.tiers.fresh[i] + s.tiers.existing[i] ? s.tiers.fresh[i] / (s.tiers.fresh[i] + s.tiers.existing[i]) : null, 0)}</td>
              </>}
            </tr>))}</tbody></table>
      </Card>
    </div>
  )
}

const LINK_LABEL = { tagged: 'Tagged link', offer: 'Offer page', short: 'Short link (untagged)', untagged: 'Clay link (untagged)', none: 'No Clay link' } as const

function Videos({ s }: { s: SV }) {
  const [sort, setSort] = useState<'views' | 'newest'>('views')
  const rows = [...s.videos].sort((a, b) => sort === 'views' ? b.views - a.views : b.published.localeCompare(a.published))
  const dur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  return (
    <section className="flex flex-col gap-4">
      <Eyebrow>Deep dive</Eyebrow>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <H2>Videos</H2>
        <Segmented ariaLabel="Sort videos" value={sort} onChange={setSort} options={[{ id: 'views', label: 'Most views' }, { id: 'newest', label: 'Newest' }]} />
      </div>
      <p className="text-[15px]" style={{ color: T.muted }}>Views and watch time in the selected range. Visitors show only where the video’s link carries its own utm_campaign; YouTube does not pass the video to the site otherwise.</p>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>Video</th><th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Δ</th><th className={`${th} text-right`}>Watch hrs</th><th className={`${th} text-left`}>Clay link</th><th className={`${th} text-right`}>Visitors</th></tr></thead>
          <tbody>{rows.map(v => (
            <tr key={v.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3">
                <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{v.title}</a>
                <p className="text-[13px]" style={{ color: T.muted, fontFamily: T.mono }}>{fmtShort(v.published)} · {v.channel} · {dur(v.durationSec)}</p>
              </td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(v.views)}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono, color: deltaColor(v.views - v.prevViews) }}>{v.prevViews ? fmtPctSigned((v.views - v.prevViews) / v.prevViews) : v.views ? 'new' : '–'}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{fmtInt(v.minutes / 60)}</td>
              <td className="px-3 py-3 text-[13px]" style={{ color: v.link.kind === 'tagged' ? T.ink : T.muted }}>{LINK_LABEL[v.link.kind]}{v.link.campaign && <div style={{ fontFamily: T.mono }}>{v.link.campaign}</div>}</td>
              <td className="px-3 py-3 text-right" style={{ fontFamily: T.mono }}>{v.trackedVisitors != null ? fmtInt(v.trackedVisitors) : '–'}</td>
            </tr>))}</tbody>
        </table>
      </Card>
    </section>
  )
}

export const DEFINITIONS: { metric: string; definition: string; source: string }[] = [
  { metric: 'YouTube views', definition: 'Views in the range on the channels in scope (All = Peter Kang + Clay brand channel; Payton and Eric once connected). All traffic sources.', source: 'YouTube Analytics API, synced to this page’s store' },
  { metric: 'Visitors from YouTube', definition: 'Distinct website visitors (cookie) with a youtube.com referrer or a YouTube utm_source, any Clay site. Peter: utm_campaign pk_yt_* or offer-page visits from YouTube.', source: 'DBT.PROD.MARKETING_PAGEVIEWS' },
  { metric: 'Offer page visitors', definition: 'Those visitors who viewed cohorts.clay.com/wedge.', source: 'DBT.PROD.MARKETING_PAGEVIEWS' },
  { metric: 'Offer page form submits', definition: 'Distinct visitors who submitted the /wedge form after arriving from YouTube. No email is captured.', source: 'SEGMENT.VERCEL.FORM_SUBMITTED' },
  { metric: 'New workspaces (All)', definition: 'Workspaces whose blended first-touch channel is YouTube (subchannel “…: youtube”), by creation date. Same model as the Workspaces tab, so totals reconcile.', source: 'FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION (90-day window)' },
  { metric: `New workspaces (creator)`, definition: `Workspaces created within ${CREATOR_WINDOW_DAYS} days after a visitor first clicked the creator’s link, matched by website cookie. Influence, not exclusive credit.`, source: 'MARKETING_PAGEVIEWS → COOKIE_TO_WORKSPACE_RELATIONSHIP' },
  { metric: 'Existing workspaces re-engaged', definition: 'Workspaces created before that first click.', source: 'Same join' },
  { metric: `Activated (${ACTIVATION_DAYS}d)`, definition: `Reached the golden table (2+ advanced and 1+ basic enrichments) within ${ACTIVATION_DAYS} days of creation.`, source: 'BINARY_ACTIVATED_WORKSPACE, DAYS_TO_ACTIVATION' },
  { metric: 'Paid · expanded · churned', definition: 'Paid = has a first invoice. Expanded = upgraded from a paid plan, or bought a credit pack after the first invoice. Churned = paid, cancelled, and not a current customer.', source: 'DBT.PROD.CUSTOMERS, CREDIT_PACK_INVOICES' },
  { metric: 'Persona', definition: 'Onboarding survey “team” answer (latest response per workspace).', source: 'DBT.PROD.ONBOARDING_SURVEY.TEAMS' },
  { metric: 'Tier', definition: 'SFDC Sales Tier of the customer email domain; Unmatched = no SFDC account.', source: 'CUSTOMERS.DOMAIN → SALESFORCE.ACCOUNT.SALES_TIER_C' },
]

function Definitions() {
  return (
    <Card className="p-5 sm:p-8">
      <details>
        <summary className="cursor-pointer text-[18px] font-bold" style={{ color: T.ink }}>Metric definitions & sources</summary>
        <div className="overflow-x-auto mt-4"><table className="w-full min-w-[720px] text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={tableHead}><th className={`${th} text-left`}>Metric</th><th className={`${th} text-left`}>Definition</th><th className={`${th} text-left`}>Source</th></tr></thead>
          <tbody>{DEFINITIONS.map(d => (
            <tr key={d.metric} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold align-top whitespace-nowrap">{d.metric}</td>
              <td className="px-3 py-3 align-top leading-relaxed">{d.definition}</td>
              <td className="px-3 py-3 align-top text-[13px]" style={{ fontFamily: T.mono, color: T.muted }}>{d.source}</td>
            </tr>))}</tbody></table></div>
      </details>
    </Card>
  )
}

export default function SocialView({ s, loading }: { s: SV; loading: boolean }) {
  const k = s.kpis
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="YouTube views" value={fmtK(k.views.cur)}>
          <Delta value={k.views.delta}>{fmtPctSigned(k.views.delta)}</Delta> vs previous{k.views.lagging && <> (first {k.views.days} days, YouTube lags)</>} · {fmtInt(k.views.minutes / 60)} watch hrs · {fmtSigned(k.views.subs)} subs
        </Tile>
        <Tile label="Site visitors" value={fmtInt(k.visitors.cur)}>
          <Delta value={k.visitors.delta}>{fmtPctSigned(k.visitors.delta)}</Delta> vs previous{s.scope === 'peter' && <> · {fmtPct(k.visitors.clickRate)} of views</>}
        </Tile>
        <Tile label="New workspaces" value={fmtInt(k.workspaces.cur)}>
          <Delta value={k.workspaces.delta}>{fmtPctSigned(k.workspaces.delta)}</Delta> vs previous · {fmtInt(k.workspaces.hq)} HQ
          {k.workspaces.existing != null && <> · {fmtInt(k.workspaces.existing)} existing re-engaged</>}
        </Tile>
        <Tile label={`Activated ≤${ACTIVATION_DAYS}d`} value={fmtInt(k.activated.cur)}>
          {fmtPct(k.activated.rate, 0)} of new workspaces{!k.activated.matured && <> · still maturing</>}
        </Tile>
        <Tile label="Paid" value={fmtInt(k.paid.cur)}>
          {fmtPct(k.paid.rate, 1)} of new workspaces · {fmtInt(k.paid.churned)} churned
        </Tile>
      </div>
      <Trend s={s} />
      <Funnel s={s} />
      <Sources s={s} />
      <TrackedLinks s={s} />
      <AfterSignup s={s} />
      <PersonaAndTiers s={s} />
      <Videos s={s} />
      <Card className="p-6 sm:p-8 flex flex-col gap-3">
        <H2>Discuss</H2>
        <ul className="list-disc pl-6 flex flex-col gap-2 text-[16px]" style={{ color: T.ink }}>
          <li>Only links with a pk_yt_ tag can be tied to a video. Should every description link, including dub.sh and the offer page, carry one?</li>
          <li>{s.scope === 'peter' ? 'Peter’s links bring visitors, but few become new workspaces. Is the offer page the right next step, or should links go to signup?' : 'Most YouTube workspaces are credited from the signup survey. Which creator are they watching?'}</li>
          <li>Of the workspaces from video, how many paid, on which plan, and is anyone churning?</li>
        </ul>
      </Card>
      <Definitions />
    </div>
  )
}
