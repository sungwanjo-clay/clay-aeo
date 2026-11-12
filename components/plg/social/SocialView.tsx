'use client'

import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SocialMode, SocialViewModel as SV } from '@/lib/plg/social/compute'
import { CHANNELS, COHORT_DAYS, NOT_CONNECTED, STEP_GOALS, TIER_LABELS } from '@/lib/plg/social/config'
import { fmtShort } from '@/lib/plg/dates'
import { Card, Delta, Eyebrow, H2, Pill, Segmented, T, deltaColor, fmtInt, fmtK, fmtPct, fmtPctSigned } from '../ui'

export type SocialChannel = 'all' | 'peter'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const mono = { fontFamily: T.mono } as const

function NC({ inline }: { inline?: boolean }) {
  return <span title={NOT_CONNECTED.why} className={inline ? '' : 'text-[13px]'} style={{ color: T.faint, fontStyle: 'italic' }}>{NOT_CONNECTED.label}</span>
}
function TBD() {
  return <span title="No persona source table identified yet" className="text-[13px]" style={{ color: T.faint, fontStyle: 'italic' }}>Source TBD</span>
}
/** Compact tier split: T1 · T2 · T3 · T4 · Untiered */
function Tiers({ t }: { t: number[] | null }) {
  if (!t) return <span style={{ color: T.faint }}>–</span>
  return <span style={mono} title={TIER_LABELS.map((l, i) => `${l}: ${t[i]}`).join(' · ')}>{t.map(fmtInt).join(' · ')}</span>
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

export function ChannelPills({ value, onChange }: { value: SocialChannel; onChange: (c: SocialChannel) => void }) {
  const pills = [{ id: 'all', label: 'All channels', ok: true }, ...CHANNELS.map(c => ({ id: c.id, label: c.label, ok: !!c.youtubeId }))]
  return (
    <div className="flex flex-wrap gap-3" role="tablist" aria-label="YouTube channel">
      {pills.map(p => {
        const active = p.id === value
        return (
          <button key={p.id} role="tab" aria-selected={active} disabled={!p.ok}
            title={p.ok ? undefined : 'Not connected yet: needs the channel id and link tag prefix'}
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

export function ModeToggle({ value, onChange }: { value: SocialMode; onChange: (m: SocialMode) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-[13px] uppercase" style={{ letterSpacing: '0.14em', color: T.muted, fontFamily: T.mono }}>Measure by</span>
      <Segmented ariaLabel="Measure by" value={value} onChange={onChange}
        options={[{ id: 'calendar', label: 'Calendar dates' }, { id: 'cohort', label: `Video cohort (first ${COHORT_DAYS} days)` }]} />
    </div>
  )
}

function Kpis({ s }: { s: SV }) {
  const k = s.kpis
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      <Tile label="All new workspaces" value={fmtInt(k.newWs.cur)}>
        <Delta value={k.newWs.delta}>{fmtPctSigned(k.newWs.delta)}</Delta> vs previous
        {k.newWs.untagged != null && <> · {fmtInt(k.newWs.tagged)} tagged, {fmtInt(k.newWs.untagged)} untagged</>}
        {' · '}expected for this impression volume: <NC inline />
      </Tile>
      <Tile label="Activated" value={fmtInt(k.activated.cur)}>{fmtPct(k.activated.rate, 0)} of new workspaces ran a golden table within 7 days</Tile>
      <Tile label="Paid" value={fmtInt(k.paid.cur)}>{fmtPct(k.paid.rate, 1)} of new workspaces</Tile>
      <Tile label="Impressions" value={<NC inline />} muted>Impression CTR (view rate, goal {fmtPct(STEP_GOALS.viewRate, 0)}): <NC inline /></Tile>
      <Tile label="Views" value={k.views.cur == null ? 'pending' : fmtK(k.views.cur)} muted={k.views.cur == null}>
        <Delta value={k.views.delta}>{fmtPctSigned(k.views.delta)}</Delta> vs previous · {fmtPct(k.views.avgPct, 0)} avg viewed · {fmtInt(k.views.minutes / 60)} watch hrs
        {s.mode === 'calendar' && s.yt.lagging && <> · first {s.yt.days} days (YouTube lags)</>}
        {s.mode === 'cohort' && <> · {fmtInt(k.cohortVideos)} videos published in range{k.pendingVideos ? `, ${k.pendingVideos} not reported by YouTube yet` : ''}</>}
      </Tile>
      <Tile label="Tagged site visits" value={fmtInt(k.visits.cur)}>
        <Delta value={k.visits.delta}>{fmtPctSigned(k.visits.delta)}</Delta> vs previous
        {k.visits.untagged != null && <> · plus {fmtInt(k.visits.untagged)} untagged YouTube visitors</>}
      </Tile>
    </div>
  )
}

function Leak({ s }: { s: SV }) {
  if (!s.leak) return null
  return (
    <div className="flex flex-col gap-1">
      <Eyebrow>Biggest leak (available steps)</Eyebrow>
      <p className="text-[26px] font-bold" style={{ color: '#3B1405', letterSpacing: '-0.02em' }}>{s.leak.id === 'visits' ? 'View → site visit' : 'Site visit → new workspace'}</p>
      <p className="text-[15px]" style={{ color: '#3B1405' }}>+{fmtInt(s.leak.impact)} new workspaces if this step hit goal. Impression → view is not included until impressions are connected.</p>
    </div>
  )
}

const TREND_NAMES = { views: 'Views', visits: 'Tagged visits', untagged: 'Untagged visits', ws: 'New workspaces (tagged)', ws_untagged: 'New workspaces (untagged)' } as const
function Trend({ s }: { s: SV }) {
  const [metric, setMetric] = useState<(typeof s.trend)[number]['metric']>('views')
  const tr = s.trend.find(x => x.metric === metric) ?? s.trend[0]
  const data = tr.cur.map((p, i) => ({ label: fmtShort(p.d), cur: p.v, prev: tr.prev[i]?.v ?? null }))
  const cur = sum(tr.cur.map(p => p.v ?? 0)); const prev = sum(tr.prev.map(p => p.v ?? 0))
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H2>Trend</H2>
          <p className="text-[15px] mt-1" style={{ color: T.muted }}>
            <span style={{ ...mono, color: T.ink }}>{fmtInt(cur)}</span> <Delta value={prev ? (cur - prev) / prev : null}>{fmtPctSigned(prev ? (cur - prev) / prev : null)}</Delta> vs previous period ({fmtInt(prev)}) · calendar dates
          </p>
        </div>
        <label className="flex items-center gap-3 text-[15px]" style={{ color: T.muted }}>Metric
          <select value={metric} onChange={e => setMetric(e.target.value as typeof metric)} className="rounded-xl px-3 py-2 text-[15px]" style={{ border: `1px solid ${T.border}`, background: '#fff', ...mono, color: T.ink }}>
            {s.trend.map(x => <option key={x.metric} value={x.metric}>{TREND_NAMES[x.metric]}</option>)}
          </select>
        </label>
      </div>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ECEAE5" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={20} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <YAxis tickFormatter={fmtK} tickLine={false} axisLine={false} width={40} allowDecimals={false} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <Tooltip formatter={(v: unknown, n: unknown) => [v == null ? 'not reported yet' : fmtInt(Number(v)), n === 'cur' ? 'Selected' : 'Previous']} />
            <Bar dataKey="cur" fill={T.pos} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Line dataKey="prev" stroke="#7A7770" strokeDasharray="4 4" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {metric === 'views' && s.yt.lagging && <p className="text-[13px]" style={{ color: T.muted }}>YouTube reports through {fmtShort(s.yt.lastDay!)}.</p>}
    </Card>
  )
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function ChannelsTable({ s }: { s: SV }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Channels side by side</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>
        Tagged = the visit’s utm_campaign maps to one of the channel’s videos. YouTube visits with no campaign go in the untagged row and are never split across videos.
        Tier split: Tier 1 · 2 · 3 · 4 · Untiered.{s.mode === 'cohort' && ' Channel rows use each video’s first 28 days; the untagged row stays on calendar dates.'}
      </p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[1100px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Channel</th><th className={`${th} text-right`}>Impr.</th><th className={`${th} text-right`}>Impr. CTR</th>
            <th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Tagged visits</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Tiers · new</th><th className={`${th} text-right`}>Existing</th><th className={`${th} text-right`}>Tiers · existing</th>
            <th className={`${th} text-right`}>Videos tracked</th>
          </tr></thead>
          <tbody>
            {s.channelRows.map(r => r.connected ? (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3 font-semibold whitespace-nowrap">{r.label} <span className="font-normal text-[13px]" style={{ color: T.muted }}>{r.handle}</span></td>
                <td className={num}><NC /></td><td className={num}><NC /></td>
                <td className={num} style={mono}>{fmtInt(r.views)}</td>
                <td className={num} style={mono}>{fmtInt(r.visits)}</td>
                <td className={num} style={mono}>{fmtInt(r.newWs)}</td>
                <td className={num}><Tiers t={r.tiersNew} /></td>
                <td className={num} style={mono}>{fmtInt(r.existing)}</td>
                <td className={num}><Tiers t={r.tiersExisting} /></td>
                <td className={num} style={{ ...mono, color: r.trackedShare != null && r.trackedShare < 0.5 ? T.neg : T.ink }}>{r.trackedCount} of {r.videoCount} · {fmtPct(r.trackedShare, 0)}</td>
              </tr>
            ) : (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}`, color: T.faint }}>
                <td className="px-3 py-3 font-semibold">{r.label}</td>
                <td className="px-3 py-3 text-[13px] italic" colSpan={9}>Not connected: needs the YouTube channel id and the creator’s link tag prefix</td>
              </tr>
            ))}
            <tr style={{ borderBottom: `1px solid ${T.border}`, background: '#F6F5F2' }}>
              <td className="px-3 py-3 font-semibold">YouTube, untagged</td>
              <td className={num} style={{ color: T.faint }}>–</td><td className={num} style={{ color: T.faint }}>–</td><td className={num} style={{ color: T.faint }}>–</td>
              <td className={num} style={mono} title="Untagged visitors (not tagged visits)">{fmtInt(s.untagged.visits)} <span className="text-[12px]" style={{ color: T.muted }}>untagged</span></td>
              <td className={num} style={mono}>{fmtInt(s.untagged.ws.n)}</td>
              <td className={num}><Tiers t={s.untagged.ws.t} /></td>
              <td className={num} style={{ color: T.faint }}>–</td><td className={num} style={{ color: T.faint }}>–</td><td className={num} style={{ color: T.faint }}>–</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>
        Excluded: {fmtInt(s.affiliateVisitors)} visitors from affiliate creators’ YouTube links (Rewardful ?via= referrals). They are the affiliate channel, not owned YouTube.
      </p>
    </Card>
  )
}

function Unmapped({ s }: { s: SV }) {
  if (!s.unmapped.length) return null
  return (
    <div className="rounded-2xl px-5 py-4 text-[14px] flex flex-col gap-2" style={{ background: T.amberBg, color: T.amberInk }} role="status">
      <p className="font-semibold">Tagged campaigns that are in no current video description</p>
      <p>These carry Peter’s pk_yt_ prefix but no video links them today, so they are not assigned to any video or counted as tagged visits.</p>
      <ul className="flex flex-col gap-1" style={mono}>
        {s.unmapped.map(u => <li key={u.campaign}>{u.campaign} · {fmtInt(u.visits)} visitors (prev {fmtInt(u.prevVisits)}) · {fmtInt(u.ws)} new workspaces</li>)}
      </ul>
    </div>
  )
}

function Funnel({ s }: { s: SV }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Funnel by step: where to push</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Each step’s rate (step ÷ the step above) is scored against its own goal. “If at goal” holds every other step at today’s rate.
        {!s.showEmailSteps && ' Email capture steps are hidden: no video in scope links to the startup offer page.'}</p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[820px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step · lever · source</th><th className={`${th} text-right`}>Count</th><th className={`${th} text-right`}>Δ</th>
            <th className={`${th} text-right`}>Step rate</th><th className={`${th} text-right`}>Goal</th><th className={`${th} text-right`}>Prev. rate</th><th className={`${th} text-right`}>If at goal</th>
          </tr></thead>
          <tbody>{s.steps.map((st, i) => {
            const stageHead = i === 0 || s.steps[i - 1].stage !== st.stage
            const below = st.rate != null && st.goal != null && st.rate < st.goal
            return [
              stageHead && <tr key={`h-${st.id}`}><td colSpan={7} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>{st.stage}</td></tr>,
              <tr key={st.id} style={{ borderBottom: `1px solid ${T.border}`, background: s.leak?.id === st.id ? '#FFF4EC' : undefined }}>
                <td className="px-3 py-3">
                  <p className="font-semibold">{st.label} {s.leak?.id === st.id && <Pill tone="behind">Biggest leak</Pill>}</p>
                  <p className="text-[13px]" style={{ color: T.muted }}>{st.lever} · {st.source}</p>
                </td>
                <td className={num} style={mono}>{st.id === 'impr' ? <NC /> : st.cur == null ? <span style={{ color: T.faint }}>pending</span> : fmtInt(st.cur)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(st.cur != null && st.prev ? st.cur - st.prev : null) }}>{st.id === 'impr' ? '' : fmtPctSigned(st.cur != null && st.prev ? (st.cur - st.prev) / st.prev : null)}</td>
                <td className={num} style={{ ...mono, color: below ? T.neg : T.ink }}>{st.id === 'views' ? <NC /> : st.id === 'impr' ? '' : fmtPct(st.rate, st.rate != null && st.rate < 0.1 ? 1 : 0)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{st.goal != null ? fmtPct(st.goal, 0) : ''}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{st.id === 'views' || st.id === 'impr' ? '' : fmtPct(st.prevRate, st.prevRate != null && st.prevRate < 0.1 ? 1 : 0)}</td>
                <td className={num} style={mono}>{st.id === 'views' ? <NC /> : st.impact ? `+${fmtInt(st.impact)} WS` : st.id === 'impr' ? '' : '–'}</td>
              </tr>,
            ]
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}

const DEST_LABEL = { clay: '', short_unresolved: 'short link · target unknown', external: 'external', none: 'no link' } as const
function VideoTable({ s }: { s: SV }) {
  const dur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  return (
    <section className="flex flex-col gap-4">
      <Eyebrow>Deep dive</Eyebrow>
      <H2>Videos</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Every video measured over its first {COHORT_DAYS} days after publish, whatever the date filter. Visits and workspaces exist only for videos whose link carries a utm_campaign.</p>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Video</th><th className={`${th} text-right`}>Impr.</th><th className={`${th} text-right`}>CTR</th>
            <th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Avg % viewed</th><th className={`${th} text-left`}>Link destination</th>
            <th className={`${th} text-left`}>Tagged</th><th className={`${th} text-right`}>Visits</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Tiers · new</th><th className={`${th} text-right`}>Existing</th><th className={`${th} text-left`}>Persona</th>
          </tr></thead>
          <tbody>{s.videos.map(v => (
            <tr key={v.id} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 min-w-[260px] max-w-[340px]">
                <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{v.title}</a>
                <p className="text-[12px]" style={{ color: T.muted, ...mono }}>{fmtShort(v.published)} · {dur(v.durationSec)} · {v.cohortComplete ? `${COHORT_DAYS}-day cohort` : `day ${v.cohortDay} of ${COHORT_DAYS}`}</p>
              </td>
              <td className={num}><NC /></td><td className={num}><NC /></td>
              <td className={num} style={mono}>{v.views ? fmtInt(v.views) : <span style={{ color: T.faint }} title="YouTube has not reported this video yet">pending</span>}</td>
              <td className={num} style={mono}>{fmtPct(v.avgViewPct, 0)}</td>
              <td className="px-3 py-3 text-[13px] max-w-[260px] break-words" style={mono}>
                {v.destination ?? <span style={{ color: T.faint }}>none</span>}
                {DEST_LABEL[v.destinationKind] && <div style={{ color: v.destinationKind === 'short_unresolved' ? T.neg : T.faint }}>{DEST_LABEL[v.destinationKind]}</div>}
              </td>
              <td className="px-3 py-3 text-[13px]">{v.tagged ? <><span style={{ color: T.pos }}>Yes</span><div style={{ ...mono, color: T.muted }}>{v.campaign}</div></> : <span style={{ color: T.neg }}>No</span>}</td>
              <td className={num} style={mono}>{v.visits != null ? fmtInt(v.visits) : '–'}</td>
              <td className={num} style={mono}>{v.newWs != null ? fmtInt(v.newWs) : '–'}</td>
              <td className={num}><Tiers t={v.tiersNew} /></td>
              <td className={num} style={mono}>{v.existing != null ? fmtInt(v.existing) : '–'}</td>
              <td className="px-3 py-3"><TBD /></td>
            </tr>))}</tbody>
        </table>
      </Card>
    </section>
  )
}

function Checklist({ s }: { s: SV }) {
  if (!s.missingLinks.length) return null
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Videos missing a tracked link</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>{s.missingLinks.length} of {s.videos.length} videos can’t be tied to visits or workspaces. Add a clay.com link with utm_source=youtube&amp;utm_medium=influencerinternal&amp;utm_campaign=pk_yt_… to each description, one campaign per video.</p>
      <ul className="flex flex-col gap-3">{s.missingLinks.map(v => (
        <li key={v.id} className="flex items-start gap-3 text-[15px]">
          <span aria-hidden className="mt-[3px] inline-block w-4 h-4 rounded border shrink-0" style={{ borderColor: T.border, background: '#fff' }} />
          <span>
            <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{v.title}</a>
            <span className="text-[13px]" style={{ color: T.muted }}> · {fmtShort(v.published)} · links to {v.destination ?? 'nothing on clay.com'}{v.destinationKind === 'short_unresolved' ? ' (short link, target unknown)' : ''}</span>
          </span>
        </li>))}</ul>
    </Card>
  )
}

function TierMix({ s }: { s: SV }) {
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Tier mix: new vs existing</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Business domains only, by SFDC Sales Tier (best tier per domain). Personal, academic or no SFDC account = Untiered. Existing = workspaces a tagged visitor already belonged to before the visit.</p>
        <table className="w-full text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}><th className={`${th} text-left`}>Tier</th><th className={`${th} text-right`}>New</th><th className={`${th} text-right`}>Existing</th><th className={`${th} text-right`}>New share</th></tr></thead>
          <tbody>{s.tiers.labels.map((l, i) => {
            const n = s.tiers.fresh[i]; const e = s.tiers.existing[i]
            return (
              <tr key={l} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3 font-semibold">{l}</td>
                <td className={num} style={mono}>{fmtInt(n)}</td><td className={num} style={mono}>{fmtInt(e)}</td>
                <td className={num} style={mono}>{fmtPct(n + e ? n / (n + e) : null, 0)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-3">
        <H2>Signups by persona</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Persona collected after signup, new and existing workspaces.</p>
        <p className="text-[18px]"><TBD /></p>
        <p className="text-[13px]" style={{ color: T.muted }}>No persona source has been agreed yet. The onboarding survey’s TEAMS answer (DBT.PROD.ONBOARDING_SURVEY) is one candidate.</p>
      </Card>
    </div>
  )
}

export default function SocialView({ s, loading }: { s: SV; loading: boolean }) {
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <Kpis s={s} />
      <Leak s={s} />
      <Trend s={s} />
      {s.scope === 'all' ? <ChannelsTable s={s} /> : <Funnel s={s} />}
      <Unmapped s={s} />
      {s.scope === 'peter' && <><VideoTable s={s} /><Checklist s={s} /></>}
      <TierMix s={s} />
      <Card className="p-6 sm:p-8 flex flex-col gap-3">
        <Eyebrow>Discuss</Eyebrow>
        <ul className="list-disc pl-6 flex flex-col gap-2 text-[16px]" style={{ color: T.ink }}>
          <li>Where is the biggest leak for each channel, and who owns the fix?</li>
          <li>{s.missingLinks.length} of {s.videos.length} videos have no tracked link. Who adds pk_yt_ tags to the descriptions?</li>
          <li>Which video brought the most Tier 1–2 workspaces, and should the next video follow its topic?</li>
        </ul>
      </Card>
      <p className="text-[12px]" style={{ color: T.muted }}>
        YouTube data synced {s.yt.fetchedAt ? new Date(s.yt.fetchedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'} through Viewer access to the channel (not an officially supported API path; it may stop working). Snowflake numbers are live through your Clay Sigma connector. Definitions: docs/social-metrics.md.
      </p>
    </div>
  )
}
