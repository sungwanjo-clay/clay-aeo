'use client'

import { Fragment, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { ATTRIBUTION, RESULT, r1, type CreatorsData, type Rec, type Result, type ThemeRow, type VideoRow } from '@/lib/plg/creators/compute'
import { SCAN, type SV, type ScanDoc } from '@/lib/plg/creators/scan'
import { clayFit, formatLabel, themeLabel, type FormatId, type ThemeId } from '@/lib/plg/creators/themes'
import SectionBar, { Chip } from '../SectionBar'
import { Card, Def, Eyebrow, H2, InfoTip, T, fmtInt, fmtPct } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-2.5 text-right whitespace-nowrap'
const GOOD = { bg: '#E3F1E8', fg: '#1F6B3E' }, BAD = { bg: '#FCE9E2', fg: T.neg }, MID = { bg: '#EFEEEA', fg: T.muted }, NEW = { bg: '#E4ECFD', fg: '#2F5BEA' }
const compact = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}K` : fmtInt(x))
const ytUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`
const ageDays = (p: string, now: string) => Math.max(0, Math.round((Date.parse(now) - Date.parse(p)) / 864e5))

const SECTIONS = [
  { id: 'ci-next', label: 'Make next' }, { id: 'ci-week', label: 'This week' }, { id: 'ci-top', label: 'Videos' }, { id: 'ci-themes', label: 'Themes' },
  { id: 'ci-vs', label: 'Winners vs losers' }, { id: 'ci-lanes', label: 'Open lanes' }, { id: 'ci-data', label: 'Program data' },
]

function Badge({ tone, children }: { tone: { bg: string; fg: string }; children: React.ReactNode }) {
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[12px] whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>{children}</span>
}
const resultTone = (r: Result) => (r === 'worked' ? GOOD : r === 'failed' ? BAD : MID)
const RESULT_LABEL: Record<Result, string> = { worked: 'Worked', failed: 'Failed', neutral: 'In between', unjudged: 'Not judged' }
const signupTone = (t: ThemeRow | null) => (!t ? MID : t.signup === 'converts' ? GOOD : t.signup === 'no' ? BAD : MID)
const SIGNUP_LABEL = { converts: 'Converts', mixed: 'Mixed', no: 'Doesn’t convert', untested: 'Untested' } as const
const svResult = (v: SV): Result => (v.early || v.x == null ? 'unjudged' : v.x >= SCAN.worked ? 'worked' : v.x < SCAN.failed ? 'failed' : 'neutral')

function Section({ id, eyebrow, title, sub, children }: { id: string; eyebrow: string; title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-5 scroll-mt-36">
      <div className="flex flex-col gap-1.5">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="text-[28px] sm:text-[36px] leading-[1.1] font-bold" style={{ color: T.ink, letterSpacing: '-0.035em' }}>{title}</h2>
        {sub && <p className="text-[16px] max-w-[860px]" style={{ color: T.muted }}>{sub}</p>}
      </div>
      {children}
    </section>
  )
}

function Thumb({ vid, thumbs, w = 96 }: { vid: string | null; thumbs: Record<string, string>; w?: number }) {
  const h = Math.round((w * 9) / 16)
  return vid && thumbs[vid]
    ? <img src={thumbs[vid]} alt="" width={w} height={h} className="rounded-md shrink-0" style={{ objectFit: 'cover', width: w, height: h }} />
    : <span className="rounded-md shrink-0" style={{ background: T.tile, width: w, height: h }} />
}

export default function InsightsView({ d, thumbs, loading }: { d: CreatorsData; thumbs: Record<string, string>; loading?: boolean }) {
  const s = d.scan
  const judged = d.videos.filter(v => v.result !== 'unjudged').length
  return (
    <div className="flex flex-col gap-12 sm:gap-16 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <SectionBar label="Content insights sections">
        {SECTIONS.map(x => <a key={x.id} href={`#${x.id}`} onClick={e => { e.preventDefault(); document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth' }) }}
          className="rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap hover:underline" style={{ color: T.ink, border: `1px solid ${T.border}`, background: '#fff' }}>{x.label}</a>)}
        <span className="ml-auto text-[13px]" style={{ color: T.muted }}>
          {s ? `Scan of ${s.fetchedAt.slice(0, 10)}: ${fmtInt(s.pool.videos)} videos on ${s.pool.channels} channels · ` : 'No niche scan yet · '}our creators: {judged} videos judged, {fmtInt(d.program.ws)} workspaces since Apr 6
        </span>
      </SectionBar>

      <MakeNext d={d} thumbs={thumbs} />
      {s && <ThisWeek s={s} />}
      <Explorer d={d} thumbs={thumbs} />
      <Themes d={d} thumbs={thumbs} />
      <WinnersLosers d={d} />
      <Lanes d={d} />
      <ProgramData d={d} />
    </div>
  )
}

/** Niche videos as a table: title, channel, views, median, multiple, minutes, chapters, result. */
function NicheTable({ rows, s, showTheme, showAge }: { rows: SV[]; s: ScanDoc; showTheme?: boolean; showAge?: boolean }) {
  return (
    <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 760 }}>
      <thead><tr style={head}>
        <th className={`${th} text-left pl-0`}>Video</th><th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Channel median</th>
        <th className={`${th} text-right`}>Multiple</th><th className={`${th} text-right`}>{showAge ? 'Age (days)' : 'Minutes'}</th><th className={`${th} text-right`}>Chapters</th><th className={`${th} text-left`}>Result</th>
      </tr></thead>
      <tbody>{rows.map(v => {
        const c = s.channels[v.c], r = svResult(v)
        return (
          <tr key={v.id} style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="py-2 pr-3"><a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="hover:underline font-medium">{v.t}</a>
              <span className="block text-[13px]" style={{ color: T.muted }}>{c?.t ?? '—'}{c?.subs ? ` · ${compact(c.subs)} subs` : ''}{showTheme ? ` · ${themeLabel(v.th)}` : ''} · {v.p}</span></td>
            <td className={num} style={mono}>{fmtInt(v.v)}</td><td className={num} style={mono}>{fmtInt(c?.median)}</td>
            <td className={num} style={{ ...mono, fontWeight: 600 }}>{v.x == null ? '–' : `${r1(v.x)}×`}{v.early ? <span style={{ color: T.faint, fontWeight: 400 }}> early</span> : null}</td>
            <td className={num} style={mono}>{showAge ? ageDays(v.p, s.fetchedAt) : v.m}</td><td className={num} style={mono}>{v.ch || '–'}</td>
            <td className="px-3 py-2">{v.early ? <Badge tone={NEW}>Too new</Badge> : <Badge tone={resultTone(r)}>{RESULT_LABEL[r]}</Badge>}</td>
          </tr>)
      })}</tbody>
    </table></div>
  )
}

