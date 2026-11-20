'use client'

import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SocialMode, SocialViewModel as SV } from '@/lib/plg/social/compute'
import WhatMoved from '../WhatMoved'
import ProgressChart, { type ProgressMetric } from '../ProgressChart'
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
  const lag = s.yt.lagging && s.yt.lastDay ? <>Through {fmtShort(s.yt.lastDay)}: YouTube reports 2–3 days late, so both periods use the same {s.yt.days} days.</> : null
  const excl = (xs: string[]) => (xs.length ? <> Excludes {xs.join(', ')} (not connected).</> : null)
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile label="Impressions" value={k.impressions.cur == null ? <NC inline why="Needs the channel owner’s one-time sign-in (YouTube Reporting API)" /> : fmtK(k.impressions.cur)}
        muted={k.impressions.cur == null} delta={k.impressions.delta}
        foot={<>{k.impressions.prevPartial ? 'The period before isn’t fully delivered by YouTube, so there’s no comparison. ' : ''}{lag}{excl(k.impressions.excluded)}</>} />
      <KpiTile label="Views" value={k.views.cur == null ? <NC inline why={NO_ANALYTICS} /> : fmtK(k.views.cur)} muted={k.views.cur == null} delta={k.views.delta}
        foot={<>{fmtInt(k.views.minutes / 60)} watch hours.{excl(k.views.excluded)}</>} />
      <KpiTile label="Referral visits" value={fmtInt(k.visits.cur)} delta={k.visits.delta}
        foot={<>Visitors from the creators’ clay.com links.{k.visits.untagged != null && <> Plus {fmtInt(k.visits.untagged)} from untagged YouTube links.</>}</>} />
      <KpiTile label="Tier 1–3 workspaces" value={fmtInt(k.tier13.cur)} delta={k.tier13.delta}
        foot={<>Of {fmtInt(k.newWs.cur)} new workspaces · {fmtInt(k.activated.cur)} activated · {fmtInt(k.paid.cur)} paying{k.tier13.untagged != null && <> · incl. untagged YouTube</>}</>} />
    </div>
  )
}

const pctDp = (v: number | null | undefined) => fmtPct(v, v != null && v < 0.1 ? 1 : 0)
const ppDelta = (cur: number | null, prev: number | null) => {
  if (cur == null || prev == null) return null
  const d = (cur - prev) * 100
  return Math.abs(d) < 0.05 ? 0 : d
}

