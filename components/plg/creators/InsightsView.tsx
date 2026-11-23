'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { ATTRIBUTION, REC, RESULT, r1, type CreatorsData, type Rec, type Result, type VideoRow } from '@/lib/plg/creators/compute'
import { briefMarkdown } from '@/lib/plg/creators/brief'
import { SCAN, type SV, type ScanDoc, type Sep } from '@/lib/plg/creators/scan'
import { assistantLabel, clayFit, formatLabel, themeLabel, type FormatId, type ThemeId } from '@/lib/plg/creators/themes'
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
  { id: 'ci-vs', label: 'Winners vs losers' }, { id: 'ci-data', label: 'Program data' },
]
/** What the side panel shows: an idea, a niche video or one of our videos. */
type Sel = { k: 'idea'; key: string } | { k: 'niche'; id: string } | { k: 'ours'; key: string } | null
/** Opens an idea (expands its row in place) or a video (its detail panel). */
type Open = (s: Sel) => void
/** An idea's own link: #insights-idea=<theme:format> (the dashboard routes #insights* to this tab). */
const HASH = 'insights-idea='

function Badge({ tone, children }: { tone: { bg: string; fg: string }; children: React.ReactNode }) {
  return <span className="inline-flex rounded-full px-2 py-0.5 text-[12px] whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>{children}</span>
}
const resultTone = (r: Result) => (r === 'worked' ? GOOD : r === 'failed' ? BAD : MID)
const RESULT_LABEL: Record<Result, string> = { worked: 'Worked', failed: 'Failed', neutral: 'In between', unjudged: 'Not judged' }
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

function Thumb({ vid, thumbs, w = 96, fluid }: { vid: string | null; thumbs: Record<string, string>; w?: number; fluid?: boolean }) {
  const h = Math.round((w * 9) / 16)
  // fluid: fills its column at 16:9 (grids); otherwise a fixed size, capped to the column on phones.
  const size = fluid ? { width: '100%', aspectRatio: '16 / 9' } : { width: w, maxWidth: '100%', aspectRatio: '16 / 9' }
  return vid && thumbs[vid]
    ? <img src={thumbs[vid]} alt="" width={w} height={h} className="rounded-md shrink-0 block" style={{ objectFit: 'cover', ...size }} />
    : <span className="rounded-md shrink-0 block" style={{ background: T.tile, ...size }} />
}

