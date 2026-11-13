'use client'

import { useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SocialMode, SocialViewModel as SV } from '@/lib/plg/social/compute'
import { CHANNELS, COHORT_DAYS, NOT_CONNECTED, NO_ANALYTICS, STEP_GOALS, TIER_LABELS } from '@/lib/plg/social/config'
import { fmtShort } from '@/lib/plg/dates'
import { Card, Delta, Eyebrow, H2, Pill, Segmented, T, deltaColor, fmtInt, fmtK, fmtPct, fmtPctSigned } from '../ui'

export type SocialChannel = 'all' | 'peter' | 'payton'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const mono = { fontFamily: T.mono } as const

function NC({ inline }: { inline?: boolean }) {
  return <span title={NOT_CONNECTED.why} className={inline ? '' : 'text-[13px]'} style={{ color: T.faint, fontStyle: 'italic' }}>{NOT_CONNECTED.label}</span>
}
/** Horizontal bar list (mock .blist): label · bar · value. */
function BarList({ items, max }: { items: { label: string; value: number; text: string; muted?: boolean }[]; max: number }) {
  return (
    <div className="flex flex-col gap-2.5">
      {items.map(it => (
        <div key={it.label} className="grid items-center gap-3 text-[15px]" style={{ gridTemplateColumns: 'minmax(110px, 160px) 1fr 56px', color: it.muted ? T.muted : T.ink }}>
          <span>{it.label}</span>
          <div className="h-[10px] rounded-full overflow-hidden" style={{ background: T.barTrack }}>
            <div className="h-full rounded-full" style={{ width: `${max ? (it.value / max) * 100 : 0}%`, background: it.muted ? '#C9C6BF' : T.pos }} />
          </div>
          <span className="text-right" style={mono}>{it.text}</span>
        </div>
      ))}
    </div>
  )
}
const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
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

function CreatorKpis({ s }: { s: SV }) {
  const k = s.kpis
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="All new workspaces" value={fmtInt(k.newWs.cur)}>
        <Delta value={k.newWs.delta}>{fmtPctSigned(k.newWs.delta)}</Delta> vs previous period
      </Tile>
      <Tile label="Activated" value={fmtInt(k.activated.cur)}>
        <Delta value={k.activated.delta}>{fmtPctSigned(k.activated.delta)}</Delta> vs previous period<br />{fmtPct(k.activated.rate, 0)} of new workspaces ran a first table
      </Tile>
      <Tile label="Paid" value={fmtInt(k.paid.cur)}>
        <Delta value={k.paid.delta}>{fmtPctSigned(k.paid.delta)}</Delta> vs previous period<br />{fmtPct(k.paid.rate, 1)} of new workspaces · {fmtInt(k.paid.churned)} churned
      </Tile>
      <Tile label="Impressions" value={<NC inline />} muted>
        {!k.views.known ? <>Views: <NC inline /> · {fmtInt(k.lifetimeViews)} lifetime public views</> : k.views.cur == null ? 'views pending' : `${fmtInt(k.views.cur)} views`}
      </Tile>
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
        {s.mode === 'cohort' && <> · {fmtInt(k.cohortVideos)} videos in their first {COHORT_DAYS} days during these dates{k.pendingVideos ? `, ${k.pendingVideos} not reported by YouTube yet` : ''}</>}
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
      <Eyebrow>Biggest leak</Eyebrow>
      <p className="text-[26px] font-bold" style={{ color: '#3B1405', letterSpacing: '-0.02em' }}>{({ visits: s.showEmailSteps ? 'View → offer page' : 'View → site visit', captures: 'Offer page → email capture', ws: s.showEmailSteps ? 'Email capture → new workspace' : 'Site visit → new workspace' } as Record<string, string>)[s.leak.id] ?? s.leak.label}</p>
      <p className="text-[15px]" style={{ color: '#3B1405' }}>+{fmtInt(s.leak.impact)} new workspaces if this step hit goal</p>
    </div>
  )
}

