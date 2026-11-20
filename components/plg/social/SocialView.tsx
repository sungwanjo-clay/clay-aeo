'use client'

import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SocialMode, SocialViewModel as SV } from '@/lib/plg/social/compute'
import { CHANNELS, COHORT_DAYS, NOT_CONNECTED, NO_ANALYTICS, STEP_GOALS, TIER_LABELS } from '@/lib/plg/social/config'
import { fmtShort } from '@/lib/plg/dates'
import { Card, Delta, Eyebrow, H2, Segmented, T, deltaColor, fmtInt, fmtK, fmtPct, fmtPctSigned, fmtPp } from '../ui'

export type SocialChannel = 'all' | 'peter' | 'payton' | 'eric'

const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-3 text-right whitespace-nowrap'
const mono = { fontFamily: T.mono } as const

function NC({ inline, why, label }: { inline?: boolean; why?: string; label?: string }) {
  return <span title={why ?? NOT_CONNECTED.why} className={inline ? '' : 'text-[13px]'} style={{ color: T.faint, fontStyle: 'italic' }}>{label ?? NOT_CONNECTED.label}</span>
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

function KpiTile({ label, value, delta, badge, foot, muted }: {
  label: string; value: React.ReactNode; delta: number | null; badge?: { label: string; cur: number | null; prev: number | null; title?: string } | null
  foot?: React.ReactNode; muted?: boolean
}) {
  const raw = badge && badge.cur != null && badge.prev != null ? (badge.cur - badge.prev) * 100 : null
  const bd = raw != null && Math.abs(raw) < 0.05 ? 0 : raw
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3 min-w-0" style={{ background: T.tile }}>
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        {badge && (
          <span title={badge.title} className="rounded-full px-2.5 py-1 text-[12px] whitespace-nowrap" style={{ background: '#fff', border: `1px solid ${T.border}`, color: T.ink, fontFamily: T.mono }}>
            {badge.label} {fmtPct(badge.cur, 1)}{bd != null && <span style={{ color: deltaColor(bd) }}> {fmtPp(bd)}</span>}
          </span>
        )}
      </div>
      <p className={muted ? 'text-[22px] leading-tight' : 'text-[40px] leading-none'} style={{ fontFamily: T.mono, color: muted ? T.faint : T.ink }}>{value}</p>
      <p className="text-[15px] leading-snug" style={{ color: T.muted }}>
        {delta == null ? <span>– vs previous period</span>
          : <><span className="rounded-md px-1.5 py-0.5 text-[14px]" style={{ fontFamily: T.mono, color: deltaColor(delta), background: delta > 0 ? '#E6F0FF' : delta < 0 ? '#FCE9E2' : '#EFEEEA' }}>{delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {fmtPctSigned(delta).replace(/^[+−]/, '')}</span> vs previous period</>}
      </p>
      {foot && <p className="text-[13px] leading-snug" style={{ color: T.muted }}>{foot}</p>}
    </div>
  )
}

function Kpis({ s }: { s: SV }) {
  const k = s.kpis
  const lag = s.mode === 'cohort' ? <>Videos in their first {COHORT_DAYS} days during these dates.</>
    : s.yt.lagging && s.yt.lastDay ? <>Through {fmtShort(s.yt.lastDay)}: YouTube reports 2–3 days late, so both periods use the same {s.yt.days} days.</> : null
  const excl = (xs: string[]) => (xs.length ? <> Excludes {xs.join(', ')} (not connected).</> : null)
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile label="Impressions" value={k.impressions.cur == null ? <NC inline why="Needs the channel owner’s one-time sign-in (YouTube Reporting API)" /> : fmtK(k.impressions.cur)}
        muted={k.impressions.cur == null} delta={k.impressions.delta}
        foot={<>{lag}{excl(k.impressions.excluded)}</>} />
      <KpiTile label="Views" value={k.views.cur == null ? <NC inline why={NO_ANALYTICS} /> : fmtK(k.views.cur)} muted={k.views.cur == null} delta={k.views.delta}
        badge={{ label: 'Thumbnail CTR', cur: k.thumbCtr.cur, prev: k.thumbCtr.prev, title: 'Thumbnail clicks ÷ impressions, from YouTube. Change is in percentage points.' }}
        foot={<>{fmtInt(k.views.minutes / 60)} watch hours.{excl(k.views.excluded)}</>} />
      <KpiTile label="Referral visits" value={fmtInt(k.visits.cur)} delta={k.visits.delta}
        badge={{ label: 'CTA CTR', cur: k.ctaCtr.cur, prev: k.ctaCtr.prev, title: 'Visitors from the creators’ links ÷ views (channels with views only). Change is in percentage points.' }}
        foot={<>Visitors from the creators’ clay.com links.{k.visits.untagged != null && <> Plus {fmtInt(k.visits.untagged)} from untagged YouTube links.</>}</>} />
      <KpiTile label="Tier 1–3 workspaces" value={fmtInt(k.tier13.cur)} delta={k.tier13.delta}
        foot={<>Of {fmtInt(k.newWs.cur)} new workspaces · {fmtInt(k.activated.cur)} activated · {fmtInt(k.paid.cur)} paying{k.tier13.untagged != null && <> · incl. untagged YouTube</>}</>} />
    </div>
  )
}