export default function InsightsView({ d, thumbs, loading, onDownload }: { d: CreatorsData; thumbs: Record<string, string>; loading?: boolean; onDownload?: (filename: string, text: string) => Promise<void> }) {
  const s = d.scan
  const judged = d.videos.filter(v => v.result !== 'unjudged').length
  // An idea's panel has its own link, so a brief can be shared.
  const [sel, setSel] = useState<Sel>(null)
  const [expanded, setExpandedState] = useState<string | null>(() => {
    try { const h = decodeURIComponent(window.location.hash.slice(1)); return h.startsWith(HASH) ? h.slice(HASH.length) : null } catch { return null }
  })
  const setExpanded = (k: string | null) => {
    setExpandedState(k)
    try { history.replaceState(null, '', k ? `#${HASH}${encodeURIComponent(k)}` : '#insights') } catch { /* sandboxed */ }
  }
  // An idea link (#insights-idea=…) lands on its row, expanded.
  useEffect(() => { if (expanded) setTimeout(() => document.getElementById(`idea-${expanded}`)?.scrollIntoView({ block: 'start' }), 300) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const open: Open = x => {
    if (x?.k === 'idea') { setSel(null); setExpanded(x.key); setTimeout(() => document.getElementById(`idea-${x.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); return }
    setSel(x)
  }
  const niche = sel?.k === 'niche' ? s?.videos.find(v => v.id === sel.id) ?? null : null
  const ours = sel?.k === 'ours' ? d.rows.find(v => v.key === sel.key) ?? d.videos.find(v => v.key === sel.key) ?? null : null
  return (
    <div className="flex flex-col gap-12 sm:gap-16 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <SectionBar label="Content insights sections">
        {SECTIONS.map(x => <a key={x.id} href={`#${x.id}`} onClick={e => { e.preventDefault(); document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth' }) }}
          className="rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap hover:underline" style={{ color: T.ink, border: `1px solid ${T.border}`, background: '#fff' }}>{x.label}</a>)}
        <span className="ml-auto text-[13px]" style={{ color: T.muted }}>
          {s ? `Scan of ${s.fetchedAt.slice(0, 10)}: ${fmtInt(s.pool.videos)} videos on ${s.pool.channels} channels · ` : 'No niche scan yet · '}our creators: {judged} videos judged, {fmtInt(d.program.ws)} workspaces since Apr 6
        </span>
      </SectionBar>

      <MakeNext d={d} thumbs={thumbs} expanded={expanded} setExpanded={setExpanded} open={open} onDownload={onDownload} />
      {s && <ThisWeek s={s} d={d} open={open} />}
      <Explorer d={d} thumbs={thumbs} open={open} />
      <Themes d={d} thumbs={thumbs} open={open} />
      <WinnersLosers d={d} />
      <ProgramData d={d} />

      <Drawer open={!!(niche || ours)} onClose={() => open(null)} title={niche ? 'Niche video' : 'Our creator’s video'}>
        {niche && s && <NicheDetail v={niche} s={s} d={d} thumbs={thumbs} open={open} />}
        {ours && <OursDetail v={ours} thumbs={thumbs} />}
      </Drawer>
    </div>
  )
}

/** Right-hand side panel, half the screen on desktop and full width on phones. Escape or the backdrop closes it. */
function Drawer({ open, onClose, title, nav, children }: { open: boolean; onClose: () => void; title: string; nav?: { prev: (() => void) | null; next: (() => void) | null }; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [open, onClose])
  useEffect(() => { ref.current?.scrollTo({ top: 0 }) }, [children])
  if (!open) return null
  const btn = 'rounded-full px-3 py-1.5 text-[13px] whitespace-nowrap disabled:opacity-40'
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default" style={{ background: 'rgba(26,25,21,0.32)' }} onClick={onClose} />
      <aside ref={ref} tabIndex={-1} className="relative h-full w-full md:w-[56vw] md:min-w-[620px] md:max-w-[980px] overflow-y-auto focus:outline-none shadow-2xl" style={{ background: T.page }}>
        <div className="sticky top-0 z-10 flex items-center gap-2 px-5 sm:px-8 py-3" style={{ background: T.page, borderBottom: `1px solid ${T.border}` }}>
          <span className="text-[13px] uppercase mr-auto" style={{ ...mono, letterSpacing: '0.1em', color: T.muted }}>{title}</span>
          {nav && <><button type="button" className={btn} style={{ border: `1px solid ${T.border}` }} disabled={!nav.prev} onClick={nav.prev ?? undefined} aria-label="Previous idea">←<span className="hidden sm:inline"> Previous</span></button>
            <button type="button" className={btn} style={{ border: `1px solid ${T.border}` }} disabled={!nav.next} onClick={nav.next ?? undefined} aria-label="Next idea"><span className="hidden sm:inline">Next </span>→</button></>}
          <button type="button" onClick={onClose} className={btn} style={{ background: T.ink, color: '#fff' }} aria-label="Close">✕<span className="hidden sm:inline"> Close</span></button>
        </div>
        <div className="px-5 sm:px-8 py-6 flex flex-col gap-8">{children}</div>
      </aside>
    </div>
  )
}

/**
 * Niche videos as a table, led by how far each beat its own channel. Signups only exist for our creators' videos (the
 * rest carry no Clay link): those show their workspaces, the others say so.
 */
function NicheTable({ rows, s, d, showTheme, showAge, open }: { rows: SV[]; s: ScanDoc; d: CreatorsData; showTheme?: boolean; showAge?: boolean; open: Open }) {
  const ours = new Map(d.videos.filter(v => v.vid).map(v => [v.vid!, v]))
  return (
    <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 860 }}>
      <thead><tr style={head}>
        <th className={`${th} text-left pl-0`}>Video</th><th className={`${th} text-right`}>× channel median</th><th className={`${th} text-right`}>Views</th>
        <th className={`${th} text-right`}>{showAge ? 'Age (days)' : 'Minutes'}</th><th className={`${th} text-right`}>Chapters</th>
        <th className={`${th} text-right`}><span className="inline-flex items-center gap-1">Signups<InfoTip label="About signups"><Def d="New workspaces from the video’s own Clay link. Only our creators’ videos have one; for everyone else’s there’s nothing to measure." /></InfoTip></span></th>
        <th className={`${th} text-left`}>Result</th>
      </tr></thead>
      <tbody>{rows.map(v => {
        const c = s.channels[v.c], r = svResult(v), o = ours.get(v.id)
        return (
          <tr key={v.id} onClick={() => open({ k: 'niche', id: v.id })} className="cursor-pointer hover:bg-[#F6F5F1]" style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="py-2 pr-3"><span className="font-medium">{v.t}</span>
              <span className="block text-[13px]" style={{ color: T.muted }}>{c?.t ?? '—'}{c?.subs ? ` · ${compact(c.subs)} subs` : ''}{showTheme ? ` · ${themeLabel(v.th)}` : ''} · {v.p}</span></td>
            <td className={num} style={{ ...mono, fontWeight: 600, color: (v.x ?? 0) >= 2 ? GOOD.fg : (v.x ?? 1) < 0.7 ? T.neg : T.ink }}>{v.x == null ? '–' : `${r1(v.x)}×`}{v.early ? <span style={{ color: T.faint, fontWeight: 400 }}> early</span> : null}</td>
            <td className={num} style={mono}>{fmtInt(v.v)}<span className="block text-[12px]" style={{ color: T.muted }}>median {fmtInt(c?.median)}</span></td>
            <td className={num} style={mono}>{showAge ? ageDays(v.p, s.fetchedAt) : v.m}</td><td className={num} style={mono}>{v.ch || '–'}</td>
            <td className={num}>{o ? <b style={mono}>{fmtInt(o.m.ws)} ws</b> : <span className="text-[12px]" style={{ color: T.faint }}>no Clay link</span>}</td>
            <td className="px-3 py-2">{v.early ? <Badge tone={NEW}>Too new</Badge> : <Badge tone={resultTone(r)}>{RESULT_LABEL[r]}</Badge>}</td>
          </tr>)
      })}</tbody>
    </table></div>
  )
}