// ── 1. Make these next ─────────────────────────────────────────────────────────
function MakeNext({ d, thumbs }: { d: CreatorsData; thumbs: Record<string, string> }) {
  const [sel, setSel] = useState(0)
  if (!d.recs.length) return (
    <Section id="ci-next" eyebrow="Make these next" title="No niche scan yet">
      <p className="text-[15px]" style={{ color: T.muted }}>Recommendations come from the weekly niche scan (scripts/niche-scan.mjs, then niche-analyze.mjs → youtube/scan).</p>
    </Section>
  )
  const r = d.recs[Math.min(sel, d.recs.length - 1)]
  return (
    <Section id="ci-next" eyebrow={`Make these next · scan of ${d.scan!.fetchedAt.slice(0, 10)}`} title="Five videos to make next"
      sub={<>From this week’s scan of what the niche watches, worked back from the videos that beat their channel and the copies that didn’t. Ranked by <b style={{ color: T.ink }}>signup proof</b> from our creators first, then <b style={{ color: T.ink }}>watch demand</b>, how naturally Clay fits, and whether the theme is rising.</>}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2.5">
          <ol className="grid gap-2.5 grid-cols-1 md:grid-cols-2 xl:grid-cols-5">
            {d.recs.map((x, i) => {
              const on = i === sel
              const pill = (tone: { bg: string; fg: string }) => ({ background: on ? 'rgba(255,255,255,0.14)' : tone.bg, color: on ? '#fff' : tone.fg })
              return (
                <li key={x.theme}>
                  <button type="button" onClick={() => setSel(i)} aria-pressed={on}
                    className="w-full h-full text-left rounded-2xl p-4 flex gap-3 items-start focus:outline-none focus-visible:ring-2"
                    style={{ background: on ? T.ink : T.card, color: on ? '#fff' : T.ink, border: `1px solid ${on ? T.ink : T.border}` }}>
                    <span className="text-[28px] leading-none w-7 shrink-0" style={{ ...mono, opacity: 0.6 }}>{x.rank}</span>
                    <span className="flex flex-col gap-2 min-w-0">
                      <span className="text-[13px] uppercase" style={{ ...mono, letterSpacing: '0.08em', opacity: 0.7 }}>{x.label}</span>
                      <span className="text-[16px] font-semibold leading-snug">{x.title}</span>
                      <span className="flex flex-wrap gap-1.5 text-[12px]">
                        {x.status !== 'first' && <span className="rounded-full px-2 py-0.5" style={pill(x.status === 'new' ? NEW : MID)}>{x.status === 'new' ? 'New this week' : 'Still on the list'}</span>}
                        <span className="rounded-full px-2 py-0.5" style={pill(signupTone(x.themeRow))}>Signups: {SIGNUP_LABEL[x.themeRow?.signup ?? 'untested']}</span>
                        <span className="rounded-full px-2 py-0.5" style={pill(MID)}>Watch: {x.stat.worked} worked · {x.stat.failed} failed</span>
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
          {d.dropped.length > 0 && <p className="text-[13px] px-1" style={{ color: T.muted }}>Off the list since last week: {d.dropped.map(themeLabel).join(', ')}.</p>}
        </div>
        <RecDetail r={r} d={d} thumbs={thumbs} />
      </div>
    </Section>
  )
}

function RecDetail({ r, d, thumbs }: { r: Rec; d: CreatorsData; thumbs: Record<string, string> }) {
  const s = d.scan!
  const t = r.themeRow
  const ours = (t?.videos ?? []).filter(v => v.result !== 'unjudged').sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0)).slice(0, 5)
  const pkg: [string, string | null][] = [['Thumbnail', r.thumbnail], ['Structure', r.structure], ['Offer', r.offer], ['Evidence', r.notes]]
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-6 min-w-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><Eyebrow>{r.rank}. {r.label}</Eyebrow>{!r.written && <Badge tone={MID}>Draft title from the evidence</Badge>}</div>
        <p className="text-[24px] sm:text-[28px] font-bold leading-tight" style={{ letterSpacing: '-0.02em' }}>{r.title}</p>
        {r.angle && <p className="text-[15px]" style={{ color: T.muted }}>{r.angle}</p>}
      </div>
      <ul className="flex flex-col gap-2 text-[15px] leading-relaxed">
        {r.why.map((w, i) => <li key={i} className="flex gap-2"><span style={{ color: T.faint }}>•</span><span>{w}</span></li>)}
      </ul>

      {r.seps.length > 0 && <div className="flex flex-col gap-2">
        <Eyebrow>What separates the copies that worked from the ones that failed</Eyebrow>
        <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 520 }}>
          <thead><tr style={head}><th className={`${th} text-left pl-0`}>Trait</th><th className={`${th} text-right`}>Worked ({r.stat.worked})</th><th className={`${th} text-right`}>Failed ({r.stat.failed})</th></tr></thead>
          <tbody>{r.seps.map(x => {
            const w = x.w / x.wn, f = x.f / x.fn
            return <tr key={x.label} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3">{x.label}</td>
              <td className={num} style={{ ...mono, color: w > f ? GOOD.fg : T.ink }}>{fmtPct(w, 0)} <span style={{ color: T.faint }}>({x.w})</span></td>
              <td className={num} style={{ ...mono, color: f > w ? T.neg : T.ink }}>{fmtPct(f, 0)} <span style={{ color: T.faint }}>({x.f})</span></td></tr>
          })}</tbody>
        </table></div>
        {(r.stat.words.w.length > 0 || r.stat.words.f.length > 0) && <p className="text-[14px]" style={{ color: T.muted }}>
          Words in winning titles: <b style={{ color: GOOD.fg }}>{r.stat.words.w.join(', ') || '–'}</b>. In failing ones: <b style={{ color: T.neg }}>{r.stat.words.f.join(', ') || '–'}</b>.</p>}
      </div>}

      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Eyebrow>The package</Eyebrow>
          {r.written ? <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[14px]">
            {pkg.filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt style={{ color: T.muted }}>{k}</dt><dd>{v}</dd></Fragment>)}
          </dl> : <p className="text-[14px]" style={{ color: T.muted }}>Written in the weekly review. Until then, model it on the original hit and the winners below.</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Eyebrow>Make it measurable</Eyebrow>
          <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[14px]">
            {r.measure.map(([k, v]) => <Fragment key={k}><dt style={{ color: T.muted }}>{k}</dt><dd style={{ color: /To define|To test/.test(v) ? T.muted : T.ink }}>{v}</dd></Fragment>)}
          </dl>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Eyebrow>Our creators on this theme</Eyebrow>
        {ours.length ? ours.map(v => (
          <div key={v.key} className="flex items-center gap-3 text-[14px]">
            <Thumb vid={v.vid} thumbs={thumbs} w={64} />
            <span className="flex-1 min-w-0"><span className="line-clamp-1 font-medium">{v.title}</span><span className="text-[13px]" style={{ color: T.muted }}>{v.creator} · {v.placement}</span></span>
            <span className="text-right whitespace-nowrap" style={mono}>{fmtInt(v.m.ws)} ws · {r1(v.perK)}/1K</span>
            <Badge tone={resultTone(v.result)}>{RESULT_LABEL[v.result]}</Badge>
          </div>
        )) : <p className="text-[14px]" style={{ color: T.muted }}>None measured yet.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Eyebrow>Copies that worked (top) and failed (bottom) · niche scan</Eyebrow>
        <NicheTable rows={[...r.winners, ...r.losers]} s={s} />
      </div>
    </Card>
  )
}