/** Rate tiles under the chart: same names and definitions as the funnel's rate rows. */
function RateTiles({ s }: { s: SV }) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      {s.rateTiles.map(t => {
        const d = ppDelta(t.cur, t.prev)
        return (
          <Card key={t.id} className="p-5 flex flex-col gap-2">
            <Eyebrow>{t.label}</Eyebrow>
            <p className="text-[32px] leading-none" style={{ ...mono, color: t.nc ? T.faint : T.ink }}>{t.nc ? <span className="text-[20px]"><NC why={t.nc} /></span> : pctDp(t.cur)}</p>
            <p className="text-[14px]" style={{ color: T.muted }}>
              {t.nc ? t.def : d != null ? <><span style={{ ...mono, color: deltaColor(d) }}>{fmtPp(d)}</span> vs previous period ({pctDp(t.prev)})</> : <>{t.def} · – vs previous period</>}
            </p>
            {!t.nc && <p className="text-[12px]" style={{ color: T.faint }}>{t.def}{t.goal != null && <> · goal {pctDp(t.goal)}</>}</p>}
          </Card>
        )
      })}
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
function ChannelsTable({ s }: { s: SV }) {
  const [sort, setSort] = useState<SortState>({ key: 'views', dir: -1 })
  const live = s.channelRows.filter((r): r is Extract<(typeof s.channelRows)[number], { connected: true }> => r.connected)
  const t13 = (t: number[] | null | undefined) => (t ? t[0] + t[1] + t[2] : 0)
  const tot = (f: (r: (typeof live)[number]) => number | null | undefined) => { const xs = live.map(f).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null }
  const val = (r: (typeof live)[number]): number | string | null => sort.key === 'label' ? r.label.toLowerCase()
    : sort.key === 'tctr' ? (r.impressions ? (r.imprClicks ?? 0) / r.impressions : null) : sort.key === 'cta' ? (r.analytics && r.views ? r.visits / r.views : null)
    : sort.key === 't13' ? t13(r.tiersNew) : sort.key === 'views' ? (r.analytics ? r.views : null) : (r[sort.key as 'impressions' | 'visits' | 'newWs'] ?? null)
  const sorted = [...live].sort((a, b) => cmpVals(val(a), val(b), sort.dir))
  const vTot = tot(r => (r.analytics ? r.views : null)), visTot = tot(r => (r.analytics ? r.visits : null))
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Channels side by side</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>The same metrics as the tiles. Referral visits come from each creator’s own clay.com links; YouTube visits with no campaign are in the untagged row.</p>
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[960px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <SortTh label="Channel" k="label" sort={sort} set={setSort} right={false} />
            <SortTh label="Impressions" k="impressions" sort={sort} set={setSort} /><SortTh label="Thumbnail CTR" k="tctr" sort={sort} set={setSort} />
            <SortTh label="Views" k="views" sort={sort} set={setSort} /><SortTh label="CTA CTR" k="cta" sort={sort} set={setSort} />
            <SortTh label="Referral visits" k="visits" sort={sort} set={setSort} /><SortTh label="New workspaces" k="newWs" sort={sort} set={setSort} />
            <SortTh label="Tier 1–3 workspaces" k="t13" sort={sort} set={setSort} />
          </tr></thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-3 font-semibold whitespace-nowrap">{r.label} <span className="font-normal text-[13px]" style={{ color: T.muted }}>{r.handle}</span></td>
                <MetricCells impr={r.impressions} clk={r.imprClicks} views={r.analytics ? r.views : null} visits={r.visits} ws={r.newWs} t13={t13(r.tiersNew)} noViews={!r.analytics} />
              </tr>
            ))}
            {s.channelRows.filter(r => !r.connected).map(r => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${T.border}`, color: T.faint }}>
                <td className="px-3 py-3 font-semibold">{r.label}</td><td className="px-3 py-3 text-[13px] italic" colSpan={7}>Not connected</td>
              </tr>
            ))}
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-3 font-semibold" style={{ color: T.muted }}>YouTube, untagged</td>
              <MetricCells impr={null} clk={null} views={null} visits={s.untagged.visits} ws={s.untagged.ws.n} t13={t13(s.untagged.ws.t)} />
            </tr>
            <tr style={{ background: '#F6F5F2', fontWeight: 600 }}>
              <td className="px-3 py-3">Total</td>
              <MetricCells impr={tot(r => r.impressions)} clk={tot(r => r.imprClicks)} views={vTot} visits={(tot(r => r.visits) ?? 0) + s.untagged.visits}
                ws={(tot(r => r.newWs) ?? 0) + s.untagged.ws.n} t13={live.reduce((a, r) => a + t13(r.tiersNew), 0) + t13(s.untagged.ws.t)} cta={visTot != null && vTot ? visTot / vTot : null} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>Total CTA CTR counts only channels with views, so a channel without a YouTube sign-in or untagged visits don’t inflate it.</p>
      <p className="text-[13px]" style={{ color: T.muted }}>
        Excluded: {fmtInt(s.affiliateVisitors)} visitors from other affiliate creators’ YouTube links (Rewardful ?via= referrals); they belong to the affiliate channel, not owned YouTube.
      </p>
      {s.unmapped.length > 0 && (
        <p className="text-[13px]" style={{ color: T.muted }}>
          Not counted: {s.unmapped.map(u => `${u.campaign} (${fmtInt(u.visits)} visitors)`).join(', ')}: campaign links no current video description uses.
        </p>
      )}
    </Card>
  )
}

function Funnel({ s }: { s: SV }) {
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-4">
      <H2>Funnel</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>Each count, then its step rate on its own row. Counts change in %, rates in percentage points (pp). Email steps are placeholders until their data is connected (hover “Not connected” for what’s missing).</p>
      {s.channel?.fallbackNote && <p className="text-[13px]" style={{ color: T.faint }}>{s.channel.fallbackNote}</p>}
      <div className="overflow-x-auto -mx-5 sm:mx-0">
        <table className="w-full min-w-[700px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left`}>Step</th><th className={`${th} text-right`}>This period</th><th className={`${th} text-right`}>Period before</th>
            <th className={`${th} text-right`}>Change</th><th className={`${th} text-right`}>Goal</th>
          </tr></thead>
          <tbody>{s.funnel.map((f, i) => {
            const stageHead = i === 0 || s.funnel[i - 1].stage !== f.stage
            const isRate = f.kind === 'rate'
            const fmt = (v: number | null) => (v == null ? '–' : isRate ? pctDp(v) : fmtInt(v))
            const d = isRate ? ppDelta(f.cur, f.prev) : f.cur != null && f.prev ? (f.cur - f.prev) / f.prev : null
            const below = isRate && f.goal != null && f.cur != null && f.cur < f.goal
            return [
              stageHead && <tr key={`h-${f.id}`}><td colSpan={5} className="px-3 pt-5 pb-1 text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', ...mono }}>{f.stage}</td></tr>,
              <tr key={f.id} style={{ borderBottom: `1px solid ${T.border}`, background: isRate ? '#FAF9F6' : undefined }}>
                <td className={isRate ? 'px-3 py-2 pl-8' : 'px-3 py-3'}>
                  <p className={isRate ? 'text-[14px]' : 'font-semibold'}>{isRate && <span style={{ color: T.faint }}>↳ </span>}{f.label}</p>
                  <p className="text-[13px]" style={{ color: T.muted }}>{f.def}{f.partial && <> · {f.partial}</>}</p>
                </td>
                <td className={num} style={{ ...mono, color: below ? T.neg : T.ink }}>{f.nc ? <NC why={f.nc} /> : fmt(f.cur)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{f.nc ? '' : fmt(f.prev)}</td>
                <td className={num} style={{ ...mono, color: deltaColor(d) }}>{f.nc || d == null ? (f.nc ? '' : '–') : isRate ? fmtPp(d) : fmtPctSigned(d)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{f.goal != null ? pctDp(f.goal) : ''}</td>
              </tr>,
            ]
          })}</tbody>
        </table>
      </div>
    </Card>
  )
}

/** Sortable column header, the same behaviour as the Portfolio tables: click to sort, again to flip; numbers start high. */
type SortState = { key: string; dir: 1 | -1 }
function SortTh({ label, k, sort, set, right = true, title }: { label: React.ReactNode; k: string; sort: SortState; set: (s: SortState) => void; right?: boolean; title?: string }) {
  const on = sort.key === k
  return (
    <th className={`${th} ${right ? 'text-right' : 'text-left'}`} title={title} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => set({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : right ? -1 : 1 })} className="uppercase inline-flex items-center gap-1"
        style={{ color: on ? T.ink : T.muted, letterSpacing: 'inherit' }}>
        {label}<span aria-hidden style={{ opacity: on ? 1 : 0.35 }}>{on ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}
/** Compare with nulls last whatever the direction. */
const cmpVals = (a: number | string | null | undefined, b: number | string | null | undefined, dir: 1 | -1) =>
  a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0) * dir

/** UTM and affiliate parameters, in the order a social or affiliate manager reads them. */
const PARAM_LABEL: Record<string, string> = { utm_source: 'Source', utm_medium: 'Medium', utm_campaign: 'Campaign', utm_content: 'Content', utm_term: 'Term', via: 'Affiliate code (via)', ref: 'Referral (ref)' }
type SVVideo = SV['videos'][number]
type SVPeriod = SV['videoPeriod'][string] | undefined

/** Inline expansion: the headline numbers only; the deep dive below has the rest. */
function VideoSummary({ v, p, onDeep }: { v: SVVideo; p: SVPeriod; onDeep: () => void }) {
  const stat = (label: string, val: React.ReactNode) => (
    <div className="flex flex-col gap-0.5 min-w-[110px]"><span className="text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.1em', ...mono }}>{label}</span><span className="text-[20px]" style={mono}>{val}</span></div>
  )
  return (
    <div className="flex flex-col gap-3 min-w-0 flex-1">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {stat('Views', fmtInt(p?.views ?? null))}
        {stat('Impressions', p?.impressions != null ? fmtInt(p.impressions) : '–')}
        {stat('Thumbnail CTR', p?.impressions ? fmtPct((p.imprClicks ?? 0) / p.impressions, 1) : '–')}
        {stat('Referral visits', p?.visits != null ? fmtInt(p.visits) : '–')}
        {stat('New workspaces', p?.newWs != null ? fmtInt(p.newWs) : '–')}
      </div>
      <button type="button" onClick={onDeep} className="self-start rounded-full px-4 py-2 text-[14px] font-medium" style={{ background: T.ink, color: '#fff' }}>Open the deep dive ↓</button>
    </div>
  )
}

/** One video, in full: headline tiles, its trend, its funnel, links and parameters, launch numbers, day by day, device and geo. */
function VideoDeepDive({ s, id, setId, thumbs }: { s: SV; id: string | null; setId: (id: string) => void; thumbs?: Record<string, string> | null }) {
  const vids = [...s.videos].sort((a, b) => (s.videoPeriod[b.id]?.views ?? 0) - (s.videoPeriod[a.id]?.views ?? 0))
  const [dayCols, setDayCols] = useState<'reach' | 'traffic'>('reach')
  const [daySort, setDaySort] = useState<SortState>({ key: 'd', dir: -1 })
  const v = vids.find(x => x.id === id) ?? vids[0]
  if (!v) return null
  const D = s.videoDeep[v.id], T0 = D?.totals.cur, T1 = D?.totals.prev
  const dur = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
  const rel = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? (a - b) / b : null)
  const ctr = (t?: typeof T0) => (t?.impr ? (t.clk ?? 0) / t.impr : null)
  const avd = (t?: typeof T0) => (t?.views && t.minutes != null ? (t.minutes * 60) / t.views : null)
  const tile = (label: string, val: React.ReactNode, d: number | null, unit: 'pct' | 'pp' = 'pct') => (
    <div className="rounded-2xl p-4 flex flex-col gap-1.5" style={{ background: T.tile }}>
      <Eyebrow>{label}</Eyebrow>
      <span className="text-[26px] leading-none" style={mono}>{val}</span>
      <span className="text-[13px]" style={{ color: T.muted }}>{d == null ? '– vs the period before' : <><span style={{ color: deltaColor(Math.abs(d) < 0.0005 ? 0 : d), ...mono }}>{Math.abs(d) < 0.0005 ? '—' : d > 0 ? '▲' : '▼'}{unit === 'pp' ? `${Math.abs(d * 100).toFixed(1)}pp` : `${Math.abs(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%`}</span> vs the period before</>}</span>
    </div>
  )
  const fmtShortD = (d: string) => fmtShort(d)
  const pts = (k: 'views' | 'impr' | 'visits' | 'ws' | 'minutes') => (xs: typeof D.cur) => xs.map(x => ({ label: fmtShortD(x.d), v: x[k] as number | null }))
  const ctrPts = (xs: typeof D.cur) => xs.map(x => ({ label: fmtShortD(x.d), v: x.impr ? (x.clk ?? 0) / x.impr : null }))
  const metrics: ProgressMetric[] = D ? [
    { id: 'views', label: 'Views', fmt: fmtInt, points: pts('views')(D.cur), prev: pts('views')(D.prev) },
    { id: 'impr', label: 'Impressions', fmt: fmtInt, points: pts('impr')(D.cur), prev: pts('impr')(D.prev), empty: 'Impressions need the channel owner’s sign-in.' },
    { id: 'ctr', label: 'Thumbnail CTR', fmt: (n: number) => fmtPct(n, 1), points: ctrPts(D.cur), prev: ctrPts(D.prev) },
    { id: 'visits', label: 'Referral visits', fmt: fmtInt, points: pts('visits')(D.cur), prev: pts('visits')(D.prev), empty: 'No tracked link, so visits can’t be tied to this video.' },
    { id: 'ws', label: 'New workspaces', fmt: fmtInt, points: pts('ws')(D.cur), prev: pts('ws')(D.prev) },
    { id: 'minutes', label: 'Watch time (minutes)', fmt: fmtInt, points: pts('minutes')(D.cur), prev: pts('minutes')(D.prev) },
  ].map(m => ({ ...m, points: m.points.some(p => p.v) ? m.points : [] })) : []
  // The video's own funnel, counts then step rates.
  const step = (label: string, cur: number | null | undefined, prev: number | null | undefined, rate?: { label: string; cur: number | null; prev: number | null }) => ({ label, cur: cur ?? null, prev: prev ?? null, rate })
  const rr = (a?: number | null, b?: number | null) => (a != null && b ? a / b : null)
  const funnel = T0 ? [
    step('Impressions', T0.impr, T1?.impr),
    step('Views', T0.views, T1?.views, { label: 'Thumbnail CTR', cur: ctr(T0), prev: ctr(T1) }),
    step('Referral visits', v.tagged ? T0.visits : null, v.tagged ? T1?.visits : null, { label: 'CTA CTR', cur: v.tagged ? rr(T0.visits, T0.views) : null, prev: v.tagged ? rr(T1?.visits, T1?.views) : null }),
    ...(v.offerPage ? [step('Email captures', T0.captures, T1?.captures, { label: 'Email capture rate', cur: rr(T0.captures, T0.visits), prev: rr(T1?.captures, T1?.visits) })] : []),
    step('New workspaces', v.tagged ? T0.newWs : null, v.tagged ? T1?.newWs : null, { label: 'Visit → workspace', cur: v.tagged ? rr(T0.newWs, v.offerPage ? T0.captures : T0.visits) : null, prev: v.tagged ? rr(T1?.newWs, v.offerPage ? T1?.captures : T1?.visits) : null }),
    step('Activated workspaces', v.tagged ? T0.activated : null, v.tagged ? T1?.activated : null, { label: 'Activation rate', cur: rr(T0.activated, T0.newWs), prev: rr(T1?.activated, T1?.newWs) }),
    step('Paying workspaces', v.tagged ? T0.paid : null, v.tagged ? T1?.paid : null, { label: 'Paid rate', cur: rr(T0.paid, T0.newWs), prev: rr(T1?.paid, T1?.newWs) }),
  ] : []
  const when = v.publishedAt ? new Date(v.publishedAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles', timeZoneName: 'short' }) : fmtShort(v.published)
  const eng = v.likes != null && v.lifetimeViews ? (v.likes + (v.comments ?? 0)) / v.lifetimeViews : null
  return (
    <section id="video-deep-dive" className="flex flex-col gap-5 scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <H2>Video deep dive</H2>
        <label className="flex items-center gap-3 text-[15px]" style={{ color: T.muted }}>Video
          <select value={v.id} onChange={e => setId(e.target.value)} className="rounded-xl px-3 py-2 text-[15px] max-w-[460px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>
            {vids.map(x => <option key={x.id} value={x.id}>{x.title}{s.scope === 'all' ? ` · ${x.channel}` : ''}</option>)}
          </select>
        </label>
      </div>
      <Card className="p-5 sm:p-8 flex flex-col gap-6">
        <div className="flex flex-wrap items-start gap-6">
          {thumbs?.[v.id] && <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="rounded-xl overflow-hidden shrink-0" style={{ maxWidth: '100%' }}>
            <img src={thumbs[v.id]} alt={v.title} width={320} height={180} style={{ width: 320, maxWidth: '100%', height: 'auto', display: 'block' }} /></a>}
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <p className="text-[22px] font-bold leading-snug" style={{ color: T.ink, letterSpacing: '-0.01em' }}>{v.title}</p>
            <p className="text-[14px]" style={{ color: T.muted }}>{v.channel} · {when} · {dur(v.durationSec)} · {v.live ? 'Live stream' : v.durationSec <= 60 ? 'Short' : 'Video'}{!v.cohortComplete && ` · day ${v.cohortDay} of ${COHORT_DAYS}`}</p>
            <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="text-[14px] underline self-start" style={{ color: T.ink }}>Watch on YouTube ↗</a>
            <p className="text-[13px]" style={{ color: T.muted }}>{v.campaign ? `Matched to visits by utm_campaign ${v.campaign}.` : v.tagged ? 'Matched to visits by the channel’s link rule.' : 'No clay.com link this dashboard can tie to the video, so visits and workspaces aren’t attributed to it.'}</p>
          </div>
        </div>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {tile('Views', fmtInt(T0?.views ?? null), rel(T0?.views, T1?.views))}
          {tile('Impressions', T0?.impr != null ? fmtInt(T0.impr) : '–', rel(T0?.impr, T1?.impr))}
          {tile('Thumbnail CTR', ctr(T0) != null ? fmtPct(ctr(T0), 1) : '–', ctr(T0) != null && ctr(T1) != null ? ctr(T0)! - ctr(T1)! : null, 'pp')}
          {tile('Avg view duration', avd(T0) != null ? dur(avd(T0)!) : '–', rel(avd(T0), avd(T1)))}
          {tile('Referral visits', v.tagged ? fmtInt(T0?.visits ?? 0) : '–', v.tagged ? rel(T0?.visits, T1?.visits) : null)}
          {tile('New workspaces', v.tagged ? fmtInt(T0?.newWs ?? 0) : '–', v.tagged ? rel(T0?.newWs, T1?.newWs) : null)}
        </div>
      </Card>
      {metrics.length > 0 && <ProgressChart title="Trend" metrics={metrics} curLabel="These dates" prevLabel="Period before" />}
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
          <H2>Funnel for this video</H2>
          <table className="w-full text-[15px]" style={{ color: T.ink }}>
            <thead><tr style={head}><th className={`${th} text-left`}>Step</th><th className={`${th} text-right`}>These dates</th><th className={`${th} text-right`}>Before</th><th className={`${th} text-right`}>Change</th></tr></thead>
            <tbody>{funnel.flatMap(f => {
              const d = f.cur != null && f.prev ? (f.cur - f.prev) / f.prev : null
              const out = [<tr key={f.label} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5 font-semibold">{f.label}</td><td className={num} style={mono}>{fmtInt(f.cur)}</td>
                <td className={num} style={{ ...mono, color: T.muted }}>{fmtInt(f.prev)}</td><td className={num} style={{ ...mono, color: deltaColor(d) }}>{fmtPctSigned(d)}</td></tr>]
              if (f.rate) {
                const pp = f.rate.cur != null && f.rate.prev != null ? (f.rate.cur - f.rate.prev) * 100 : null
                out.unshift(<tr key={`${f.label}-r`} style={{ borderBottom: `1px solid ${T.border}`, background: '#FAF9F6' }}>
                  <td className="px-3 py-2 pl-8 text-[14px]"><span style={{ color: T.faint }}>↳ </span>{f.rate.label}</td><td className={num} style={mono}>{f.rate.cur != null ? fmtPct(f.rate.cur, 1) : '–'}</td>
                  <td className={num} style={{ ...mono, color: T.muted }}>{f.rate.prev != null ? fmtPct(f.rate.prev, 1) : '–'}</td><td className={num} style={{ ...mono, color: deltaColor(pp) }}>{pp != null ? fmtPp(Math.abs(pp) < 0.05 ? 0 : pp) : '–'}</td></tr>)
              }
              return out
            })}</tbody>
          </table>
          <p className="text-[13px]" style={{ color: T.muted }}>Each rate row sits above the step it leads to. Rates change in percentage points.</p>
        </Card>
        <div className="flex flex-col gap-6 min-w-0">
          <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
            <H2>Links and tracking</H2>
            {(v.links ?? []).length ? v.links!.map(l => {
              const params = Object.entries(l.params ?? {}).sort(([a], [b]) => (a in PARAM_LABEL ? Object.keys(PARAM_LABEL).indexOf(a) : 99) - (b in PARAM_LABEL ? Object.keys(PARAM_LABEL).indexOf(b) : 99))
              return (
                <div key={l.full ?? l.url} className="flex flex-col gap-1.5 min-w-0">
                  <code className="text-[13px] break-all" style={{ ...mono, color: T.ink }}>{l.full ?? l.url}</code>
                  {params.length ? <table className="text-[14px]"><tbody>{params.map(([k, val]) => (
                    <tr key={k}><td className="pr-4 py-0.5" style={{ color: T.muted }}>{PARAM_LABEL[k] ?? k}</td><td style={mono}>{val}</td></tr>))}</tbody></table>
                    : <span className="text-[13px]" style={{ color: T.faint }}>No UTM or tracking parameters.</span>}
                </div>
              )
            }) : <p className="text-[14px]" style={{ color: T.faint }}>No clay.com or short links in the description.</p>}
          </Card>
          <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
            <H2>Launch and lifetime</H2>
            <dl className="grid gap-x-6 gap-y-1.5 text-[15px]" style={{ gridTemplateColumns: 'auto 1fr', color: T.ink }}>
              {([[`Views, first ${COHORT_DAYS} days`, v.views != null ? fmtInt(v.views) : '–'], [`Avg viewed, first ${COHORT_DAYS} days`, v.avgViewPct != null ? fmtPct(v.avgViewPct, 0) : '–'],
                [`Subscribers, first ${COHORT_DAYS} days`, v.subsGained ? `+${fmtInt(v.subsGained)}` : '–'], ['Lifetime views', fmtInt(v.lifetimeViews)],
                ['Likes · comments', v.likes != null ? `${fmtInt(v.likes)} · ${fmtInt(v.comments ?? 0)}` : '–'], ['Engagement rate', eng != null ? fmtPct(eng, 1) : '–']] as [string, string][])
                .flatMap(([k, val]) => [<dt key={`${k}-k`} style={{ color: T.muted }}>{k}</dt>, <dd key={`${k}-v`} style={mono}>{val}</dd>])}
            </dl>
          </Card>
        </div>
      </div>
      {D && <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <H2>Day by day</H2>
          <Segmented ariaLabel="Day-by-day columns" value={dayCols} onChange={setDayCols} options={[{ id: 'reach', label: 'Reach' }, { id: 'traffic', label: 'Traffic and signups' }]} />
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}><SortTh label="Day" k="d" sort={daySort} set={setDaySort} right={false} />
            {dayCols === 'reach' ? <><SortTh label="Impressions" k="impr" sort={daySort} set={setDaySort} /><SortTh label="Thumbnail CTR" k="ctr" sort={daySort} set={setDaySort} /><SortTh label="Views" k="views" sort={daySort} set={setDaySort} /><SortTh label="Avg view duration" k="avd" sort={daySort} set={setDaySort} /><SortTh label="Subscribers" k="subs" sort={daySort} set={setDaySort} /></>
              : <><SortTh label="Views" k="views" sort={daySort} set={setDaySort} /><SortTh label="Referral visits" k="visits" sort={daySort} set={setDaySort} /><SortTh label="CTA CTR" k="cta" sort={daySort} set={setDaySort} /><SortTh label="New workspaces" k="ws" sort={daySort} set={setDaySort} /></>}
          </tr></thead>
          <tbody>{[...D.cur].sort((a, b) => {
            const val = (x: typeof a) => daySort.key === 'd' ? x.d : daySort.key === 'ctr' ? (x.impr ? (x.clk ?? 0) / x.impr : null) : daySort.key === 'avd' ? (x.views && x.minutes != null ? x.minutes / x.views : null)
              : daySort.key === 'cta' ? (x.views ? x.visits / x.views : null) : (x[daySort.key as 'views' | 'impr' | 'subs' | 'visits' | 'ws'] as number | null)
            return cmpVals(val(a), val(b), daySort.dir)
          }).map(x => (
            <tr key={x.d} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="px-3 py-2.5" style={mono}>{fmtShort(x.d)}</td>
              {dayCols === 'reach' ? <>
                <td className={num} style={mono}>{x.impr != null ? fmtInt(x.impr) : <span style={{ color: T.faint }}>not reported yet</span>}</td>
                <td className={num} style={mono}>{x.impr ? fmtPct((x.clk ?? 0) / x.impr, 1) : '–'}</td>
                <td className={num} style={mono}>{x.views != null ? fmtInt(x.views) : <span style={{ color: T.faint }}>not reported yet</span>}</td>
                <td className={num} style={mono}>{x.views && x.minutes != null ? dur((x.minutes * 60) / x.views) : '–'}</td>
                <td className={num} style={mono}>{x.subs != null ? fmtInt(x.subs) : '–'}</td>
              </> : <>
                <td className={num} style={mono}>{x.views != null ? fmtInt(x.views) : <span style={{ color: T.faint }}>not reported yet</span>}</td>
                <td className={num} style={mono}>{v.tagged ? fmtInt(x.visits) : '–'}</td>
                <td className={num} style={mono}>{v.tagged && x.views ? fmtPct(x.visits / x.views, 1) : '–'}</td>
                <td className={num} style={mono}>{v.tagged ? fmtInt(x.ws) : '–'}</td>
              </>}
            </tr>))}</tbody>
        </table></div>
      </Card>}
      {v.tagged && <section className="flex flex-col gap-4"><Cuts s={s} sel={v.id} onClear={() => {}} /></section>}
    </section>
  )
}