// ── 1. Make these next ─────────────────────────────────────────────────────────
function Trend({ stat }: { stat: Rec['stat'] }) {
  const r = stat.recentN >= 5 ? stat.recentHits / stat.recentN : null, p = stat.priorN >= 5 ? stat.priorHits / stat.priorN : null
  if (r == null || p == null) return <span style={{ color: T.faint }}>–</span>
  const d = r - p
  const [label, color] = d > 0.05 ? ['▲ Rising', GOOD.fg] : d < -0.05 ? ['▼ Cooling', T.neg] : ['Steady', T.muted]
  return <span className="flex flex-col whitespace-nowrap"><span style={{ color, fontWeight: 600 }}>{label}</span><span className="text-[12px]" style={{ ...mono, color: T.muted }}>{fmtPct(p, 0)} → {fmtPct(r, 0)} at 3×+</span></span>
}

/** Column template shared by the header and every row (md+); on phones a row stacks. */
const IDEA_COLS = 'md:grid md:grid-cols-[32px_minmax(0,2.4fr)_minmax(0,1.3fr)_150px_150px_140px_20px] md:gap-4 md:items-start'

function MakeNext({ d, thumbs, expanded, setExpanded, open, onDownload }: { d: CreatorsData; thumbs: Record<string, string>; expanded: string | null; setExpanded: (k: string | null) => void; open: Open; onDownload?: (f: string, t: string) => Promise<void> }) {
  if (!d.recs.length) return (
    <Section id="ci-next" eyebrow="Make these next" title="No niche scan yet">
      <p className="text-[15px]" style={{ color: T.muted }}>Recommendations come from the weekly niche scan (scripts/niche-scan.mjs, then niche-analyze.mjs → youtube/scan).</p>
    </Section>
  )
  const s = d.scan!
  const fresh = d.recs.filter(r => r.status === 'new').length
  const tip = (label: string, body: React.ReactNode) => <InfoTip label={`About ${label}`}>{body}</InfoTip>
  return (
    <Section id="ci-next" eyebrow={`Make these next · scan of ${s.fetchedAt.slice(0, 10)}`} title={`${d.recs.length} videos to make next`}
      sub={<>One idea per topic. Ranked on how far the niche’s copies beat their own channel, then <b style={{ color: T.ink }}>signups</b> where our creators have made it. Click a row to see everything behind it.</>}>
      <Card className="p-0">
        <div className={`hidden ${IDEA_COLS} px-5 sm:px-8 py-3 whitespace-nowrap`} style={{ ...head, fontFamily: 'inherit' }}>
          <span className="text-[12px] uppercase" style={mono}>#</span>
          <span className="text-[12px] uppercase" style={mono}>Working title</span>
          <span className="text-[12px] uppercase" style={mono}>Topic</span>
          <span className="text-[12px] uppercase inline-flex items-center gap-1 justify-end"><span style={mono}>Views vs median</span>{tip('views vs median', <Def d="The median copy’s views against its channel’s median long-form video, and the top copy’s. Other creators’ videos carry no Clay link, so views are the only evidence for them." />)}</span>
          <span className="text-[12px] uppercase inline-flex items-center gap-1 justify-end"><span style={mono}>Our signups</span>{tip('our signups', <Def d="New workspaces from our creators’ videos on this topic (first touch on the video’s own link), and how many of the judged ones worked. “Theme” when none name the topic’s tool." src="FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION × MARKETING_WEBSITE_SESSIONS" />)}</span>
          <span className="text-[12px] uppercase inline-flex items-center gap-1"><span style={mono}>Trend</span>{tip('trend', <Def d="The theme’s share of videos at 3×+ their channel: the year before against the last 90 days." />)}</span>
          <span />
        </div>
        {d.recs.map(r => {
          const p = r.proof, on = expanded === r.key
          return (
            <div key={r.key} id={`idea-${r.key}`} className="scroll-mt-40" style={{ borderTop: `1px solid ${T.border}` }}>
              <button type="button" aria-expanded={on} onClick={() => setExpanded(on ? null : r.key)}
                className={`w-full text-left flex flex-col gap-2 ${IDEA_COLS} px-5 sm:px-8 py-4 hover:bg-[#F6F5F1]`} style={{ background: on ? T.tile : undefined }}>
                <span className="hidden md:block text-[18px]" style={{ ...mono, color: T.faint }}>{r.rank}</span>
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="font-semibold leading-snug"><span className="md:hidden" style={{ ...mono, color: T.faint }}>{r.rank}. </span>{r.title}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: T.muted }}>
                    {(r.formatLabel || r.assistant) && <span>Sell it as: {[r.formatLabel, r.assistant ? `name ${assistantLabel(r.assistant)}` : null].filter(Boolean).join(' · ')}</span>}
                    {r.status === 'new' && <Badge tone={NEW}>New</Badge>}{!r.written && <Badge tone={MID}>Draft</Badge>}
                  </span>
                </span>
                <span className="text-[14px] leading-snug" style={{ color: T.ink }}>{r.label}</span>
                <span className="flex md:flex-col md:items-end gap-2 md:gap-0 whitespace-nowrap"><b style={mono}>{p.med == null ? '–' : `${r1(p.med)}×`}</b><span className="text-[12px]" style={{ ...mono, color: T.muted }}>top {p.top == null ? '–' : `${r1(p.top)}×`} · {p.channels} ch.</span></span>
                {r.ours.length
                  ? <span className="flex md:flex-col md:items-end gap-2 md:gap-0"><b style={mono}>{fmtInt(p.ws)} ws</b><span className="text-[12px]" style={{ color: T.muted }}>{p.judged ? `${p.oursWorked} of ${p.judged} worked` : 'none judged yet'}{r.oursScope === 'theme' ? ' · theme' : ''}</span></span>
                  : <span className="flex md:flex-col md:items-end gap-2 md:gap-0"><span style={{ color: T.muted }}>No data</span><span className="text-[12px]" style={{ color: T.faint }}>not made by us yet</span></span>}
                <Trend stat={r.stat} />
                <span className="hidden md:block text-right text-[18px]" style={{ color: T.faint, transform: on ? 'rotate(90deg)' : undefined, transition: 'transform 150ms' }}>›</span>
              </button>
              {on && <div className="px-5 sm:px-8 pb-8 pt-2 flex flex-col gap-8" style={{ background: T.tile }}>
                <IdeaDetail r={r} d={d} thumbs={thumbs} open={open} onDownload={onDownload} />
              </div>}
            </div>
          )
        })}
      </Card>
      <p className="text-[13px] px-1" style={{ color: T.muted }}>
        {s.prevFetchedAt ? `${fresh} new since the scan of ${s.prevFetchedAt.slice(0, 10)}. ` : ''}
        {d.dropped.length > 0 ? `Off the list since then: ${d.dropped.join(', ')}. ` : ''}A topic makes the list with {REC.topicMinCopies}+ copies on {REC.topicMinChannels}+ channels and a hit rate {Math.round(REC.topicMinEdge * 100)}+ points above the niche’s; at most {REC.perTheme} per theme.
      </p>
    </Section>
  )
}