function Trend({ s }: { s: SV }) {
  const first = s.trend.find(t => t.available)?.metric ?? s.trend[0].metric
  const [metric, setMetric] = useState<string>(first)
  const tr = s.trend.find(x => x.metric === metric) ?? s.trend[0]
  const isRate = tr.kind === 'rate'
  const fmt = (v: number | null | undefined) => (v == null ? '–' : isRate ? fmtPct(v, 1) : fmtInt(v))
  const data = tr.cur.map((p, i) => ({ label: fmtShort(p.d), prevLabel: tr.prev[i] ? fmtShort(tr.prev[i].d) : '', cur: p.v, prev: tr.prev[i]?.v ?? null }))
  const { cur, prev } = tr.total
  const delta = cur != null && prev ? (isRate ? null : (cur - prev) / prev) : null
  const rawPp = isRate && cur != null && prev != null ? (cur - prev) * 100 : null
  const pp = rawPp != null && Math.abs(rawPp) < 0.05 ? 0 : rawPp
  const [c0, c1] = s.range.cur, [p0, p1] = s.range.prev
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <H2>Trend</H2>
          <p className="text-[15px] mt-1" style={{ color: T.muted }}>
            <span style={{ ...mono, color: T.ink }}>{fmt(cur)}</span>{' '}
            {isRate ? pp != null && <span style={{ ...mono, color: deltaColor(pp) }}>{fmtPp(pp)}</span> : <Delta value={delta}>{fmtPctSigned(delta)}</Delta>}
            {' '}vs the period before ({fmt(prev)}){tr.days < tr.cur.length && <> · over the {tr.days} days both periods have</>}{s.mode === 'cohort' && <> · calendar days (the tiles use the video cohort)</>}
          </p>
        </div>
        <label className="flex items-center gap-3 text-[15px]" style={{ color: T.muted }}>Metric
          <select value={metric} onChange={e => setMetric(e.target.value)} className="rounded-xl px-3 py-2 text-[15px]" style={{ border: `1px solid ${T.border}`, background: '#fff', ...mono, color: T.ink }}>
            {s.trend.map(x => <option key={x.metric} value={x.metric} disabled={!x.available}>{x.label}{x.available ? '' : ' (not connected)'}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-[13px]" style={{ color: T.muted }}>
        <span className="flex items-center gap-2"><span className="inline-block w-6 h-[3px] rounded" style={{ background: T.pos }} />This period · {fmtShort(c0)} – {fmtShort(c1)}</span>
        <span className="flex items-center gap-2"><span className="inline-block w-6 border-t-2 border-dashed" style={{ borderColor: '#9A968E' }} />Period before · {fmtShort(p0)} – {fmtShort(p1)}</span>
      </div>
      {!tr.available ? <p className="h-[240px] flex items-center justify-center text-[15px]" style={{ color: T.faint, fontStyle: 'italic' }}>{tr.label}: not connected for this channel</p> : <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#ECEAE5" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#D9D6CF' }} minTickGap={20} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <YAxis tickFormatter={v => (isRate ? `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%` : fmtK(v))} tickLine={false} axisLine={false} width={48} allowDecimals={isRate} tick={{ fontSize: 12, fill: T.muted, fontFamily: T.mono }} />
            <Tooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as (typeof data)[number]
              return (
                <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: '#fff', border: `1px solid ${T.border}`, fontFamily: T.mono }}>
                  <div><span style={{ color: T.pos }}>●</span> {d.label}: {d.cur == null ? 'not reported yet' : fmt(d.cur)}</div>
                  <div style={{ color: T.muted }}>○ {d.prevLabel}: {d.prev == null ? 'not reported yet' : fmt(d.prev)}</div>
                </div>
              )
            }} />
            <Line dataKey="prev" name="Period before" stroke="#9A968E" strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
            <Line dataKey="cur" name="This period" stroke={T.pos} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>}
      <p className="text-[13px]" style={{ color: T.muted }}>{tr.note ? `${tr.note}. ` : ''}Days YouTube hasn’t reported yet are left blank, not drawn as zero.</p>
    </Card>
  )
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