// ── 2. This week ───────────────────────────────────────────────────────────────
function ThisWeek({ s }: { s: ScanDoc }) {
  const vid = new Map(s.videos.map(v => [v.id, v]))
  const fresh = s.pulse.newVideos.map(i => vid.get(i)).filter((v): v is SV => !!v)
  const hot = fresh.filter(v => (v.x ?? 0) >= 1.5)
  const moving = s.themes.filter(t => t.recentN >= 10 && t.priorN >= 10).map(t => ({ t, r: t.recentHits / t.recentN, p: t.priorHits / t.priorN }))
    .map(x => ({ ...x, d: x.r - x.p })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6)
  const since = s.prevFetchedAt ? `since the last scan (${s.prevFetchedAt.slice(0, 10)})` : `in the last ${SCAN.newDays} days (first scan)`
  return (
    <Section id="ci-week" eyebrow="Pulse" title="New this week"
      sub={`Videos first seen ${since} on the ${s.pool.channels} tracked channels, the channels the fresh searches found, title terms rising against the past year, and themes gaining or losing hits. Early multiples are views so far against the channel’s median, so they can only go up.`}>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {[[s.pulse.newTotal ?? fresh.length, 'new videos', `${s.pulse.earlyHits ?? hot.length} already at 1.5×+ their channel`], [s.pulse.newChannels.length, 'new channels', 'found by this week’s searches'], [s.pulse.terms.length, 'rising terms', 'at least 2× their share of last year’s titles']].map(([v, l, sub]) => (
          <div key={String(l)} className="rounded-[22px] p-5 flex flex-col gap-1" style={{ background: T.tile }}>
            <span className="text-[34px] leading-none" style={mono}>{fmtInt(Number(v))}</span><span className="text-[15px] font-medium">{l}</span><span className="text-[13px]" style={{ color: T.muted }}>{sub}</span>
          </div>))}
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
          <H2>Breaking out early</H2>
          <p className="text-[14px]" style={{ color: T.muted }}>New videos ranked by their early multiple. Watch these: next week they are judged like the rest.</p>
          {fresh.length ? <NicheTable rows={fresh.slice(0, 15)} s={s} showTheme showAge /> : <p className="text-[14px]" style={{ color: T.muted }}>No new videos in this scan.</p>}
        </Card>
        <div className="flex flex-col gap-6 min-w-0">
          <Card className="p-5 sm:p-8 flex flex-col gap-3">
            <H2>Rising terms</H2>
            {s.pulse.terms.length ? <ul className="flex flex-col gap-3">{s.pulse.terms.slice(0, 8).map(t => (
              <li key={t.term} className="flex flex-col gap-0.5">
                <span className="flex items-baseline gap-2"><b className="text-[15px]">{t.term}</b><span className="text-[13px]" style={{ ...mono, color: T.muted }}>{t.now} new · {t.base} last year · {r1(t.lift)}×</span></span>
                <span className="text-[13px] line-clamp-1" style={{ color: T.muted }}>{t.vids.map(i => vid.get(i)?.t).filter(Boolean).join(' · ')}</span>
              </li>))}</ul> : <p className="text-[14px]" style={{ color: T.muted }}>Nothing rising above 2× this week.</p>}
          </Card>
          <Card className="p-5 sm:p-8 flex flex-col gap-3">
            <H2>Theme momentum</H2>
            <p className="text-[13px]" style={{ color: T.muted }}>Share of videos at 3×+ in the last 90 days vs the year before.</p>
            <table className="w-full text-[14px]"><tbody>{moving.map(x => (
              <tr key={x.t.id} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2">{themeLabel(x.t.id)}</td>
                <td className={num} style={mono}>{fmtPct(x.p, 0)} → <b>{fmtPct(x.r, 0)}</b></td>
                <td className={`${num} pr-0`} style={{ ...mono, color: x.d > 0 ? GOOD.fg : T.neg }}>{x.d > 0 ? '▲' : '▼'}{Math.abs(x.d * 100).toFixed(0)}pp</td></tr>))}</tbody></table>
          </Card>
          {s.pulse.newChannels.length > 0 && <Card className="p-5 sm:p-8 flex flex-col gap-2">
            <H2>New channels</H2>
            <p className="text-[14px]">{s.pulse.newChannels.map(c => s.channels[c]?.t).filter(Boolean).join(', ')}</p>
          </Card>}
        </div>
      </div>
    </Section>
  )
}