function IdeaDetail({ r, d, thumbs, open, onDownload }: { r: Rec; d: CreatorsData; thumbs: Record<string, string>; open: Open; onDownload?: (f: string, t: string) => Promise<void> }) {
  const s = d.scan!
  const [copied, setCopied] = useState<string | null>(null)
  const md = () => briefMarkdown(r, d)
  const file = `video-brief-${r.rank}-${r.key.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}.md`
  const copy = async () => { try { await navigator.clipboard.writeText(md()); setCopied('Copied') } catch { setCopied('Copy failed: use Download') } }
  const b = r.brief
  const rows: [string, React.ReactNode][] = [
    ['Title', <b key="t">{b.title}</b>], ['Use case', b.useCase], ['Offer', b.offer], ['CTA', b.cta],
    ...(b.thumbnail ? [['Thumbnail', b.thumbnail] as [string, React.ReactNode]] : []), ...(b.structure ? [['Structure', b.structure] as [string, React.ReactNode]] : []),
    ['Related resources', <span key="r" className="flex flex-col gap-0.5">{b.resources.map(x => x.url
      ? <a key={x.label} href={x.url} target="_blank" rel="noreferrer" className="underline">{x.label}</a> : <span key={x.label}>{x.label}</span>)}</span>],
  ]
  const lift = (x: Sep) => { const w = x.w / x.wn, f = x.f / x.fn; return f ? w / f : null }
  return <>
    {r.angle && <p className="text-[15px] max-w-[860px]" style={{ color: T.muted }}>{r.angle}</p>}

    {/* 1. Views vs channel median: the niche copies it's modeled on */}
    <div className="flex flex-col gap-2">
      <H2>Views vs their channel’s median</H2>
      <p className="text-[13px]" style={{ color: T.muted }}>{r.proof.worked} of {fmtInt(r.proof.n)} copies on this topic got 2×+ their channel’s usual views (niche {fmtPct(r.proof.nicheRate, 0)}), on {r.proof.channels} channels; the median copy {r.proof.med == null ? '–' : `${r1(r.proof.med)}×`}. These are other creators’ videos: no Clay link, so no signups to show.</p>
      <div className="flex flex-col gap-1">{r.examples.map(v => <NicheRow key={v.id} v={v} s={s} thumbs={thumbs} open={open} />)}</div>
    </div>

    {/* 2. Our creators on this topic */}
    <div className="flex flex-col gap-2">
      <H2>Our creators on this {r.oursScope}</H2>
      {r.ours.length ? <>
        <p className="text-[13px]" style={{ color: T.muted }}>{fmtInt(r.proof.ws)} new workspaces{r.proof.judged ? `; ${r.proof.oursWorked} of ${r.proof.judged} judged videos worked` : ''}{r.proof.bestPerK != null ? `; best ${r1(r.proof.bestPerK)} per 1K views` : ''}.{r.oursScope === 'theme' ? ' None of our videos name this topic’s tool, so these are the theme’s.' : ''}</p>
        <div className="flex flex-col gap-1">{r.ours.map(v => (
          <button type="button" key={v.key} onClick={() => open({ k: 'ours', key: v.key })} className="flex items-center gap-3 text-[14px] text-left rounded-xl p-2 -mx-2 hover:bg-[#ECEAE4]">
            <span className="hidden sm:block"><Thumb vid={v.vid} thumbs={thumbs} w={72} /></span>
            <span className="flex-1 min-w-0"><span className="line-clamp-2 sm:line-clamp-1 font-medium">{v.title}</span><span className="text-[13px]" style={{ color: T.muted }}>{v.creator} · {v.placement} · {fmtInt(v.views)} views</span></span>
            <span className="text-right whitespace-nowrap" style={mono}><b>{fmtInt(v.m.ws)}</b> ws<span className="block text-[12px]" style={{ color: T.muted }}>{v.perK == null ? 'shared link' : `${r1(v.perK)} per 1K`}</span></span>
            <Badge tone={resultTone(v.result)}>{RESULT_LABEL[v.result]}</Badge>
          </button>))}</div>
      </> : <p className="text-[14px]" style={{ color: T.muted }}>None of our creators has made this yet, so there’s no signup data: this video doubles as the test.</p>}
    </div>

    {/* 3. The brief */}
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><H2>The brief</H2>
        <span className="ml-auto flex flex-wrap gap-2">
          {onDownload && <button type="button" onClick={() => onDownload(file, md())} className="rounded-full px-4 py-2 text-[13px] font-medium" style={{ background: T.ink, color: '#fff' }}>Download full brief (.md)</button>}
          <button type="button" onClick={copy} className="rounded-full px-4 py-2 text-[13px] font-medium" style={{ border: `1px solid ${T.border}`, background: '#fff' }}>{copied ?? 'Copy for an agent'}</button>
        </span></div>
      <Card className="p-5"><dl className="grid grid-cols-[96px_1fr] sm:grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-[14px]">
        {rows.map(([k, v]) => <Fragment key={k}><dt style={{ color: T.muted }}>{k}</dt><dd>{v}</dd></Fragment>)}
      </dl></Card>
    </div>

    {/* 4. How it's been sold: the topic's winners vs losers, condensed */}
    {r.seps.length > 0 && <div className="flex flex-col gap-2">
      <H2>How it’s been sold</H2>
      <p className="text-[13px]" style={{ color: T.muted }}>The {r.topic?.traits?.length ? 'topic’s' : 'theme’s'} copies that worked (2×+ their channel) against the ones that failed (under 0.7×): how often each has the trait.</p>
      <Card className="p-5"><div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 480 }}>
        <thead><tr style={head}><th className={`${th} text-left pl-0`}>What we see</th><th className={`${th} text-right`}>Worked ({r.seps[0].wn})</th><th className={`${th} text-right`}>Failed ({r.seps[0].fn})</th><th className={`${th} text-right`}>Read</th></tr></thead>
        <tbody>{r.seps.map(x => { const w = x.w / x.wn, f = x.f / x.fn, l = lift(x); return (
          <tr key={x.label} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3">{x.label}</td>
            <td className={num} style={{ ...mono, color: w > f ? GOOD.fg : T.ink }}>{fmtPct(w, 0)} <span style={{ color: T.faint }}>({x.w})</span></td>
            <td className={num} style={{ ...mono, color: f > w ? T.neg : T.ink }}>{fmtPct(f, 0)} <span style={{ color: T.faint }}>({x.f})</span></td>
            <td className={num} style={{ fontWeight: 600, color: w > f ? GOOD.fg : T.neg }}>{w > f ? (l == null ? 'Only in winners' : `Do it · ${r1(l)}×`) : 'Avoid'}</td></tr>) })}</tbody>
      </table></div></Card>
    </div>}

    {/* 5. Why each decision */}
    <div className="flex flex-col gap-3">
      <H2>Why each decision</H2>
      <ul className="flex flex-col gap-3">{r.reasons.filter(x => x.k !== 'placement').map(x => (
        <li key={x.k} className="flex flex-col gap-0.5 text-[14px] leading-relaxed max-w-[920px]">
          <span className="flex items-center gap-2"><b>{x.label}</b><span className="text-[12px]" style={{ color: T.faint }}>{x.src === 'review' ? 'weekly review' : x.src === 'default' ? 'theme default' : 'from the data'}</span></span>
          <span>{x.why}</span>
        </li>))}</ul>
    </div>
  </>
}