/** The Videos table's seven numbers, the same metrics as the tiles: reach (YouTube) then traffic and signups (Clay). */
function MetricCells({ impr, clk, views, visits, ws, t13, untracked, noViews, cta }: { impr: number | null; clk: number | null; views: number | null; visits: number | null; ws: number | null; t13: number | null; untracked?: string | null; noViews?: boolean; cta?: number | null }) {
  const faint = (t: string, title?: string) => <span className="text-[12px] whitespace-nowrap" style={{ color: T.faint }} title={title}>{t}</span>
  const pc = (r: number | null, goal?: number) => (r == null ? '–' : <span style={{ color: goal != null && r < goal ? T.neg : T.ink }}>{fmtPct(r, r < 0.1 ? 1 : 0)}</span>)
  const why = untracked === 'in channel row' ? 'This channel’s links all use one code, so its traffic is in the Whole channel row.' : 'The description has no clay.com link that maps to this video, so its traffic can’t be told apart.'
  return <>
    <td className={num} style={mono}>{impr != null ? fmtInt(impr) : '–'}</td>
    <td className={num} style={mono}>{impr ? pc((clk ?? 0) / impr) : '–'}</td>
    <td className={num} style={mono}>{noViews ? <NC why={NO_ANALYTICS} /> : views != null ? fmtInt(views) : '–'}</td>
    <td className={num} style={mono}>{untracked ? faint(untracked, why) : cta !== undefined ? pc(cta, STEP_GOALS.viewToVisit) : views && visits != null ? pc(visits / views, STEP_GOALS.viewToVisit) : '–'}</td>
    <td className={num} style={mono}>{untracked ? '' : visits != null ? fmtInt(visits) : '–'}</td>
    <td className={num} style={mono}>{untracked ? '' : ws != null ? fmtInt(ws) : '–'}</td>
    <td className={num} style={mono}>{untracked ? '' : t13 != null ? fmtInt(t13) : '–'}</td>
  </>
}