function ChannelsTable({ s }: { s: SV }) {
  const live = s.channelRows.filter((r): r is Extract<(typeof s.channelRows)[number], { connected: true }> => r.connected)
  const tot = (f: (r: (typeof live)[number]) => number | null) => { const xs = live.map(f).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null }
  const tiersSum = (ts: (number[] | null)[]) => ts.filter((t): t is number[] => !!t).reduce((acc, t) => acc.map((x, i) => x + t[i]), [0, 0, 0, 0, 0])
  const totalTiers = tiersSum([...live.map(r => r.tiersNew), s.untagged.ws.t])
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Channels side by side</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>
        Referral visits come from each creator’s own clay.com links. YouTube visits with no campaign are in the untagged row.
        Tiers: Tier 1 · 2 · 3 · 4 · Untiered (hover for labels).{s.mode === 'cohort' && ' Channel rows use each video’s first 28 days; the untagged row stays on calendar dates.'}
      </p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[820px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Channel</th>
            <th className={`${th} text-right`}>Impressions</th><th className={`${th} text-right`}>Views</th>
            <th className={`${th} text-right`}>Referral visits</th><th className={`${th} text-right`}>New WS</th><th className={`${th} text-right`}>Tiers · new WS</th>
          </tr></thead>
          <tbody>
            {s.channelRows.map(r => r.connected ? (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3 font-semibold whitespace-nowrap">{r.label} <span className="font-normal text-[13px]" style={{ color: T.muted }}>{r.handle}</span></td>
                <td className={num} style={mono}>{r.impressions != null ? fmtInt(r.impressions) : <NC why="Needs the channel owner’s one-time sign-in (YouTube Reporting API)" />}</td>
                <td className={num} style={mono}>{r.analytics ? fmtInt(r.views) : <NC why={NO_ANALYTICS} />}</td>
                <td className={num} style={mono}>{fmtInt(r.visits)}</td>
                <td className={num} style={mono}>{fmtInt(r.newWs)}</td>
                <td className={num}><Tiers t={r.tiersNew} /></td>
              </tr>
            ) : (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}`, color: T.faint }}>
                <td className="px-3 py-3 font-semibold">{r.label}</td>
                <td className="px-3 py-3 text-[13px] italic" colSpan={5}>Not connected: needs the YouTube channel id and the creator’s link tag prefix</td>
              </tr>
            ))}
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold" style={{ color: T.muted }}>YouTube, untagged</td>
              <td className={num} style={{ color: T.faint }}>–</td><td className={num} style={{ color: T.faint }}>–</td>
              <td className={num} style={mono}>{fmtInt(s.untagged.visits)}</td>
              <td className={num} style={mono}>{fmtInt(s.untagged.ws.n)}</td>
              <td className={num}><Tiers t={s.untagged.ws.t} /></td>
            </tr>
            <tr style={{ background: '#F6F5F2', fontWeight: 600 }}>
              <td className="px-3 py-3">Total</td>
              <td className={num} style={mono}>{fmtInt(tot(r => r.impressions))}</td>
              <td className={num} style={mono}>{fmtInt(tot(r => (r.analytics ? r.views : null)))}</td>
              <td className={num} style={mono}>{fmtInt((tot(r => r.visits) ?? 0) + s.untagged.visits)}</td>
              <td className={num} style={mono}>{fmtInt((tot(r => r.newWs) ?? 0) + s.untagged.ws.n)}</td>
              <td className={num}><Tiers t={totalTiers} /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>
        Excluded: {fmtInt(s.affiliateVisitors)} visitors from other affiliate creators’ YouTube links (Rewardful ?via= referrals); they belong to the affiliate channel, not owned YouTube.
      </p>
      {s.unmapped.length > 0 && (
        <p className="text-[13px]" style={{ color: T.muted }} title="These carry Peter’s pk_yt_ prefix but no current video description links them, so they aren’t assigned to a video or counted as referral visits.">
          Not counted: {s.unmapped.map(u => <span key={u.campaign} style={mono}>{u.campaign} ({fmtInt(u.visits)} visitors, {fmtInt(u.ws)} new WS)</span>).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, ', ', x] : [x]), [])} — campaign links no current video description uses. Add them back to a description to count them.
        </p>
      )}
    </Card>
  )
}

function Funnel({ s }: { s: SV }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Funnel</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Count at each step and the conversion rate from the step before it. Activated and paid are rates of new workspaces. The email steps are placeholders until their data is connected (hover “Not connected” for what’s missing).</p>
      {s.channel?.fallbackNote && <p className="text-[13px]" style={{ color: T.faint }}>{s.channel.fallbackNote}</p>}
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[640px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step · source</th><th className={`${th} text-right`}>Count</th><th className={`${th} text-right`}>Δ</th>
            <th className={`${th} text-right`}>Step rate</th>
          </tr></thead>
          <tbody>{s.steps.map((st, i) => {
            const stageHead = i === 0 || s.steps[i - 1].stage !== st.stage
            const blank = !!st.notConnected
            const first = st.id === 'impr'
            return [
              stageHead && <tr key={`h-${st.id}`}><td colSpan={4} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>{st.stage}</td></tr>,
              <tr key={st.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3">
                  <p className="font-semibold">{st.label}</p>
                  <p className="text-[13px]" style={{ color: T.muted }}>{st.source}</p>
                </td>
                <td className={num} style={mono}>{blank ? <NC why={st.why} label={st.ncLabel} /> : st.cur == null ? <span style={{ color: T.faint }}>pending</span> : fmtInt(st.cur)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(st.cur != null && st.prev ? st.cur - st.prev : null) }}>{blank ? '' : fmtPctSigned(st.cur != null && st.prev ? (st.cur - st.prev) / st.prev : null)}</td>
                <td className={num} style={mono}>{first ? '' : blank ? <NC why={st.why} /> : st.rate == null && st.id === 'visits' && !s.yt.viewsKnown ? <NC why={NO_ANALYTICS} /> : st.rate == null && st.id === 'views' ? <NC why={s.steps[0]?.why} label={s.steps[0]?.ncLabel} /> : fmtPct(st.rate, st.rate != null && st.rate < 0.1 ? 1 : 0)}</td>
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
            <th className={`${th} text-left`}>Video</th>
            <th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Visit %</th>
            {showCapture && <th className={`${th} text-right`}>Capture %</th>}
            <th className={`${th} text-right`}>New WS %</th><th className={`${th} text-right`}>New WS</th>
            <th className={`${th} text-right`}>Activated</th><th className={`${th} text-right`}>Paid</th>
            <th className={`${th} text-right`}>New T1·T2·T3·T4</th><th className={`${th} text-right`}>Existing T1·T2·T3·T4</th>
          </tr></thead>
          <tbody>
            {s.channelLevel && (() => { const c = s.channelLevel; return (
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: '#F6F5F2' }}>
                <td className="px-3 py-3">
                  <div className="flex items-start gap-3">
                    <span className="text-[12px] pt-1 w-10 shrink-0 text-right" style={{ color: T.faint, ...mono }}>—</span>
                    <span><span className="font-semibold">Whole channel · {s.channel?.label}</span>
                      <span className="block text-[13px]" style={{ color: T.muted }}>Every video links the same affiliate code, so visits and workspaces are counted for the channel, not per video. Calendar dates; views are the channel’s daily views.</span></span>
                  </div>
                </td>
                <td className={num} style={mono}>{c.views != null ? fmtInt(c.views) : '–'}</td>
                <td className={num} style={mono}>{fmtPct(c.views ? c.visits / c.views : null, 1)}</td>
                {showCapture && <td className={num} style={{ color: T.faint }}>–</td>}
                <td className={num} style={mono}>{fmtPct(c.visits ? c.newWs / c.visits : null, 1)}</td>
                <td className={num} style={mono}>{fmtInt(c.newWs)}</td>
                <td className={num} style={mono}>{fmtInt(c.activated)}</td>
                <td className={num} style={mono}>{fmtInt(c.paid)}</td>
                <td className={num}><Tiers t={c.tiersNew.slice(0, 4)} /></td>
                <td className={num} style={{ color: T.muted }}><Tiers t={c.tiersExisting.slice(0, 4)} /></td>
              </tr>) })()}
            {rows.map(v => (
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
              <td className={num} style={mono}>{!v.analytics
                ? <span title={`${fmtInt(v.lifetimeViews)} lifetime public views (Data API)`}><NC why={`${NO_ANALYTICS} ${fmtInt(v.lifetimeViews)} lifetime public views.`} /></span>
                : v.views ? fmtInt(v.views) : <span style={{ color: T.faint }}>pending</span>}</td>
              <td className={num} style={mono}>{!v.tagged
                ? <span className="text-[12px] whitespace-nowrap" style={{ color: T.faint, fontFamily: 'inherit' }}
                    title={s.channelLevel ? 'This channel’s links all use one code, so its traffic is in the Whole channel row.' : 'The description has no clay.com link with a campaign that maps to this video, so its traffic can’t be told apart.'}>
                    {s.channelLevel ? 'in channel row' : 'no tracked link'}</span>
                : !v.analytics ? <NC why={NO_ANALYTICS} /> : rateCell(v.visitRate, STEP_GOALS.viewToVisit)}</td>
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
                <td className={num} style={{ color: T.faint }}>–</td>
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
      <Kpis s={s} />
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
      <Trend s={s} />
      <ChannelsTable s={s} />
      <TierMix s={s} />
      <Discuss />
    </>
  )
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>{body}</div>
  )
}