// ── 3. Videos explorer ─────────────────────────────────────────────────────────
type SortKey = 'ws' | 'views' | 'multiple' | 't13' | 'act' | 'paid' | 'perK' | 'mins'
const sortVal = (v: VideoRow, k: SortKey): number => k === 'ws' ? v.m.ws : k === 'views' ? v.views ?? -1 : k === 'multiple' ? v.multiple ?? -1
  : k === 't13' ? v.m.t13 : k === 'act' ? (v.m.mat ? v.m.act / v.m.mat : -1) : k === 'paid' ? v.m.paid : k === 'perK' ? v.perK ?? -1 : v.mins ?? -1

function SortTh({ k, label, sort, setSort, tip }: { k: SortKey; label: string; sort: [SortKey, 1 | -1]; setSort: (s: [SortKey, 1 | -1]) => void; tip?: React.ReactNode }) {
  const on = sort[0] === k
  return (
    <th className={`${th} text-right`} aria-sort={on ? (sort[1] === -1 ? 'descending' : 'ascending') : 'none'}>
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={() => setSort([k, on ? (sort[1] === -1 ? 1 : -1) : -1])} className="uppercase hover:underline" style={{ color: on ? T.ink : T.muted, letterSpacing: '0.12em' }}>
          {label}{on ? (sort[1] === -1 ? ' ↓' : ' ↑') : ''}
        </button>
        {tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}
      </span>
    </th>
  )
}

function Spark({ xs }: { xs: number[] }) {
  if (xs.length < 2) return <span style={{ color: T.faint }}>–</span>
  const max = Math.max(1, ...xs), w = 72, h = 20
  return <svg width={w} height={h} aria-hidden><polyline points={xs.map((x, i) => `${(i / (xs.length - 1)) * w},${h - (x / max) * h}`).join(' ')} fill="none" stroke={T.pos} strokeWidth="1.5" /></svg>
}

type When = 'week' | '90d' | 'all'
const WHEN: { id: When; label: string; days: number | null }[] = [{ id: 'week', label: 'New this week', days: SCAN.newDays }, { id: '90d', label: 'Last 90 days', days: 90 }, { id: 'all', label: 'All time', days: null }]