type VideoFilter = 'all' | 'tracked' | 'untracked' | 'ws' | 'new'
const VIDEO_FILTERS: { id: VideoFilter; label: string; title: string }[] = [
  { id: 'all', label: 'All videos', title: 'Every video in the sync window' },
  { id: 'tracked', label: 'Tracked link', title: 'The description links clay.com with a campaign (or the channel’s link rule) that maps to this video' },
  { id: 'untracked', label: 'No tracked link', title: 'No clay.com link this dashboard can tie to the video' },
  { id: 'ws', label: 'Drove workspaces', title: 'At least one new workspace in these dates' },
  { id: 'new', label: `Published in the last ${COHORT_DAYS} days`, title: 'Still in its launch window' },
]

function VideoTable({ s, sel, setSel, thumbs, onDeep, deep }: { s: SV; sel: string | null; setSel: (id: string | null) => void; thumbs?: Record<string, string> | null; onDeep: (id: string) => void; deep: string | null }) {
  const [sort, setSort] = useState<SortState>({ key: 'ws', dir: -1 })
  const [vf, setVf] = useState<VideoFilter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const creator = s.scope !== 'all'
  const cols = 10 + (s.videos.some(v => v.offerPage && v.tagged) ? 1 : 0)
  // Every column is for the selected dates (s.videoPeriod), like the tiles; "First 28 days" is the one exception, labelled.
  const P = (id: string) => s.videoPeriod[id]
  const ctr = (id: string) => { const p = P(id); return p?.visits != null && p.views ? p.visits / p.views : null }
  const wsr = (id: string, offer: boolean) => { const p = P(id); const den = offer ? p?.captures : p?.visits; return p?.newWs != null && den ? p.newWs / den : null }
  const keep = (v: SVVideo) => vf === 'all' ? true : vf === 'tracked' ? v.tagged : vf === 'untracked' ? !v.tagged : vf === 'ws' ? (P(v.id)?.newWs ?? 0) > 0 : !v.cohortComplete
  const val = (v: SVVideo): number | string | null => {
    const p = P(v.id)
    switch (sort.key) {
      case 'title': return v.title.toLowerCase()
      case 'published': return v.published
      case 'views': return p?.views ?? null
      case 'cta': return ctr(v.id)
      case 'impr': return p?.impressions ?? null
      case 'tctr': return p?.impressions ? (p.imprClicks ?? 0) / p.impressions : null
      case 'visits': return v.tagged ? p?.visits ?? null : null
      case 't13': return p?.tiersNew ? p.tiersNew[0] + p.tiersNew[1] + p.tiersNew[2] : null
      default: return p?.newWs ?? null
    }
  }
  const rows = [...s.videos].filter(keep).sort((a, b) => cmpVals(val(a), val(b), sort.dir) || (P(b.id)?.views ?? 0) - (P(a.id)?.views ?? 0))
  const showCapture = s.videos.some(v => v.offerPage && v.tagged)
  const dur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  const rateCell = (r: number | null, goal: number) => (
    <span style={{ color: r != null && r < goal ? T.neg : T.ink }}>{fmtPct(r, r != null && r < 0.1 ? 1 : 0)}</span>
  )
  return (
    <section className="flex flex-col gap-4">
      <H2>Videos</H2>
      <p className="text-[15px]" style={{ color: T.muted }}>The selected dates, the same metrics as the tiles. A channel’s video rows plus its older-videos row add up to its total. CTA CTR in orange is below the 50% goal. Select a video for its headline numbers and the deep dive below.</p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter videos">
          {VIDEO_FILTERS.map(f => {
            const n = f.id === 'all' ? s.videos.length : s.videos.filter(v => f.id === 'tracked' ? v.tagged : f.id === 'untracked' ? !v.tagged : f.id === 'ws' ? (P(v.id)?.newWs ?? 0) > 0 : !v.cohortComplete).length
            return <button key={f.id} type="button" title={f.title} aria-pressed={vf === f.id} onClick={() => setVf(f.id)} className="rounded-full px-3 py-1.5 text-[13px]"
              style={{ background: vf === f.id ? T.ink : '#fff', color: vf === f.id ? '#fff' : T.ink, border: `1px solid ${vf === f.id ? T.ink : T.border}` }}>{f.label} <span style={{ opacity: 0.6 }}>{n}</span></button>
          })}
        </div>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-[15px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <SortTh label="Video" k="title" sort={sort} set={setSort} right={false} />
            <SortTh label="Impressions" k="impr" sort={sort} set={setSort} /><SortTh label="Thumbnail CTR" k="tctr" sort={sort} set={setSort} />
            <SortTh label="Views" k="views" sort={sort} set={setSort} /><SortTh label="CTA CTR" k="cta" sort={sort} set={setSort} />
            <SortTh label="Referral visits" k="visits" sort={sort} set={setSort} /><SortTh label="New workspaces" k="ws" sort={sort} set={setSort} />
            <SortTh label="Tier 1–3 workspaces" k="t13" sort={sort} set={setSort} />
          </tr></thead>
          <tbody>
            {s.channelLevel && (() => { const c = s.channelLevel; const ch = s.channelRows.find(r => r.id === s.scope); const chr = ch && ch.connected ? ch : null; return (
              <tr style={{ borderBottom: `1px solid ${T.border}`, background: '#F6F5F2' }}>
                <td className="px-3 py-3">
                  <span className="font-semibold">Whole channel · {s.channel?.label}</span>
                  <span className="block text-[13px]" style={{ color: T.muted }}>Every video links the same affiliate code, so referral visits and workspaces are counted for the channel, not per video.</span>
                </td>
                <MetricCells impr={chr?.impressions ?? null} clk={chr?.imprClicks ?? null} views={c.views} visits={c.visits} ws={c.newWs} t13={c.tiersNew[0] + c.tiersNew[1] + c.tiersNew[2]} />
              </tr>) })()}
            {rows.map(v => {
              const p = P(v.id)
              const untracked = s.channelLevel ? 'in channel row' : 'no tracked link'
              return [
            <tr key={v.id} style={{ borderBottom: open === v.id ? 'none' : `1px solid ${T.border}`, background: open === v.id || deep === v.id ? '#E8F6F8' : undefined }}>
              <td className="px-3 py-3 min-w-[300px] max-w-[380px]">
                <div className="flex items-start gap-3">
                  {creator && thumbs?.[v.id]
                    ? <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id} aria-label={`Open ${v.title}`} className="relative shrink-0 rounded-md overflow-hidden" style={{ width: 96, height: 54, background: T.tile }}>
                        <img src={thumbs[v.id]} alt="" width={96} height={54} style={{ width: 96, height: 54, objectFit: 'cover', display: 'block' }} />
                        <span className="absolute bottom-0.5 right-0.5 rounded px-1 text-[10px]" style={{ background: 'rgba(0,0,0,0.75)', color: '#fff', ...mono }}>{dur(v.durationSec)}</span>
                      </button>
                    : <span className="text-[12px] pt-1 w-10 shrink-0 text-right" style={{ color: T.faint, ...mono }}>{dur(v.durationSec)}</span>}
                  <span>
                    <button type="button" onClick={() => setOpen(open === v.id ? null : v.id)} aria-expanded={open === v.id} className="font-semibold text-left hover:underline">{v.title}</button>
                    <span className="block text-[13px]" style={{ color: T.muted, ...mono }}>{fmtShort(v.published)} · {v.channel}{!v.cohortComplete && ` · day ${v.cohortDay} of ${COHORT_DAYS}`}</span>
                  </span>
                </div>
              </td>
              <MetricCells impr={p?.impressions ?? null} clk={p?.imprClicks ?? null} views={v.analytics ? p?.views ?? 0 : null} visits={v.tagged ? p?.visits ?? 0 : null}
                ws={v.tagged ? p?.newWs ?? 0 : null} t13={v.tagged && p?.tiersNew ? p.tiersNew[0] + p.tiersNew[1] + p.tiersNew[2] : null} untracked={v.tagged ? null : untracked} noViews={!v.analytics} />
            </tr>,
            open === v.id && (
              <tr key={`${v.id}-open`} style={{ borderBottom: `1px solid ${T.border}`, background: '#E8F6F8' }}>
                <td colSpan={8} className="px-3 pb-4">
                  <div className="flex flex-wrap items-start gap-5">
                    {thumbs?.[v.id] && <img src={thumbs[v.id]} alt={v.title} width={240} height={135} className="rounded-lg" style={{ width: 240, maxWidth: '100%', height: 'auto', display: 'block' }} />}
                    <VideoSummary v={v} p={p} onDeep={() => onDeep(v.id)} />
                  </div>
                </td>
              </tr>
            ),
            ]})}
            {s.olderVideos.map(b => (
              <tr key={`old-${b.channel}`} style={{ borderBottom: `1px solid ${T.border}`, background: '#F6F5F2' }}>
                <td className="px-3 py-3">
                  <span className="font-semibold">Older videos · {b.channel}</span>
                  <span className="block text-[13px]" style={{ color: T.muted }}>Published before the sync window, during these dates</span>
                </td>
                <MetricCells impr={b.impressions} clk={b.imprClicks} views={b.views} visits={b.visits} ws={b.newWs} t13={b.tiersNew[0] + b.tiersNew[1] + b.tiersNew[2]} untracked={s.channelLevel ? 'in channel row' : null} />
              </tr>
            ))}</tbody>
        </table>
      </Card>
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
  const empty = <tr><td colSpan={5} className="px-3 py-4" style={{ color: T.muted }}>No referral visits for this selection.</td></tr>
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <H2>Device and geo · {v ? v.title : s.channel ? `${s.channel.label}’s channel` : 'All channels'}</H2>
        {v && <button type="button" onClick={onClear} className="rounded-full px-4 py-2 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}>Show whole channel</button>}
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        <Card className="p-5 sm:p-6 flex flex-col gap-3 overflow-x-auto">
          <Eyebrow>Device</Eyebrow>
          <table className="w-full min-w-[440px] text-[15px]" style={{ color: T.ink }}>
            <thead><tr style={head}><th className={`${th} text-left`}>Device</th><th className={`${th} text-right`}>Referral visits</th><th className={`${th} text-right`}>Share</th><th className={`${th} text-right`}>Email capture rate</th><th className={`${th} text-right`}>New workspaces</th></tr></thead>
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
            <thead><tr style={head}><th className={`${th} text-left`}>Region</th><th className={`${th} text-right`}>Referral visits</th><th className={`${th} text-right`}>Email capture rate</th><th className={`${th} text-right`}>MQAL rate</th><th className={`${th} text-right`}>New workspaces</th></tr></thead>
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
      <p className="text-[13px]" style={{ color: T.muted }}>YouTube link clicks need YouTube link-click data (not connected). Device is the visitor’s OS (iOS isn’t reported, so it shows as Unknown); region is the browser timezone. New workspaces are matched to the visit through Clay’s cookie map, so a few land in Unknown.</p>
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
      <H2>After signup: pay, expand or churn</H2>
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
        <thead><tr style={head}><th className={`${th} text-left`}>Signup month</th><th className={`${th} text-right`}>New workspaces</th><th className={`${th} text-right`}>Activated</th><th className={`${th} text-right`}>Paid</th><th className={`${th} text-right`}>Expanded</th><th className={`${th} text-right`}>Churned</th></tr></thead>
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

/**
 * Same layout on All channels and each creator: four tiles, the trend, rate tiles, what moved, then the channels table
 * (All) or the funnel (creator), videos, persona and tier mix, after signup, device and geo.
 */
export default function SocialView({ s, loading, thumbs }: { s: SV; loading: boolean; thumbs?: Record<string, string> | null }) {
  const [sel, setSel] = useState<string | null>(null)
  const [deep, setDeep] = useState<string | null>(null)
  const openDeep = (id: string) => { setDeep(id); setTimeout(() => document.getElementById('video-deep-dive')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0) }
  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <Kpis s={s} />
      <Trend s={s} />
      <RateTiles s={s} />
      <WhatMoved insight={s.insight} />
      {s.scope === 'all' ? <ChannelsTable s={s} /> : <Funnel s={s} />}
      <VideoTable s={s} sel={sel} setSel={setSel} thumbs={thumbs} onDeep={openDeep} deep={deep} />
      <VideoDeepDive s={s} id={deep} setId={setDeep} thumbs={thumbs} />
      <TierMix s={s} />
      <AfterSignup s={s} />
      <section className="flex flex-col gap-4"><Cuts s={s} sel={sel} onClear={() => setSel(null)} /></section>
    </div>
  )
}