function NicheRow({ v, s, thumbs, open }: { v: SV; s: ScanDoc; thumbs: Record<string, string>; open: Open }) {
  const c = s.channels[v.c], r = svResult(v)
  return (
    <button type="button" onClick={() => open({ k: 'niche', id: v.id })} className="flex items-center gap-3 text-[14px] text-left rounded-xl p-2 -mx-2 hover:bg-[#F1F0EC]">
      <span className="hidden sm:block"><Thumb vid={v.id} thumbs={thumbs} w={72} /></span>
      <span className="flex-1 min-w-0"><span className="line-clamp-2 sm:line-clamp-1 font-medium">{v.t}</span><span className="text-[13px]" style={{ color: T.muted }}>{c?.t ?? '—'}{c?.subs ? ` · ${compact(c.subs)} subs` : ''} · {v.p}</span></span>
      <span className="text-right whitespace-nowrap" style={mono}><b>{v.x == null ? '–' : `${r1(v.x)}×`}</b> <span className="text-[12px]" style={{ color: T.muted }}>median</span><span className="block text-[12px]" style={{ color: T.muted }}>{compact(v.v)} views</span></span>
      {v.early ? <Badge tone={NEW}>Too new</Badge> : <Badge tone={resultTone(r)}>{RESULT_LABEL[r]}</Badge>}
    </button>
  )
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase" style={{ ...mono, letterSpacing: '0.1em', color: T.muted }}>{label}</span>
      <span className="text-[20px] leading-tight" style={mono}>{value}</span>
      {sub && <span className="text-[12px]" style={{ color: T.muted }}>{sub}</span>}
    </div>
  )
}