function Explorer({ d, thumbs }: { d: CreatorsData; thumbs: Record<string, string> }) {
  const [src, setSrc] = useState<'ours' | 'niche'>('ours')
  const [when, setWhen] = useState<When>('all')
  const [theme, setTheme] = useState<ThemeId | 'all'>('all')
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['ws', -1])
  const [nsort, setNsort] = useState<'x' | 'v' | 'p'>('x')
  const [all, setAll] = useState(false)
  const s = d.scan
  const now = s?.fetchedAt ?? d.dataEnd
  const win = WHEN.find(w => w.id === when)!.days
  const inWin = (day: string | null) => !win || (!!day && ageDays(day, now) <= win)
  // Small lists (tens to a few hundred rows): filtered and sorted on every render.
  const ours = d.rows.filter(v => (all || v.attribution !== 'excluded') && (theme === 'all' || v.theme === theme) && inWin(v.live))
    .sort((a, b) => sort[1] * (sortVal(a, sort[0]) - sortVal(b, sort[0])))
  const niche = (s?.videos ?? []).filter(v => !s!.channels[v.c]?.program && (theme === 'all' || v.th === theme) && (when === 'week' ? v.isNew : inWin(v.p)))
    .sort((a, b) => nsort === 'x' ? (b.x ?? 0) - (a.x ?? 0) : nsort === 'v' ? b.v - a.v : b.p.localeCompare(a.p))
  const themesHere = [...new Set([...d.rows.map(v => v.theme), ...(s?.videos ?? []).map(v => v.th)])].filter(t => t !== 'other')
  return (
    <Section id="ci-top" eyebrow="Explore" title="Videos"
      sub="Slice by source, time and theme. Our creators’ videos are ranked by the workspaces they drove (click a column to sort); the niche scan’s by how far they beat their own channel.">
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={src === 'ours'} onClick={() => setSrc('ours')}>Our creators · workspaces</Chip>
        {s && <Chip on={src === 'niche'} onClick={() => setSrc('niche')}>Niche scan · views</Chip>}
        <span className="mx-1 h-5 w-px" style={{ background: T.border }} />
        {WHEN.map(w => <Chip key={w.id} on={when === w.id} onClick={() => setWhen(w.id)}>{w.label}</Chip>)}
        <span className="mx-1 h-5 w-px" style={{ background: T.border }} />
        <select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value as ThemeId | 'all')} className="rounded-full px-3 py-1.5 text-[13px]" style={{ border: `1px solid ${T.border}`, background: '#fff' }}>
          <option value="all">All themes</option>{themesHere.map(t => <option key={t} value={t}>{themeLabel(t)}</option>)}
        </select>
        {src === 'niche' && <select aria-label="Sort" value={nsort} onChange={e => setNsort(e.target.value as 'x' | 'v' | 'p')} className="rounded-full px-3 py-1.5 text-[13px]" style={{ border: `1px solid ${T.border}`, background: '#fff' }}>
          <option value="x">Sort: multiple</option><option value="v">Sort: views</option><option value="p">Sort: newest</option></select>}
      </div>
      {src === 'niche' && s ? <Card className="p-5 sm:p-8">
        {niche.length ? <NicheTable rows={niche.slice(0, all ? 200 : 20)} s={s} showTheme /> : <p className="text-[14px]" style={{ color: T.muted }}>No scan videos for this slice.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-[13px]" style={{ color: T.muted }}>The scan keeps outliers (3×+ the channel and its neighbours, 5,000+ views, two per channel), each theme’s winners and failures, and every new video. Views only: the scan can’t see signups.</p>
          {niche.length > 20 && <button type="button" onClick={() => setAll(x => !x)} className="text-[14px] underline">{all ? 'Show top 20' : `Show all ${Math.min(200, niche.length)}`}</button>}
        </div>
      </Card> : <Card className="p-5 sm:p-8">
        {ours.length === 0 ? <p className="text-[14px]" style={{ color: T.muted }}>None of our creators’ videos went live in this slice.</p> :
        <div className="overflow-x-auto -mx-5 sm:-mx-8">
          <table className="w-full text-[14px]" style={{ color: T.ink, minWidth: 1120 }}>
            <thead><tr style={head}>
              <th className={`${th} text-left pl-5 sm:pl-8`}>Video</th>
              <th className={`${th} text-left`}>Theme · placement</th>
              <SortTh k="views" label="Views" sort={sort} setSort={setSort} />
              <SortTh k="multiple" label="× median" sort={sort} setSort={setSort} tip={<Def d="Views against the channel’s median long-form video. Under 1 = the sponsored video did worse than the channel’s usual." />} />
              <SortTh k="ws" label="Workspaces" sort={sort} setSort={setSort} tip={<Def d="New workspaces whose first-touch session was the video’s link (?via=), 90-day window, since Apr 6." src="FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION × MARKETING_WEBSITE_SESSIONS" />} />
              <SortTh k="t13" label="Tier 1–3" sort={sort} setSort={setSort} />
              <SortTh k="act" label="Act. 7d" sort={sort} setSort={setSort} />
              <SortTh k="paid" label="Paid" sort={sort} setSort={setSort} />
              <SortTh k="perK" label="Per 1K views" sort={sort} setSort={setSort} tip={<Def d="Workspaces per 1,000 views. Only for videos with a link of their own." note={`Worked: ${RESULT.workedPerK}+ with ${RESULT.workedMinWs}+ workspaces. Failed: under ${RESULT.failedPerK} with ${fmtInt(RESULT.failedMinViews)}+ views.`} />} />
              <th className={`${th} text-left`}>Weekly</th>
              <th className={`${th} text-left pr-5 sm:pr-8`}>Result</th>
            </tr></thead>
            <tbody>{(all ? ours : ours.slice(0, 10)).map(v => (
              <tr key={v.key} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5 pl-5 sm:pl-8">
                  <div className="flex items-center gap-3 min-w-[300px]">
                    <Thumb vid={v.vid} thumbs={thumbs} />
                    <span className="flex flex-col min-w-0">
                      {v.url && !v.group ? <a href={v.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:underline line-clamp-2">{v.title}</a>
                        : <span className="font-medium leading-snug line-clamp-2" title={v.group?.titles.join('\n')}>{v.title}</span>}
                      <span className="text-[13px]" style={{ color: T.muted }}>{v.creator}{v.fit ? ` · ${v.fit}` : ''}{v.subs ? ` · ${compact(v.subs)} subs` : ''}{v.live ? ` · live ${v.live}` : ''}</span>
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5"><span className="flex flex-col"><span>{themeLabel(v.theme)}</span><span className="text-[13px]" style={{ color: T.muted }}>{v.placement}</span></span></td>
                <td className={num} style={mono}>{fmtInt(v.views)}</td>
                <td className={num} style={{ ...mono, color: v.multiple == null ? T.faint : v.multiple >= 2 ? GOOD.fg : v.multiple < 0.7 ? T.neg : T.ink }}>{v.multiple == null ? '–' : `${r1(v.multiple)}×`}</td>
                <td className={num} style={{ ...mono, fontWeight: 600 }}>{fmtInt(v.m.ws)}</td>
                <td className={num} style={mono}>{fmtInt(v.m.t13)}</td>
                <td className={num} style={mono}>{v.m.mat ? fmtPct(v.m.act / v.m.mat, 0) : '–'}</td>
                <td className={num} style={mono}>{fmtInt(v.m.paid)}</td>
                <td className={num} style={{ ...mono, fontWeight: 600 }}>{r1(v.perK)}</td>
                <td className="px-3 py-2.5"><Spark xs={v.spark} /></td>
                <td className="px-3 py-2.5 pr-5 sm:pr-8">{v.young ? <Badge tone={NEW}>Too new</Badge> : v.attribution === 'direct' ? <Badge tone={resultTone(v.result)}>{RESULT_LABEL[v.result]}</Badge>
                  : <Badge tone={MID}>{v.attribution === 'shared' ? 'Shared link' : ATTRIBUTION[v.attribution]}</Badge>}</td>
              </tr>))}</tbody>
          </table>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <p className="text-[13px]" style={{ color: T.muted }}>A link shared by several videos is one row: its workspaces can’t be split between them. “Excluded” and “Not measurable” follow the program sheet’s flags.</p>
          <button type="button" onClick={() => setAll(x => !x)} className="text-[14px] underline" style={{ color: T.ink }}>{all ? 'Show top 10' : `Show all ${ours.length}, including excluded`}</button>
        </div>
      </Card>}
    </Section>
  )
}

// ── 4. Themes ──────────────────────────────────────────────────────────────────
function Themes({ d, thumbs }: { d: CreatorsData; thumbs: Record<string, string> }) {
  const [sel, setSel] = useState<ThemeId | 'all'>('all')
  const base = d.scan?.pool.baseRate ?? 0
  const pool = sel === 'all' ? d.videos : d.themes.find(t => t.id === sel)?.videos ?? []
  const w = pool.filter(v => v.result === 'worked').sort((a, b) => (b.perK ?? 0) - (a.perK ?? 0))
  const f = pool.filter(v => v.result === 'failed').sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
  const rows = [...d.themes].sort((a, b) => (b.worked - b.failed) - (a.worked - a.failed) || (b.demand ? b.demand.hits / b.demand.n : 0) - (a.demand ? a.demand.hits / a.demand.n : 0))
  return (
    <Section id="ci-themes" eyebrow="Themes" title="What worked and what didn’t, by theme"
      sub={<>Two columns of proof side by side: our creators’ videos judged on workspaces, and the niche scan’s copies judged on views (share at 3×+ their channel; scan base rate {fmtPct(base, 0)}). Click a theme to see our videos on it.</>}>
      <Card className="p-5 sm:p-8">
        <div className="overflow-x-auto -mx-5 sm:-mx-8">
          <table className="w-full text-[14px]" style={{ color: T.ink, minWidth: 1000 }}>
            <thead><tr style={head}>
              <th className={`${th} text-left pl-5 sm:pl-8`}>Theme</th><th className={`${th} text-left`}>Verdict</th>
              <th className={`${th} text-right`}>Ours: worked · failed</th><th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right`}>Median per 1K</th>
              <th className={`${th} text-right`}>Niche: hit rate</th><th className={`${th} text-right`}>Copies worked · failed</th><th className={`${th} text-right pr-5 sm:pr-8`}>Clay fit</th>
            </tr></thead>
            <tbody>
              {rows.map(t => {
                const on = sel === t.id, rate = t.demand ? t.demand.hits / t.demand.n : null
                return (
                  <tr key={t.id} onClick={() => setSel(on ? 'all' : t.id)} className="cursor-pointer" aria-selected={on} style={{ borderBottom: `1px solid ${T.border}`, background: on ? T.tile : undefined }}>
                    <td className="px-3 py-3 pl-5 sm:pl-8"><span className="flex flex-col min-w-[260px]"><span className="font-medium">{t.label}</span><span className="text-[13px]" style={{ color: T.muted }}>{t.desc} · {t.videos.length} of ours</span></span></td>
                    <td className="px-3 py-3"><Badge tone={t.tone === 'pos' ? GOOD : t.tone === 'neg' ? BAD : MID}>{t.verdict}</Badge></td>
                    <td className={num} style={mono}><span style={{ color: t.worked ? GOOD.fg : T.faint }}>{t.worked}</span> · <span style={{ color: t.failed ? T.neg : T.faint }}>{t.failed}</span></td>
                    <td className={num} style={mono}>{fmtInt(t.ws)}</td>
                    <td className={num} style={{ ...mono, fontWeight: 600 }}>{r1(t.median)}</td>
                    <td className={num}>{rate == null ? <span style={{ color: T.faint }}>–</span> : <span style={{ ...mono, color: rate >= base ? T.ink : T.neg }}>{fmtPct(rate, 0)} <span style={{ color: T.faint }}>of {fmtInt(t.demand!.n)}</span></span>}</td>
                    <td className={num} style={mono}>{t.demand ? `${t.demand.worked} · ${t.demand.failed}` : '–'}</td>
                    <td className={`${num} pr-5 sm:pr-8`} style={mono}>{clayFit(t.id) >= 1 ? 'High' : clayFit(t.id) >= 0.6 ? 'Medium' : 'Low'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="p-5 sm:p-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <H2>{sel === 'all' ? 'All themes' : themeLabel(sel)}: our videos that worked (top) and failed (bottom)</H2>
          {sel !== 'all' && <button type="button" className="text-[14px] underline" onClick={() => setSel('all')}>Show all themes</button>}
        </div>
        {w.length + f.length === 0 ? <p className="text-[15px]" style={{ color: T.muted }}>None of our videos on this theme has enough views and workspaces to judge yet.</p> :
          <div className="overflow-x-auto -mx-5 sm:-mx-8"><table className="w-full text-[14px]" style={{ minWidth: 880 }}>
            <thead><tr style={head}>
              <th className={`${th} text-left pl-5 sm:pl-8`}>Video</th><th className={`${th} text-left`}>Placement</th><th className={`${th} text-right`}>Views</th>
              <th className={`${th} text-right`}>× median</th><th className={`${th} text-right`}>Minutes</th><th className={`${th} text-right`}>Chapters</th>
              <th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right`}>Per 1K</th><th className={`${th} text-left pr-5 sm:pr-8`}>Result</th>
            </tr></thead>
            <tbody>{[...w, ...f].map(v => (
              <tr key={v.key} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2 pl-5 sm:pl-8"><span className="flex items-center gap-3"><Thumb vid={v.vid} thumbs={thumbs} w={64} /><span className="flex flex-col min-w-0"><span className="line-clamp-1 font-medium">{v.title}</span><span className="text-[13px]" style={{ color: T.muted }}>{v.creator}{sel === 'all' ? ` · ${themeLabel(v.theme)}` : ''}</span></span></span></td>
                <td className="px-3 py-2">{v.placement}</td>
                <td className={num} style={mono}>{fmtInt(v.views)}</td><td className={num} style={mono}>{v.multiple == null ? '–' : `${r1(v.multiple)}×`}</td>
                <td className={num} style={mono}>{v.mins == null ? '–' : Math.round(v.mins)}</td><td className={num} style={mono}>{v.chapters || '–'}</td>
                <td className={num} style={{ ...mono, fontWeight: 600 }}>{fmtInt(v.m.ws)}</td><td className={num} style={{ ...mono, fontWeight: 600 }}>{r1(v.perK)}</td>
                <td className="px-3 py-2 pr-5 sm:pr-8"><Badge tone={resultTone(v.result)}>{RESULT_LABEL[v.result]}</Badge></td>
              </tr>))}</tbody>
          </table></div>}
      </Card>
    </Section>
  )
}