const TREND_NAMES = { views: 'Views', visits: 'Tagged visits', untagged: 'Untagged visits', ws: 'New workspaces (tagged)', ws_untagged: 'New workspaces (untagged)' } as const
function Trend({ s }: { s: SV }) {
  const [metric, setMetric] = useState<(typeof s.trend)[number]['metric']>(s.yt.viewsKnown ? 'views' : 'visits')
  const viewsNc = metric === 'views' && !s.yt.viewsKnown
  const tr = s.trend.find(x => x.metric === metric) ?? s.trend[0]
  const data = tr.cur.map((p, i) => ({ label: fmtShort(p.d), cur: p.v, prev: tr.prev[i]?.v ?? null }))
  const cur = sum(tr.cur.map(p => p.v ?? 0)); const prev = sum(tr.prev.map(p => p.v ?? 0))
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <H2>Trend</H2>
          <p className="text-[15px] mt-1" style={{ color: T.muted }}>
            <span style={{ ...mono, color: T.ink }}>{viewsNc ? <NC inline /> : fmtInt(cur)}</span> <Delta value={prev ? (cur - prev) / prev : null}>{fmtPctSigned(prev ? (cur - prev) / prev : null)}</Delta> vs previous period ({fmtInt(prev)})
          </p>
        </div>
        <label className="flex items-center gap-3 text-[15px]" style={{ color: T.muted }}>Metric
          <select value={metric} onChange={e => setMetric(e.target.value as typeof metric)} className="rounded-xl px-3 py-2 text-[15px]" style={{ border: `1px solid ${T.border}`, background: '#fff', ...mono, color: T.ink }}>
            {s.trend.map(x => <option key={x.metric} value={x.metric}>{TREND_NAMES[x.metric]}</option>)}
          </select>
        </label>
      </div>
      {viewsNc ? <p className="h-[220px] flex items-center justify-center text-[15px]" style={{ color: T.faint, fontStyle: 'italic' }} title={NO_ANALYTICS}>Views: Not connected</p> : <div className="h-[220px]">
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
      </div>}
      <p className="text-[13px]" style={{ color: T.muted }}>Every table below follows the range.</p>
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
                <td className={num} style={mono}>{r.analytics ? fmtInt(r.views) : <NC />}</td>
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
      <p className="text-[15px]" style={{ color: T.muted }}>Each step’s conversion is scored against its own goal. Impact holds every other step at today’s rate, so the steps are directly comparable.{s.showEmailSteps && ' Email steps: Qualified emails, opens and clicks are not connected yet.'}</p>
      {s.channel?.fallbackNote && <p className="text-[13px]" style={{ color: T.faint }}>{s.channel.fallbackNote}</p>}
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[820px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step · lever · source</th><th className={`${th} text-right`}>Count</th><th className={`${th} text-right`}>Δ</th>
            <th className={`${th} text-right`}>Step rate</th><th className={`${th} text-right`}>Goal</th><th className={`${th} text-right`}>Prev. rate</th><th className={`${th} text-right`}>If at goal</th>
          </tr></thead>
          <tbody>{s.steps.map((st, i) => {
            const stageHead = i === 0 || s.steps[i - 1].stage !== st.stage
            const below = st.rate != null && st.goal != null && st.rate < st.goal
            const blank = !!st.notConnected && st.id !== 'views'
            return [
              stageHead && <tr key={`h-${st.id}`}><td colSpan={7} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>{st.stage}</td></tr>,
              <tr key={st.id} style={{ borderBottom: `1px solid ${T.border}`, background: s.leak?.id === st.id ? '#FFF4EC' : undefined }}>
                <td className="px-3 py-3">
                  <p className="font-semibold">{st.label} {s.leak?.id === st.id && <Pill tone="behind">Biggest leak</Pill>}</p>
                  <p className="text-[13px]" style={{ color: T.muted }}>{st.lever} · {st.source}{st.goalNote && ` · goal ${st.goalNote}`}</p>
                </td>
                <td className={num} style={mono}>{blank ? <NC /> : st.cur == null ? (st.id === 'views' && !s.yt.viewsKnown ? <NC /> : <span style={{ color: T.faint }}>pending</span>) : fmtInt(st.cur)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(st.cur != null && st.prev ? st.cur - st.prev : null) }}>{blank ? '' : fmtPctSigned(st.cur != null && st.prev ? (st.cur - st.prev) / st.prev : null)}</td>
                <td className={num} style={{ ...mono, color: below ? T.neg : T.ink }}>{st.id === 'views' || (blank && st.goal != null) ? <NC /> : blank ? '' : st.rate == null && st.id === 'visits' && !s.yt.viewsKnown ? <NC /> : fmtPct(st.rate, st.rate != null && st.rate < 0.1 ? 1 : 0)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{st.goal != null ? fmtPct(st.goal, 0) : ''}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{st.id === 'views' || blank ? '' : fmtPct(st.prevRate, st.prevRate != null && st.prevRate < 0.1 ? 1 : 0)}</td>
                <td className={num} style={mono}>{st.id === 'views' || (blank && st.goal != null) || st.impact == null ? <NC /> : st.impact ? `+${fmtInt(st.impact)} WS` : blank ? '' : '–'}</td>
              </tr>,
            ]
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}

function VideoTable({ s }: { s: SV }) {
  const [sort, setSort] = useState<'workspaces' | 'visit' | 'newest'>('workspaces')
  const [sel, setSel] = useState<string | null>(null)
  const rows = [...s.videos].sort((a, b) =>
    sort === 'newest' ? b.published.localeCompare(a.published)
      : sort === 'visit' ? (b.visitRate ?? -1) - (a.visitRate ?? -1) || (b.views ?? b.lifetimeViews) - (a.views ?? a.lifetimeViews)
        : (b.newWs ?? -1) - (a.newWs ?? -1) || (b.views ?? b.lifetimeViews) - (a.views ?? a.lifetimeViews))
  const showCapture = s.videos.some(v => v.offerPage && v.tagged)
  const dur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const rateCell = (r: number | null, goal: number) => (
    <span style={{ color: r != null && r < goal ? T.neg : T.ink }}>{fmtPct(r, r != null && r < 0.1 ? 1 : 0)}</span>
  )
  return (
    <section className="flex flex-col gap-4">
      <Eyebrow>Deep dive</Eyebrow>
      <H2>Videos</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Rates in orange are below goal. Each video is measured over its first {COHORT_DAYS} days after publish. Existing = workspaces that already existed when someone in them visited from the video. Select a video to cut it by device and geo below; select it again to go back to the whole channel.</p>
      <div className="self-start"><Segmented ariaLabel="Sort videos" value={sort} onChange={setSort}
        options={[{ id: 'workspaces', label: 'Most workspaces' }, { id: 'visit', label: 'Best view → visit' }, { id: 'newest', label: 'Newest' }]} /></div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1320px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Video</th><th className={`${th} text-right`}>Impr.</th><th className={`${th} text-right`}>View %</th>
            <th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Visit %</th>
            {showCapture && <th className={`${th} text-right`}>Capture %</th>}
            <th className={`${th} text-right`}>New WS %</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Activated</th><th className={`${th} text-right`}>Paid</th>
            <th className={`${th} text-right`}>New T1·T2·T3·T4</th><th className={`${th} text-right`}>Existing T1·T2·T3·T4</th>
          </tr></thead>
          <tbody>{rows.map(v => (
            <tr key={v.id} style={{ borderBottom: `1px solid ${T.border}`, background: sel === v.id ? '#E8F6F8' : undefined }}>
              <td className="px-3 py-3 min-w-[300px]">
                <div className="flex items-start gap-3">
                  <span className="text-[12px] pt-1 w-10 shrink-0 text-right" style={{ color: T.faint, ...mono }}>{dur(v.durationSec)}</span>
                  <span>
                    {v.tagged
                      ? <button type="button" onClick={() => setSel(sel === v.id ? null : v.id)} aria-pressed={sel === v.id} className="font-semibold text-left hover:underline">{v.title}</button>
                      : <span className="font-semibold">{v.title}</span>}
                    <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="ml-2 text-[12px] hover:underline" style={{ color: T.muted }}>YouTube ↗</a>
                    <span className="block text-[13px]" style={{ color: T.muted, ...mono }}>{fmtShort(v.published)} · {v.channel}{!v.cohortComplete && ` · day ${v.cohortDay} of ${COHORT_DAYS}`}</span>
                  </span>
                </div>
              </td>
              <td className={num}><NC /></td>
              <td className={num}><NC /></td>
              <td className={num} style={mono}>{!v.analytics
                ? <span title={`${fmtInt(v.lifetimeViews)} lifetime public views (Data API)`}><NC /></span>
                : v.views ? fmtInt(v.views) : <span style={{ color: T.faint }}>pending</span>}</td>
              <td className={num} style={mono}>{!v.analytics && v.tagged ? <NC /> : rateCell(v.visitRate, STEP_GOALS.viewToVisit)}</td>
              {showCapture && <td className={num} style={mono}>{v.offerPage ? rateCell(v.captureRate, STEP_GOALS.capture) : '–'}</td>}
              <td className={num} style={mono}>{rateCell(v.wsRate, v.offerPage ? STEP_GOALS.newWorkspaceOfCaptures : STEP_GOALS.newWorkspace)}</td>
              <td className={num} style={mono}>{v.newWs != null ? fmtInt(v.newWs) : '–'}</td>
              <td className={num} style={mono}>{v.activated != null ? fmtInt(v.activated) : '–'}</td>
              <td className={num} style={mono}>{v.paid != null ? fmtInt(v.paid) : '–'}</td>
              <td className={num}><Tiers t={v.tiersNew ? v.tiersNew.slice(0, 4) : null} /></td>
              <td className={num} style={{ color: T.muted }}><Tiers t={v.tiersExisting ? v.tiersExisting.slice(0, 4) : null} /></td>
            </tr>))}
            {s.backCatalog.map(b => (
              <tr key={`bc-${b.channel}`} style={{ borderBottom: `1px solid ${T.border}`, background: '#F6F5F2' }}>
                <td className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-[12px] pt-1 w-10 shrink-0 text-right" style={{ color: T.faint, ...mono }}>—</span>
                    <span><span className="font-semibold">Back catalog (earlier videos)</span>
                      <span className="block text-[13px]" style={{ color: T.muted, ...mono }}>Past their first {COHORT_DAYS} days · these dates · {b.channel}</span></span>
                  </div>
                </td>
                <td className={num}><NC /></td><td className={num}><NC /></td><td className={num}><NC /></td>
                <td className={num} style={mono} title="Visitors during these dates">{fmtInt(b.visits)} visits</td>
                {showCapture && <td className={num} style={{ color: T.faint }}>–</td>}
                <td className={num} style={mono}>{fmtPct(b.visits ? b.newWs / b.visits : null, 1)}</td>
                <td className={num} style={mono}>{fmtInt(b.newWs)}</td>
                <td className={num} style={mono}>{fmtInt(b.activated)}</td>
                <td className={num} style={mono}>{fmtInt(b.paid)}</td>
                <td className={num}><Tiers t={b.tiersNew.slice(0, 4)} /></td>
                <td className={num} style={{ color: T.faint }}>–</td>
              </tr>
            ))}</tbody>
        </table>
      </Card>
      <Cuts s={s} sel={sel} onClear={() => setSel(null)} />
    </section>
  )
}

function Cuts({ s, sel, onClear }: { s: SV; sel: string | null; onClear: () => void }) {
  const v = sel ? s.videos.find(x => x.id === sel) ?? null : null
  const device = v ? v.device : s.cuts.device
  const geo = v ? v.geo : s.cuts.geo
  const offer = v ? v.offerPage : s.videos.some(x => x.offerPage && x.tagged)
  const total = device.reduce((a, r) => a + r.visits, 0)
  const capRate = (r: { visits: number; captures: number }) => (offer ? fmtPct(r.visits ? r.captures / r.visits : null, 0) : '–')
  const empty = <tr><td colSpan={5} className="px-3 py-4" style={{ color: T.muted }}>No tagged visits for this selection.</td></tr>
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h3 className="text-[20px] font-bold" style={{ color: T.ink, letterSpacing: '-0.02em' }}>Cut by device and geo · {v ? v.title : `${s.channel?.label ?? 'All channels'}’s channel`}</h3>
        {v && <button type="button" onClick={onClear} className="rounded-full px-4 py-2 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>Show whole channel</button>}
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Card className="p-5 sm:p-6 flex flex-col gap-3 overflow-x-auto">
          <Eyebrow>Device</Eyebrow>
          <table className="w-full min-w-[440px] text-[15px]" style={{ color: T.ink }}>
            <thead><tr style={head}><th className={`${th} text-left`}>Device</th><th className={`${th} text-right`}>Visits</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Visit → capture</th><th className={`${th} text-right`}>New WS</th></tr></thead>
            <tbody>{device.length ? device.map(r => (
              <tr key={r.name} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3">{r.name}</td><td className={num} style={mono}>{fmtInt(r.visits)}</td>
                <td className={num} style={mono}>{fmtPct(total ? r.visits / total : null, 0)}</td>
                <td className={num} style={mono}>{capRate(r)}</td><td className={num} style={mono}>{fmtInt(r.newWs)}</td>
              </tr>)) : empty}</tbody>
          </table>
        </Card>
        <Card className="p-5 sm:p-6 flex flex-col gap-3 overflow-x-auto">
          <Eyebrow>Geo</Eyebrow>
          <table className="w-full min-w-[440px] text-[15px]" style={{ color: T.ink }}>
            <thead><tr style={head}><th className={`${th} text-left`}>Region</th><th className={`${th} text-right`}>Visits</th><th className={`${th} text-right`}>Visit → capture</th><th className={`${th} text-right`}>MQAL rate</th><th className={`${th} text-right`}>New WS</th></tr></thead>
            <tbody>{geo.length ? geo.map(r => (
              <tr key={r.name} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3">{r.name}</td><td className={num} style={mono}>{fmtInt(r.visits)}</td>
                <td className={num} style={mono}>{capRate(r)}</td>
                <td className={num}><span title="Captured emails are not in Snowflake, so their domains can't be tiered" style={{ color: T.faint, fontStyle: 'italic' }}>Not connected</span></td>
                <td className={num} style={mono}>{fmtInt(r.newWs)}</td>
              </tr>)) : empty}</tbody>
          </table>
        </Card>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>Clicks and click → visit need YouTube link-click data (not connected). Device is the visitor’s OS (iOS isn’t reported, so it shows as Unknown); region is the browser timezone. New workspaces are matched to the visit through Clay’s cookie map, so a few land in Unknown.</p>
    </>
  )
}

function AfterSignup({ s }: { s: SV }) {
  const a = s.afterSignup
  const chip = (label: string, v: number) => (
    <span className="text-[15px]" style={{ color: T.ink }}>{label} <span style={mono}>{fmtInt(v)} · {fmtPct(a.n ? v / a.n : null, 0)}</span></span>
  )
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-5">
      <H2>After signup: did they pay, expand or churn?</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>{fmtInt(a.n)} workspaces created from video in this range, status today. Expanded = upgraded plan or bought more credits.</p>
      <div className="flex flex-wrap gap-x-8 gap-y-2">{chip('Still on Free', a.free)}{chip('Paid', a.paidOnly)}{chip('Paid & expanded', a.expanded)}{chip('Paid, then churned', a.churned)}</div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
      <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}><th className={`${th} text-left`}>Current plan</th><th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Expanded</th><th className={`${th} text-right`}>Churned</th></tr></thead>
        <tbody>{a.plans.length ? a.plans.map(p => (
          <tr key={p.plan} style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="px-3 py-3 font-semibold">{p.plan}</td>
            <td className={num} style={mono}>{fmtInt(p.n)}</td>
            <td className={num} style={mono}>{fmtPct(a.n ? p.n / a.n : null)}</td>
            <td className={num} style={mono}>{fmtInt(p.exp)}</td>
            <td className={num} style={{ ...mono, color: p.churn ? T.neg : T.ink }}>{fmtInt(p.churn)}</td>
          </tr>)) : <tr><td colSpan={5} className="px-3 py-4" style={{ color: T.muted }}>No new workspaces from video in this range.</td></tr>}</tbody>
      </table></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[15px]" style={{ color: T.ink }}>
        <thead><tr style={head}><th className={`${th} text-left`}>Signup month</th><th className={`${th} text-right`}>New WS</th><th className={`${th} text-right`}>Activated</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Expanded</th><th className={`${th} text-right`}>Churned</th></tr></thead>
        <tbody>{s.signupMonths.length ? s.signupMonths.map(m => (
          <tr key={m.month} style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="px-3 py-3 font-semibold">{monthLabel(m.month)}</td>
            <td className={num} style={mono}>{fmtInt(m.n)}</td><td className={num} style={mono}>{fmtInt(m.act)}</td>
            <td className={num} style={mono}>{fmtInt(m.paid)} <span style={{ color: T.muted }}>{fmtPct(m.n ? m.paid / m.n : null, 0)}</span></td>
            <td className={num} style={mono}>{fmtInt(m.exp)}</td><td className={num} style={{ ...mono, color: m.churn ? T.neg : T.ink }}>{fmtInt(m.churn)}</td>
          </tr>)) : <tr><td colSpan={6} className="px-3 py-4" style={{ color: T.muted }}>No new workspaces from video in this range.</td></tr>}</tbody>
      </table></div>
      </div>
    </Card>
  )
}

function TierMix({ s }: { s: SV }) {
  const answered = s.persona.filter(p => p.label !== 'No answer')
  const people = s.persona.reduce((a, p) => a + p.n, 0)
  const nAns = answered.reduce((a, p) => a + p.n, 0)
  const noAns = people - nAns
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Signups by persona</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Persona collected after signup · new and existing workspaces · <span style={mono}>{fmtInt(people)}</span> workspaces{noAns ? <>, <span style={mono}>{fmtInt(noAns)}</span> with no survey answer</> : ''}. Source: onboarding survey (team).</p>
        {answered.length
          ? <BarList max={answered[0].n} items={answered.map(p => ({ label: p.label, value: p.n, text: fmtPct(nAns ? p.n / nAns : null, 0) }))} />
          : <p className="text-[15px]" style={{ color: T.muted }}>No survey answers for these workspaces yet.</p>}
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <H2>Tier mix: new vs existing</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Existing workspaces re-engaged by the video still count as influence.</p>
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
    </div>
  )
}

const DISCUSS = [
  'Where is the biggest leak for each channel, and who owns the fix?',
  'Is visit → email capture an offer page problem or a traffic-quality problem? Check the device and geo cuts.',
  'Of the workspaces that came from video, how many paid? Which plan, and is anyone churning?',
]
function Discuss() {
  return (
    <section className="flex flex-col gap-3">
      <Eyebrow>Discuss</Eyebrow>
      <ul className="list-disc pl-6 flex flex-col gap-2 text-[17px]" style={{ color: T.ink }}>{DISCUSS.map(q => <li key={q}>{q}</li>)}</ul>
    </section>
  )
}

export default function SocialView({ s, loading }: { s: SV; loading: boolean }) {
  const body = s.scope !== 'all' ? (
    <>
      <CreatorKpis s={s} />
      <Leak s={s} />
      <Trend s={s} />
      <Funnel s={s} />
      <AfterSignup s={s} />
      <TierMix s={s} />
      <Discuss />
      <VideoTable s={s} />
    </>
  ) : (
    <>
      <Kpis s={s} />
      <Leak s={s} />
      <Trend s={s} />
      <ChannelsTable s={s} />
      <Unmapped s={s} />
      <TierMix s={s} />
      <Discuss />
    </>
  )
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>{body}</div>
  )
}