/** A niche video: public metadata, how it did against its channel and its neighbours, and the ideas it feeds. */
function NicheDetail({ v, s, d, thumbs, open }: { v: SV; s: ScanDoc; d: CreatorsData; thumbs: Record<string, string>; open: Open }) {
  const c = s.channels[v.c], r = svResult(v), age = ageDays(v.p, s.fetchedAt)
  const terms = s.pulse.terms.filter(t => t.vids.includes(v.id)).map(t => t.term)
  const ideas = d.recs.filter(x => x.examples.some(e => e.id === v.id) || (x.theme === v.th && (!x.format || v.f.includes(x.format))))
  return <>
    <div className="flex flex-col sm:flex-row gap-5">
      <Thumb vid={v.id} thumbs={thumbs} w={288} />
      <div className="flex flex-col gap-2 min-w-0">
        <a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="text-[22px] font-bold leading-tight hover:underline" style={{ letterSpacing: '-0.02em' }}>{v.t}</a>
        <p className="text-[14px]" style={{ color: T.muted }}>{c?.t ?? '—'}{c?.subs ? ` · ${compact(c.subs)} subscribers` : ''}{c?.isNew ? ' · channel new this week' : ''} · published {v.p} ({age} days ago)</p>
        <div className="flex flex-wrap gap-1.5">{v.isNew && <Badge tone={NEW}>New this week</Badge>}{v.early ? <Badge tone={NEW}>Too new to judge</Badge> : <Badge tone={resultTone(r)}>{RESULT_LABEL[r]}</Badge>}
          <Badge tone={MID}>{themeLabel(v.th)}</Badge>{v.f.map(f => <Badge key={f} tone={MID}>{formatLabel(f)}</Badge>)}</div>
        <a href={ytUrl(v.id)} target="_blank" rel="noreferrer" className="self-start rounded-full px-4 py-2 text-[13px] font-medium mt-1" style={{ background: T.ink, color: '#fff' }}>Watch on YouTube ↗</a>
      </div>
    </div>
    <Card className="p-5 grid gap-5 grid-cols-2 sm:grid-cols-4">
      <Stat label="Views" value={fmtInt(v.v)} sub={v.early ? 'so far' : undefined} />
      <Stat label="Channel median" value={fmtInt(c?.median)} sub="long-form, newest 5 excluded" />
      <Stat label="× channel" value={v.x == null ? '–' : `${r1(v.x)}×`} sub={v.early ? 'early: can only go up' : 'worked at 2×+, failed under 0.7×'} />
      <Stat label="× neighbours" value={v.nb == null ? '–' : `${r1(v.nb)}×`} sub="vs the 30 uploads around it" />
      <Stat label="Length" value={`${v.m} min`} />
      <Stat label="Chapters" value={v.ch || '–'} />
      <Stat label="Likes" value={v.l == null ? '–' : fmtInt(v.l)} sub={v.l != null && v.v ? `${fmtPct(v.l / v.v, 1)} of views` : undefined} />
      <Stat label="Comments" value={v.cm == null ? '–' : fmtInt(v.cm)} sub={v.cm != null && v.v ? `${r1((1000 * v.cm) / v.v)} per 1K views` : undefined} />
    </Card>
    <p className="text-[13px]" style={{ color: T.muted }}>Public data from the YouTube Data API. Impressions, click-through and watch time are only visible to the channel owner, so they’re on the Media properties tab for our own channels only; this video’s signups can’t be seen either, since it doesn’t carry our link.</p>
    {(terms.length > 0 || ideas.length > 0) && <div className="flex flex-col gap-2">
      <H2>Why it matters</H2>
      {terms.length > 0 && <p className="text-[14px]">Its title uses rising terms: <b>{terms.join(', ')}</b>.</p>}
      {ideas.length > 0 && <div className="flex flex-col gap-1.5">{ideas.slice(0, 4).map(x => (
        <button key={x.key} type="button" onClick={() => open({ k: 'idea', key: x.key })} className="text-left text-[14px] hover:underline">Feeds idea #{x.rank}: <b>{x.title}</b> →</button>))}</div>}
    </div>}
  </>
}

/** One of our program videos: reach, the signups its link drove, and the weekly trend. */
function OursDetail({ v, thumbs }: { v: VideoRow; thumbs: Record<string, string> }) {
  return <>
    <div className="flex flex-col sm:flex-row gap-5">
      <Thumb vid={v.vid} thumbs={thumbs} w={288} />
      <div className="flex flex-col gap-2 min-w-0">
        {v.url && !v.group ? <a href={v.url} target="_blank" rel="noreferrer" className="text-[22px] font-bold leading-tight hover:underline">{v.title}</a> : <p className="text-[22px] font-bold leading-tight">{v.title}</p>}
        <p className="text-[14px]" style={{ color: T.muted }}>{v.creator}{v.fit ? ` · ${v.fit}` : ''}{v.subs ? ` · ${compact(v.subs)} subscribers` : ''}{v.live ? ` · live ${v.live}` : ''}{v.agency ? ` · via ${v.agency}` : ''}</p>
        <div className="flex flex-wrap gap-1.5">{v.young ? <Badge tone={NEW}>Too new</Badge> : v.attribution === 'direct' ? <Badge tone={resultTone(v.result)}>{RESULT_LABEL[v.result]}</Badge> : <Badge tone={MID}>{ATTRIBUTION[v.attribution]}</Badge>}
          <Badge tone={MID}>{themeLabel(v.theme)}</Badge><Badge tone={MID}>{v.placement}</Badge></div>
        {v.group && <p className="text-[13px]" style={{ color: T.muted }}>On this link: {v.group.titles.join(' · ')}</p>}
      </div>
    </div>
    <Card className="p-5 grid gap-5 grid-cols-2 sm:grid-cols-4">
      <Stat label="Views" value={fmtInt(v.views)} />
      <Stat label="× channel median" value={v.multiple == null ? '–' : `${r1(v.multiple)}×`} sub={v.median ? `median ${fmtInt(v.median)}` : undefined} />
      <Stat label="Visitors" value={fmtInt(v.m.vis)} sub="clay.com, from the link" />
      <Stat label="New workspaces" value={fmtInt(v.m.ws)} sub="first touch on the link" />
      <Stat label="Per 1K views" value={r1(v.perK)} sub={v.perK == null ? 'shared or no own link' : 'worked at 1+, failed under 0.25'} />
      <Stat label="Tier 1–3" value={fmtInt(v.m.t13)} />
      <Stat label="Activated in 7 days" value={v.m.mat ? fmtPct(v.m.act / v.m.mat, 0) : '–'} sub={v.m.mat ? `of ${fmtInt(v.m.mat)} matured` : undefined} />
      <Stat label="Paid" value={fmtInt(v.m.paid)} />
      <Stat label="Length" value={v.mins == null ? '–' : `${Math.round(v.mins)} min`} />
      <Stat label="Chapters" value={v.chapters ?? '–'} />
      <Stat label="Clay link" value={v.clayLine == null ? 'missing' : `line ${v.clayLine}`} sub="of the description" />
      <Stat label="Rewardful signups" value={fmtInt(v.rw.signups)} sub="program sheet" />
    </Card>
    {v.spark.length > 1 && <div className="flex flex-col gap-2"><Eyebrow>New workspaces per week since it went live</Eyebrow><Spark xs={v.spark} w={560} h={80} /></div>}
  </>
}

// ── 3. This week ───────────────────────────────────────────────────────────────
function ThisWeek({ s, d, open }: { s: ScanDoc; d: CreatorsData; open: Open }) {
  const vid = new Map(s.videos.map(v => [v.id, v]))
  const fresh = s.pulse.newVideos.map(i => vid.get(i)).filter((v): v is SV => !!v)
  const hot = fresh.filter(v => (v.x ?? 0) >= 1.5)
  const moving = s.themes.filter(t => t.recentN >= 10 && t.priorN >= 10).map(t => ({ t, r: t.recentHits / t.recentN, p: t.priorHits / t.priorN }))
    .map(x => ({ ...x, d: x.r - x.p })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6)
  const since = s.prevFetchedAt ? `since the last scan (${s.prevFetchedAt.slice(0, 10)})` : `in the last ${SCAN.newDays} days (first scan)`
  const [more, setMore] = useState(false)
  return (
    <Section id="ci-week" eyebrow="Pulse" title="New this week"
      sub={`Videos first seen ${since} on the ${s.pool.channels} tracked channels, title terms rising against the past year, and themes gaining or losing hits. Early multiples are views so far against the channel’s median, so they can only go up. Signups show only for our creators’ videos; the rest carry no Clay link. Click a video for its details.`}>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {[[s.pulse.newTotal ?? fresh.length, 'new videos', `${s.pulse.earlyHits ?? hot.length} already at 1.5×+ their channel`], [s.pulse.newChannels.length, 'new channels', 'found by this week’s searches'], [s.pulse.terms.length, 'rising terms', 'at least 2× their share of last year’s titles']].map(([v, l, sub]) => (
          <div key={String(l)} className="rounded-[22px] p-5 flex flex-col gap-1" style={{ background: T.tile }}>
            <span className="text-[34px] leading-none" style={mono}>{fmtInt(Number(v))}</span><span className="text-[15px] font-medium">{l}</span><span className="text-[13px]" style={{ color: T.muted }}>{sub}</span>
          </div>))}
      </div>
      <div className="flex flex-col gap-6">
        <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
          <H2>Breaking out early</H2>
          <p className="text-[14px]" style={{ color: T.muted }}>New videos ranked by their early multiple. Next week they’re judged like the rest.</p>
          {fresh.length ? <NicheTable rows={fresh.slice(0, more ? 40 : 15)} s={s} d={d} showTheme showAge open={open} /> : <p className="text-[14px]" style={{ color: T.muted }}>No new videos in this scan.</p>}
          {fresh.length > 15 && <button type="button" onClick={() => setMore(x => !x)} className="self-start text-[14px] underline">{more ? 'Show top 15' : `Show ${Math.min(40, fresh.length) - 15} more`}</button>}
        </Card>
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3 min-w-0">
          <Card className="p-5 sm:p-8 flex flex-col gap-3">
            <H2>Rising terms</H2>
            {s.pulse.terms.length ? <ul className="flex flex-col gap-3">{s.pulse.terms.slice(0, 8).map(t => (
              <li key={t.term} className="flex flex-col gap-0.5">
                <span className="flex items-baseline gap-2"><b className="text-[15px]">{t.term}</b><span className="text-[13px]" style={{ ...mono, color: T.muted }}>{t.now} new · {t.base} last year · {r1(t.lift)}×</span></span>
                <span className="text-[13px] flex flex-wrap gap-x-2" style={{ color: T.muted }}>{t.vids.map(i => vid.get(i)).filter((x): x is SV => !!x).map(x => (
                  <button key={x.id} type="button" onClick={() => open({ k: 'niche', id: x.id })} className="hover:underline text-left line-clamp-1 max-w-full">{x.t}</button>))}</span>
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
      {d.recs.some(r => r.status === 'new') && <p className="text-[13px]" style={{ color: T.muted }}>New ideas this week: {d.recs.filter(r => r.status === 'new').map(r => `#${r.rank}`).join(', ')}.</p>}
    </Section>
  )
}

// ── 4. Videos explorer ─────────────────────────────────────────────────────────
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

function Spark({ xs, w = 72, h = 20 }: { xs: number[]; w?: number; h?: number }) {
  if (xs.length < 2) return <span style={{ color: T.faint }}>–</span>
  const max = Math.max(1, ...xs)
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: '100%' }} aria-hidden><polyline points={xs.map((x, i) => `${(i / (xs.length - 1)) * w},${h - (x / max) * h}`).join(' ')} fill="none" stroke={T.pos} strokeWidth="1.5" /></svg>
}

type When = 'week' | '90d' | 'all'
const WHEN: { id: When; label: string; days: number | null }[] = [{ id: 'week', label: 'New this week', days: SCAN.newDays }, { id: '90d', label: 'Last 90 days', days: 90 }, { id: 'all', label: 'All time', days: null }]

function Explorer({ d, thumbs, open }: { d: CreatorsData; thumbs: Record<string, string>; open: Open }) {
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
        {niche.length ? <NicheTable rows={niche.slice(0, all ? 200 : 20)} s={s} d={d} showTheme open={open} /> : <p className="text-[14px]" style={{ color: T.muted }}>No scan videos for this slice.</p>}
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
              <tr key={v.key} onClick={() => open({ k: 'ours', key: v.key })} className="cursor-pointer hover:bg-[#F6F5F1]" style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5 pl-5 sm:pl-8">
                  <div className="flex items-center gap-3 min-w-[300px]">
                    <Thumb vid={v.vid} thumbs={thumbs} />
                    <span className="flex flex-col min-w-0">
                      {v.url && !v.group ? <a href={v.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="font-medium leading-snug hover:underline line-clamp-2">{v.title}</a>
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

// ── 5. Themes ──────────────────────────────────────────────────────────────────
function Themes({ d, thumbs, open }: { d: CreatorsData; thumbs: Record<string, string>; open: Open }) {
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
              <tr key={v.key} onClick={() => open({ k: 'ours', key: v.key })} className="cursor-pointer hover:bg-[#F6F5F1]" style={{ borderBottom: `1px solid ${T.border}` }}>
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

// ── 6. Winners vs losers ───────────────────────────────────────────────────────
function WinnersLosers({ d }: { d: CreatorsData }) {
  const s = d.scan
  // By lift (share of winners over share of losers), the clearest read of what a trait is worth.
  const traits = [...(s?.traits ?? [])].sort((a, b) => (b.w / b.wn) / Math.max(1e-9, b.f / b.fn) - (a.w / a.wn) / Math.max(1e-9, a.f / a.fn))
  const fmts = s ? [...s.formats].filter(f => f.n >= 20).sort((a, b) => b.hits / b.n - a.hits / a.n) : []
  const vid = new Map((s?.videos ?? []).map(v => [v.id, v]))
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
      {s && (traits.length > 0 || fmts.length > 0) && <div className="grid gap-6 grid-cols-1 xl:grid-cols-2">
        {traits.length > 0 && <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
          <H2>In the niche: what winners have that losers don’t</H2>
          <p className="text-[14px]" style={{ color: T.muted }}>Every scored video: {fmtInt(traits[0].wn)} that got 2×+ their channel’s median views against {fmtInt(traits[0].fn)} under 0.7×. Views only (no Clay links). Sorted by lift: how much more often winners have the trait.</p>
          <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 460 }}>
            <thead><tr style={head}><th className={`${th} text-left pl-0`}>Trait</th><th className={`${th} text-right`}>Of winners</th><th className={`${th} text-right`}>Of losers</th><th className={`${th} text-right`}>Lift</th></tr></thead>
            <tbody>{traits.map(x => { const w = x.w / x.wn, f = x.f / x.fn, lift = f ? w / f : null; return (
              <tr key={x.label} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3">{x.label}</td>
                <td className={num} style={{ ...mono, color: w > f ? GOOD.fg : T.ink }}>{fmtPct(w, 0)}</td><td className={num} style={{ ...mono, color: f > w ? T.neg : T.ink }}>{fmtPct(f, 0)}</td>
                <td className={num} style={{ ...mono, fontWeight: 600, color: lift == null ? T.faint : lift >= 1.2 ? GOOD.fg : lift <= 0.8 ? T.neg : T.ink }}>{lift == null ? '–' : `${r1(lift)}×`}</td></tr>) })}</tbody>
          </table></div>
        </Card>}
        {fmts.length > 0 && <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
          <H2>Title formats</H2>
          <p className="text-[14px]" style={{ color: T.muted }}>Share of each format’s videos at 3×+ their channel (base rate {fmtPct(s.pool.baseRate, 0)}), with its best copy.</p>
          <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 520 }}>
            <thead><tr style={head}><th className={`${th} text-left pl-0`}>Format</th><th className={`${th} text-right`}>Hit rate</th><th className={`${th} text-left`}>Best copy</th></tr></thead>
            <tbody>{fmts.map(f => { const b = vid.get(f.best[0]); return (
              <tr key={f.id} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3 font-medium">{formatLabel(f.id as FormatId)}</td>
                <td className={num} style={{ ...mono, color: f.hits / f.n >= s.pool.baseRate ? GOOD.fg : T.neg }}>{fmtPct(f.hits / f.n, 0)} <span style={{ color: T.faint }}>of {fmtInt(f.n)}</span></td>
                <td className="px-3 py-2 text-[13px]">{b ? <>{b.t} <span style={{ ...mono, color: T.muted }}>{r1(b.x)}×</span></> : '–'}</td></tr>) })}</tbody>
          </table></div>
        </Card>}
      </div>}
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