// ── 5. Winners vs losers ───────────────────────────────────────────────────────
function WinnersLosers({ d }: { d: CreatorsData }) {
  const pts = d.videos.filter(v => v.result !== 'unjudged' && v.views).map(v => ({ x: v.views!, y: Math.max(0.01, v.perK ?? 0), name: `${v.creator}: ${v.title}`, ws: v.m.ws, r: v.result }))
  const series: [Result, string][] = [['worked', GOOD.fg], ['neutral', 'rgba(26,25,21,0.35)'], ['failed', T.neg]]
  return (
    <Section id="ci-vs" eyebrow="Why they work" title="Winners vs losers, side by side"
      sub={`Our creators’ ${d.worked.length} videos that worked on signups against the ${d.failed.length} that failed. Same rules as above; small groups, so read as direction.`}>
      {d.takeaway && <div className="rounded-2xl px-5 py-4 text-[16px] leading-relaxed" style={{ background: T.ink, color: '#fff' }}>{d.takeaway}</div>}
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5 sm:p-8">
          <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 560 }}>
            <thead><tr style={head}><th className={`${th} text-left pl-0`}>Factor</th><th className={`${th} text-left`}>Worked ({d.worked.length})</th><th className={`${th} text-left`}>Failed ({d.failed.length})</th></tr></thead>
            <tbody>{d.factors.map(f => (
              <tr key={f.factor} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="py-3 pr-3 font-medium align-top">{f.factor}</td>
                <td className="px-3 py-3 align-top" style={{ color: GOOD.fg }}>{f.worked}</td>
                <td className="px-3 py-3 align-top" style={{ color: T.neg }}>{f.failed}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
        <Card className="p-5 sm:p-8 flex flex-col gap-3">
          <H2>Reach vs signups</H2>
          <p className="text-[14px]" style={{ color: T.muted }}>Each dot is a video. Right = more views, up = more workspaces per 1K views (both log scale).</p>
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: -8 }}>
                <CartesianGrid stroke={T.barTrack} />
                <XAxis type="number" dataKey="x" scale="log" domain={['auto', 'auto']} tickFormatter={compact} tick={{ fontSize: 12, fill: T.muted }} name="Views" />
                <YAxis type="number" dataKey="y" scale="log" domain={[0.01, 'auto']} tickFormatter={(x: number) => r1(x)} tick={{ fontSize: 12, fill: T.muted }} name="Per 1K" />
                <ZAxis range={[60, 60]} />
                <Tooltip cursor={false} content={({ payload }) => {
                  const p = payload?.[0]?.payload as (typeof pts)[number] | undefined
                  return p ? <div className="rounded-lg px-3 py-2 text-[12px] max-w-[260px]" style={{ background: T.ink, color: '#fff' }}><b>{p.name}</b><br />{fmtInt(p.x)} views · {fmtInt(p.ws)} workspaces · {r1(p.y)} per 1K</div> : null
                }} />
                {series.map(([r, c]) => <Scatter key={r} data={pts.filter(p => p.r === r)} fill={c} name={RESULT_LABEL[r]} />)}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex gap-4 text-[13px]" style={{ color: T.muted }}>{series.map(([r, c]) => <span key={r} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{RESULT_LABEL[r]}</span>)}</div>
        </Card>
      </div>
    </Section>
  )
}

// ── 6. Open lanes ──────────────────────────────────────────────────────────────
function Lanes({ d }: { d: CreatorsData }) {
  const s = d.scan
  if (!s) return null
  const vid = new Map(s.videos.map(v => [v.id, v]))
  // Watched more than the niche's base rate, by few channels, and not yet tested by our creators.
  const lanes = s.themes.filter(t => t.n >= 10 && clayFit(t.id) > 0 && t.hits / t.n >= s.pool.baseRate).map(t => {
    const ours = d.themes.find(x => x.id === t.id)
    return { t, ours, rate: t.hits / t.n, open: !ours || ours.judged === 0 }
  }).sort((a, b) => Number(b.open) - Number(a.open) || b.rate * clayFit(b.t.id) - a.rate * clayFit(a.t.id)).slice(0, 5)
  const fmts = [...s.formats].filter(f => f.n >= 10).sort((a, b) => b.hits / b.n - a.hits / a.n)
  return (
    <Section id="ci-lanes" eyebrow="Where to play" title="Open lanes and title formats"
      sub="Themes the niche watches more than its base rate, open ones first (none of our creators has a judged video on them), and how each title format does in the scan.">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-5">
        {lanes.map(({ t, ours, rate, open }) => {
          const o = t.original ? vid.get(t.original) : null
          return (
            <div key={t.id} className="rounded-2xl p-5 flex flex-col gap-2.5" style={{ background: T.tile }}>
              <Badge tone={open ? GOOD : MID}>{open ? 'Open for us' : 'Tested by us'}</Badge>
              <p className="text-[16px] font-semibold leading-snug">{themeLabel(t.id)}</p>
              <p className="text-[13px] leading-snug" style={{ color: T.muted }}>{fmtPct(rate, 0)} of {fmtInt(t.n)} videos at 3×+ on {t.winChannels} channels with a winner; {t.recentHits} hits in the last 90 days.{o ? ` Top: “${o.t}” (${r1(o.x)}×).` : ''}</p>
              <p className="text-[13px] mt-auto pt-2" style={{ borderTop: `1px solid ${T.border}` }}>Our creators: {ours?.judged ? `${ours.worked} worked, ${ours.failed} failed of ${ours.judged}` : ours?.videos.length ? `${ours.videos.length} video${ours.videos.length === 1 ? '' : 's'}, none judged` : 'not tested'}</p>
            </div>
          )
        })}
      </div>
      <Card className="p-5 sm:p-8">
        <div className="overflow-x-auto -mx-5 sm:-mx-8"><table className="w-full text-[14px]" style={{ minWidth: 900 }}>
          <thead><tr style={head}><th className={`${th} text-left pl-5 sm:pl-8`}>Title format</th><th className={`${th} text-right`}>Hit rate</th><th className={`${th} text-right`}>Below 0.5×</th><th className={`${th} text-left`}>Best example</th><th className={`${th} text-left pr-5 sm:pr-8`}>Worst example</th></tr></thead>
          <tbody>{fmts.map(f => {
            const rate = f.hits / f.n, b = vid.get(f.best[0]), w = vid.get(f.worst[0])
            return (
              <tr key={f.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5 pl-5 sm:pl-8 font-medium">{formatLabel(f.id as FormatId)}</td>
                <td className={num} style={{ ...mono, color: rate >= s.pool.baseRate ? GOOD.fg : T.neg }}>{fmtPct(rate, 0)} <span style={{ color: T.faint }}>of {fmtInt(f.n)}</span></td>
                <td className={num} style={mono}>{fmtPct(f.below / f.n, 0)}</td>
                <td className="px-3 py-2.5">{b ? <>{b.t} <span style={{ ...mono, color: T.muted }}>{r1(b.x)}×</span></> : '–'}</td>
                <td className="px-3 py-2.5 pr-5 sm:pr-8" style={{ color: T.muted }}>{w ? <>{w.t} <span style={mono}>{r1(w.x)}×</span></> : '–'}</td>
              </tr>)
          })}</tbody>
        </table></div>
        <p className="text-[13px] mt-4" style={{ color: T.muted }}>Niche scan, views only. Formats come from title rules, so a title can count in more than one. Base rate {fmtPct(s.pool.baseRate, 0)} of {fmtInt(s.pool.scored)} scored videos.</p>
      </Card>
    </Section>
  )
}

// ── 7. Program data (folded) ───────────────────────────────────────────────────
function ProgramData({ d }: { d: CreatorsData }) {
  return (
    <section id="ci-data" className="scroll-mt-36">
      <details className="rounded-2xl" style={{ background: T.tile }}>
        <summary className="cursor-pointer select-none px-5 py-4 text-[16px] font-semibold">Program data: funnel, unnamed links, Rewardful vs warehouse</summary>
        <div className="px-5 pb-6 flex flex-col gap-6">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-9">
            {d.funnel.map(s => {
              const conv = s.value != null && s.of?.value ? s.value / s.of.value : null
              return (
                <div key={s.label} className="rounded-xl p-3 flex flex-col gap-1 min-w-0" style={{ background: '#fff', opacity: s.value == null ? 0.6 : 1 }}>
                  <span className="text-[11px] uppercase" style={{ ...mono, letterSpacing: '0.08em', color: T.muted }}>{s.label}</span>
                  <span className="text-[20px] leading-none" style={{ ...mono, color: s.value == null ? T.faint : T.ink }} title={s.value == null ? undefined : fmtInt(s.value)}>{s.value == null ? 'n/a' : compact(s.value)}</span>
                  <span className="text-[11px]" style={{ ...mono, color: T.muted }}>{conv != null ? `${fmtPct(conv, conv < 0.01 ? 2 : 1)} of ${s.of!.label}` : ' '}</span>
                  <span className="text-[11px] leading-snug" style={{ color: T.muted }}>{s.note} · {s.owner}</span>
                </div>
              )
            })}
          </div>
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <div className="overflow-x-auto">
              <Eyebrow>Links not in the program sheet</Eyebrow>
              <table className="w-full text-[14px] mt-2" style={{ minWidth: 340 }}>
                <thead><tr style={head}><th className={`${th} text-left pl-0`}>Token</th><th className={`${th} text-right`}>Visitors</th><th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right`}>Paid</th></tr></thead>
                <tbody>{d.unmapped.slice(0, 10).map(u => <tr key={u.tok} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2"><code className="text-[13px]">{u.tok}</code></td><td className={num} style={mono}>{fmtInt(u.m.vis)}</td><td className={num} style={mono}>{fmtInt(u.m.ws)}</td><td className={num} style={mono}>{fmtInt(u.m.paid)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="overflow-x-auto">
              <Eyebrow>Rewardful signups vs warehouse workspaces</Eyebrow>
              <table className="w-full text-[14px] mt-2" style={{ minWidth: 340 }}>
                <thead><tr style={head}><th className={`${th} text-left pl-0`}>Token</th><th className={`${th} text-right`}>Rewardful</th><th className={`${th} text-right`}>Warehouse</th><th className={`${th} text-right`}>Ratio</th></tr></thead>
                <tbody>{d.reconcile.slice(0, 12).map(r => {
                  const x = r.rewardful ? r.warehouse / r.rewardful : null, off = x != null && r.rewardful >= 20 && (x < 0.6 || x > 1.6)
                  return <tr key={r.token} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2"><code className="text-[13px]">{r.token}</code></td><td className={num} style={mono}>{fmtInt(r.rewardful)}</td><td className={num} style={mono}>{fmtInt(r.warehouse)}</td><td className={num} style={{ ...mono, color: off ? T.neg : T.ink }}>{x == null ? '–' : `${x.toFixed(2)}×`}</td></tr>
                })}</tbody>
              </table>
            </div>
          </div>
          <p className="text-[13px]" style={{ color: T.muted }}>
            Program links drove {fmtInt(d.program.ws)} of {fmtInt(d.all.ws)} affiliate-link workspaces since Apr 6 ({fmtPct(d.programShare, 0)}). Data through {d.dataEnd}; creator list synced {d.fetchedAt.slice(0, 10)}.
          </p>
        </div>
      </details>
    </section>
  )
}
