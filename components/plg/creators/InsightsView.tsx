'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { ATTRIBUTION, REC, RESULT, r1, type CreatorsData, type Rec, type Result, type ThemeRow, type VideoRow } from '@/lib/plg/creators/compute'
import { briefMarkdown } from '@/lib/plg/creators/brief'
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
  { id: 'ci-next', label: 'Make next' }, { id: 'ci-learn', label: 'What we’re learning' }, { id: 'ci-week', label: 'This week' },
  { id: 'ci-top', label: 'Videos' }, { id: 'ci-data', label: 'Program data' },
]
/** What the side panel shows: an idea, a niche video or one of our videos. */
type Sel = { k: 'idea'; key: string } | { k: 'niche'; id: string } | { k: 'ours'; key: string } | null
type Open = (s: Sel) => void
/** An idea's own link: #insights-idea=<theme:format> (the dashboard routes #insights* to this tab). */
const HASH = 'insights-idea='

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
  const [sel, setSel] = useState<Sel>(() => {
    try { const h = decodeURIComponent(window.location.hash.slice(1)); return h.startsWith(HASH) ? { k: 'idea', key: h.slice(HASH.length) } : null } catch { return null }
  })
  const open: Open = x => {
    setSel(x)
    try { history.replaceState(null, '', x?.k === 'idea' ? `#${HASH}${encodeURIComponent(x.key)}` : '#insights') } catch { /* sandboxed */ }
  }
  const rec = sel?.k === 'idea' ? d.recs.find(r => r.key === sel.key) ?? null : null
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

      <MakeNext d={d} thumbs={thumbs} open={open} />
      <Learnings d={d} />
      {s && <ThisWeek s={s} d={d} thumbs={thumbs} open={open} />}
      <Explorer d={d} thumbs={thumbs} open={open} />
      <ProgramData d={d} />

      <Drawer open={!!(rec || niche || ours)} onClose={() => open(null)}
        title={rec ? `Idea ${rec.rank} of ${d.recs.length}` : niche ? 'Niche video' : 'Our creator’s video'}
        nav={rec ? { prev: d.recs[rec.rank - 2] ? () => open({ k: 'idea', key: d.recs[rec.rank - 2].key }) : null, next: d.recs[rec.rank] ? () => open({ k: 'idea', key: d.recs[rec.rank].key }) : null } : undefined}>
        {rec && <IdeaDetail r={rec} d={d} thumbs={thumbs} open={open} onDownload={onDownload} />}
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

/** Niche videos as a table: title, channel, views, median, multiple, minutes, chapters, result. */
function NicheTable({ rows, s, showTheme, showAge, open }: { rows: SV[]; s: ScanDoc; showTheme?: boolean; showAge?: boolean; open: Open }) {
  return (
    <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 760 }}>
      <thead><tr style={head}>
        <th className={`${th} text-left pl-0`}>Video</th><th className={`${th} text-right`}>Views</th><th className={`${th} text-right`}>Channel median</th>
        <th className={`${th} text-right`}>Multiple</th><th className={`${th} text-right`}>{showAge ? 'Age (days)' : 'Minutes'}</th><th className={`${th} text-right`}>Chapters</th><th className={`${th} text-left`}>Result</th>
      </tr></thead>
      <tbody>{rows.map(v => {
        const c = s.channels[v.c], r = svResult(v)
        return (
          <tr key={v.id} onClick={() => open({ k: 'niche', id: v.id })} className="cursor-pointer hover:bg-[#F6F5F1]" style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="py-2 pr-3"><span className="font-medium">{v.t}</span>
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
function MakeNext({ d, thumbs, open }: { d: CreatorsData; thumbs: Record<string, string>; open: Open }) {
  if (!d.recs.length) return (
    <Section id="ci-next" eyebrow="Make these next" title="No niche scan yet">
      <p className="text-[15px]" style={{ color: T.muted }}>Recommendations come from the weekly niche scan (scripts/niche-scan.mjs, then niche-analyze.mjs → youtube/scan).</p>
    </Section>
  )
  const fresh = d.recs.filter(r => r.status === 'new').length
  return (
    <Section id="ci-next" eyebrow={`Make these next · scan of ${d.scan!.fetchedAt.slice(0, 10)}`} title={`${d.recs.length} videos to make next`}
      sub={<>Each idea is a theme sold through one title format, worked back from the niche’s copies that beat their channel and the ones that didn’t, then weighted by <b style={{ color: T.ink }}>signup proof</b> from our creators, how naturally Clay fits and whether the theme is rising. Click one for its sources, the brief and why.</>}>
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full text-[14px]" style={{ minWidth: 980 }}>
          <thead><tr style={head}>
            <th className={`${th} text-left pl-5 sm:pl-8 w-10`}>#</th><th className={`${th} text-left`}>Video to make</th>
            <th className={`${th} text-right`}><span className="inline-flex items-center gap-1">Watch proof<InfoTip label="About watch proof"><Def d="Niche copies on this theme and title format: how many beat their own channel’s median 2×+ (worked) or stayed under 0.7× (failed), and on how many channels." /></InfoTip></span></th>
            <th className={`${th} text-right`}><span className="inline-flex items-center gap-1">Signup proof<InfoTip label="About signup proof"><Def d="Our creators’ videos on the theme: new workspaces they drove (first touch on the video’s link) and whether they converted." /></InfoTip></span></th>
            <th className={`${th} text-left`}>Lands on</th><th className={`${th} text-left pr-5 sm:pr-8`}> </th>
          </tr></thead>
          <tbody>{d.recs.map(r => {
            const t = r.themeRow
            return (
              <tr key={r.key} onClick={() => open({ k: 'idea', key: r.key })} className="cursor-pointer hover:bg-[#F6F5F1]" style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="py-3 pl-5 sm:pl-8 align-top text-[18px]" style={{ ...mono, color: T.faint }}>{r.rank}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3 min-w-[340px]">
                    <Thumb vid={r.examples[0]?.id ?? null} thumbs={thumbs} w={80} />
                    <span className="flex flex-col gap-1 min-w-0">
                      <button type="button" className="text-left font-semibold leading-snug hover:underline line-clamp-2" onClick={e => { e.stopPropagation(); open({ k: 'idea', key: r.key }) }}>{r.title}</button>
                      <span className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: T.muted }}>
                        <span>{r.label}{r.angleLabel ? ` · ${r.angleLabel}` : ''}</span>
                        {r.status === 'new' && <Badge tone={NEW}>New this week</Badge>}
                        {!r.written && <Badge tone={MID}>Draft</Badge>}
                      </span>
                    </span>
                  </div>
                </td>
                <td className={num}><span className="flex flex-col items-end"><span style={mono}><b style={{ color: GOOD.fg }}>{r.proof.worked}</b> · <span style={{ color: T.neg }}>{r.proof.failed}</span></span>
                  <span className="text-[12px]" style={{ color: T.muted }}>{fmtPct(r.proof.rate, 0)} worked · {r.proof.channels} ch.</span></span></td>
                <td className={num}><span className="flex flex-col items-end gap-1"><span style={mono}>{t?.ws ? `${fmtInt(t.ws)} ws` : '–'}</span><Badge tone={signupTone(t)}>{SIGNUP_LABEL[t?.signup ?? 'untested']}</Badge></span></td>
                <td className="px-3 py-3 text-[13px]" style={{ color: T.muted }}>{r.brief.landing}</td>
                <td className="px-3 py-3 pr-5 sm:pr-8 text-right" style={{ color: T.faint }}>→</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </Card>
      <p className="text-[13px] px-1" style={{ color: T.muted }}>
        {d.scan!.prevFetchedAt ? `${fresh} new since the scan of ${d.scan!.prevFetchedAt.slice(0, 10)}. ` : ''}
        {d.dropped.length > 0 ? `Off the list since then: ${d.dropped.join(', ')}. ` : ''}At most {REC.perTheme} ideas per theme and {REC.perFormat} per title format.
      </p>
    </Section>
  )
}

function IdeaDetail({ r, d, thumbs, open, onDownload }: { r: Rec; d: CreatorsData; thumbs: Record<string, string>; open: Open; onDownload?: (f: string, t: string) => Promise<void> }) {
  const s = d.scan!
  const t = r.themeRow
  const [copied, setCopied] = useState<string | null>(null)
  const md = () => briefMarkdown(r, d)
  const file = `video-brief-${r.rank}-${r.key.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}.md`
  const copy = async () => { try { await navigator.clipboard.writeText(md()); setCopied('Copied') } catch { setCopied('Copy failed: use Download') } }
  const b = r.brief
  const rows: [string, React.ReactNode][] = [
    ['Title', <b key="t">{b.title}</b>], ['Use case', b.useCase],
    ['Landing page', b.landingUrl ? <a key="l" href={b.landingUrl} target="_blank" rel="noreferrer" className="underline">{b.landing}</a> : b.landing],
    ['Offer', b.offer], ['CTA', b.cta], ['Copy', b.copy], ['Placement', b.placement],
    ...(b.thumbnail ? [['Thumbnail', b.thumbnail] as [string, React.ReactNode]] : []), ...(b.structure ? [['Structure', b.structure] as [string, React.ReactNode]] : []),
  ]
  return <>
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2"><Eyebrow>{r.label}{r.angleLabel ? ` · ${r.angleLabel}` : ''}</Eyebrow>
        {r.status === 'new' && <Badge tone={NEW}>New this week</Badge>}{r.status === 'still' && <Badge tone={MID}>Still on the list</Badge>}
        {!r.written && <Badge tone={MID}>Draft from the evidence</Badge>}</div>
      <p className="text-[24px] sm:text-[28px] font-bold leading-tight" style={{ letterSpacing: '-0.02em' }}>{r.title}</p>
      {r.angle && <p className="text-[15px]" style={{ color: T.muted }}>{r.angle}</p>}
    </div>

    {/* 1. Sources and their downstream impact */}
    <div className="flex flex-col gap-3">
      <H2>Sourced from</H2>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        {[[`${r.proof.worked} of ${r.proof.n}`, 'niche copies worked', `${fmtPct(r.proof.rate, 0)} vs ${fmtPct(r.proof.nicheRate, 0)} niche-wide`], [String(r.proof.channels), 'channels with a winner', 'not one creator’s series'],
          [t?.ws ? fmtInt(t.ws) : '–', 'workspaces from our videos on the theme', t?.judged ? `${t.worked} of ${t.judged} judged worked` : 'not tested by us yet']].map(([v, l, x]) => (
          <div key={l} className="rounded-2xl p-4 flex flex-col gap-0.5" style={{ background: T.tile }}>
            <span className="text-[24px] leading-none" style={mono}>{v}</span><span className="text-[13px] font-medium">{l}</span><span className="text-[12px]" style={{ color: T.muted }}>{x}</span>
          </div>))}
      </div>
      <Eyebrow>Our creators on this theme · signups</Eyebrow>
      {r.ours.length ? <div className="flex flex-col gap-2">{r.ours.map(v => (
        <button type="button" key={v.key} onClick={() => open({ k: 'ours', key: v.key })} className="flex items-center gap-3 text-[14px] text-left rounded-xl p-2 -mx-2 hover:bg-[#F1F0EC]">
          <span className="hidden sm:block"><Thumb vid={v.vid} thumbs={thumbs} w={72} /></span>
          <span className="flex-1 min-w-0"><span className="line-clamp-2 sm:line-clamp-1 font-medium">{v.title}</span><span className="text-[13px]" style={{ color: T.muted }}>{v.creator} · {v.placement} · {fmtInt(v.views)} views</span></span>
          <span className="text-right whitespace-nowrap" style={mono}><b>{fmtInt(v.m.ws)}</b> ws<span className="block text-[12px]" style={{ color: T.muted }}>{v.perK == null ? 'shared link' : `${r1(v.perK)} per 1K`}</span></span>
          <Badge tone={resultTone(v.result)}>{RESULT_LABEL[v.result]}</Badge>
        </button>))}</div>
        : <p className="text-[14px]" style={{ color: T.muted }}>None of our creators has made this yet, so there’s no signup data: this video doubles as the test.</p>}
      <Eyebrow>Niche copies it’s modeled on · views only, the scan can’t see signups</Eyebrow>
      <div className="flex flex-col gap-2">{r.examples.map(v => <NicheRow key={v.id} v={v} s={s} thumbs={thumbs} open={open} />)}</div>
    </div>

    {/* 2. The brief */}
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2"><H2>The brief</H2>
        <span className="ml-auto flex flex-wrap gap-2">
          {onDownload && <button type="button" onClick={() => onDownload(file, md())} className="rounded-full px-4 py-2 text-[13px] font-medium" style={{ background: T.ink, color: '#fff' }}>Download full brief (.md)</button>}
          <button type="button" onClick={copy} className="rounded-full px-4 py-2 text-[13px] font-medium" style={{ border: `1px solid ${T.border}`, background: '#fff' }}>{copied ?? 'Copy for an agent'}</button>
        </span></div>
      <Card className="p-5"><dl className="grid grid-cols-[84px_1fr] sm:grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 text-[14px]">
        {rows.map(([k, v]) => <Fragment key={k}><dt style={{ color: T.muted }}>{k}</dt><dd>{v}</dd></Fragment>)}
      </dl></Card>
      <p className="text-[13px]" style={{ color: T.muted }}>The full brief has every source with links, the reasons, the separators and how to measure it, written to hand to a person or an agent with no other context.</p>
    </div>

    {/* 3. Why each decision */}
    <div className="flex flex-col gap-3">
      <H2>Why each decision</H2>
      <ul className="flex flex-col gap-3">{r.reasons.map(x => (
        <li key={x.k} className="flex flex-col gap-0.5 text-[14px] leading-relaxed">
          <span className="flex items-center gap-2"><b>{x.label}</b><span className="text-[12px]" style={{ color: T.faint }}>{x.src === 'review' ? 'weekly review' : x.src === 'default' ? 'theme default' : 'from the data'}</span></span>
          <span>{x.why}</span>
        </li>))}</ul>
      <div className="rounded-2xl p-4 flex flex-col gap-1.5 text-[14px]" style={{ background: T.tile }}>
        <Eyebrow>Evidence</Eyebrow>{r.why.map((w, i) => <p key={i}>{w}</p>)}
      </div>
    </div>

    {(r.seps.length > 0 || r.losers.length > 0) && <details className="flex flex-col gap-3">
      <summary className="cursor-pointer select-none text-[15px] font-semibold">What separates the copies that worked, and the ones that failed</summary>
      <div className="flex flex-col gap-3 pt-3">
        {r.seps.length > 0 && <table className="w-full text-[14px]">
          <thead><tr style={head}><th className={`${th} text-left pl-0`}>Trait (theme-wide)</th><th className={`${th} text-right`}>Worked ({r.stat.worked})</th><th className={`${th} text-right`}>Failed ({r.stat.failed})</th></tr></thead>
          <tbody>{r.seps.map(x => {
            const w = x.w / x.wn, f = x.f / x.fn
            return <tr key={x.label} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3">{x.label}</td>
              <td className={num} style={{ ...mono, color: w > f ? GOOD.fg : T.ink }}>{fmtPct(w, 0)} <span style={{ color: T.faint }}>({x.w})</span></td>
              <td className={num} style={{ ...mono, color: f > w ? T.neg : T.ink }}>{fmtPct(f, 0)} <span style={{ color: T.faint }}>({x.f})</span></td></tr>
          })}</tbody></table>}
        {r.losers.length > 0 && <><Eyebrow>Copies that failed</Eyebrow><div className="flex flex-col gap-2">{r.losers.map(v => <NicheRow key={v.id} v={v} s={s} thumbs={thumbs} open={open} />)}</div></>}
        <dl className="grid grid-cols-[110px_1fr] gap-x-4 gap-y-2 text-[14px] pt-2">{r.measure.map(([k, v]) => <Fragment key={k}><dt style={{ color: T.muted }}>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      </div>
    </details>}
  </>
}

function NicheRow({ v, s, thumbs, open }: { v: SV; s: ScanDoc; thumbs: Record<string, string>; open: Open }) {
  const c = s.channels[v.c], r = svResult(v)
  return (
    <button type="button" onClick={() => open({ k: 'niche', id: v.id })} className="flex items-center gap-3 text-[14px] text-left rounded-xl p-2 -mx-2 hover:bg-[#F1F0EC]">
      <span className="hidden sm:block"><Thumb vid={v.id} thumbs={thumbs} w={72} /></span>
      <span className="flex-1 min-w-0"><span className="line-clamp-2 sm:line-clamp-1 font-medium">{v.t}</span><span className="text-[13px]" style={{ color: T.muted }}>{c?.t ?? '—'}{c?.subs ? ` · ${compact(c.subs)} subs` : ''} · {v.p}</span></span>
      <span className="text-right whitespace-nowrap" style={mono}>{compact(v.v)} views<span className="block text-[12px]" style={{ color: T.muted }}>{v.x == null ? '–' : `${r1(v.x)}× channel`}</span></span>
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

// ── 2. What we're learning ─────────────────────────────────────────────────────
function Learnings({ d }: { d: CreatorsData }) {
  const s = d.scan
  const base = s?.pool.baseRate ?? 0
  const rows = [...d.themes].sort((a, b) => (b.worked - b.failed) - (a.worked - a.failed) || (b.demand ? b.demand.hits / b.demand.n : 0) - (a.demand ? a.demand.hits / a.demand.n : 0))
  const fmts = s ? [...s.formats].filter(f => f.n >= 10).sort((a, b) => b.hits / b.n - a.hits / a.n) : []
  const vid = new Map((s?.videos ?? []).map(v => [v.id, v]))
  return (
    <Section id="ci-learn" eyebrow="Synthesis" title="What we’re learning"
      sub="Themes, title formats and our own winners and losers, boiled down to what they say and what to do. The tables behind each are folded underneath.">
      <Card className="p-5 sm:p-8 flex flex-col gap-6">
        <div className="grid gap-x-10 gap-y-7 grid-cols-1 lg:grid-cols-2">
          {d.learnings.map((l, i) => (
            <div key={i} className="flex flex-col gap-2 min-w-0">
              <p className="text-[17px] font-semibold flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: l.tone === 'pos' ? GOOD.fg : l.tone === 'neg' ? T.neg : T.faint }} />{l.head}</p>
              <ul className="flex flex-col gap-1 text-[14px] leading-snug">{l.bullets.map((b, j) => <li key={j} className="flex gap-2"><span style={{ color: T.faint }}>•</span><span className="min-w-0">{b}</span></li>)}</ul>
              <p className="text-[14px] rounded-xl px-3 py-2" style={{ background: T.tile }}><b>So:</b> {l.so}</p>
            </div>))}
        </div>
        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: `1px solid ${T.border}` }}>
          <details>
            <summary className="cursor-pointer select-none text-[14px] font-medium py-2">Theme scorecard: our signups and niche demand, every theme</summary>
            <div className="overflow-x-auto"><table className="w-full text-[14px] mt-2" style={{ minWidth: 900 }}>
              <thead><tr style={head}><th className={`${th} text-left pl-0`}>Theme</th><th className={`${th} text-left`}>Verdict</th><th className={`${th} text-right`}>Ours: worked · failed</th><th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right`}>Median per 1K</th><th className={`${th} text-right`}>Niche hit rate</th><th className={`${th} text-right`}>Clay fit</th></tr></thead>
              <tbody>{rows.map(t => {
                const rate = t.demand ? t.demand.hits / t.demand.n : null
                return <tr key={t.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td className="py-2 pr-3"><span className="font-medium">{t.label}</span><span className="block text-[12px]" style={{ color: T.muted }}>{t.videos.length} of ours</span></td>
                  <td className="px-3 py-2"><Badge tone={t.tone === 'pos' ? GOOD : t.tone === 'neg' ? BAD : MID}>{t.verdict}</Badge></td>
                  <td className={num} style={mono}><span style={{ color: t.worked ? GOOD.fg : T.faint }}>{t.worked}</span> · <span style={{ color: t.failed ? T.neg : T.faint }}>{t.failed}</span></td>
                  <td className={num} style={mono}>{fmtInt(t.ws)}</td><td className={num} style={mono}>{r1(t.median)}</td>
                  <td className={num} style={{ ...mono, color: rate != null && rate < base ? T.neg : T.ink }}>{rate == null ? '–' : `${fmtPct(rate, 0)} of ${fmtInt(t.demand!.n)}`}</td>
                  <td className={num} style={mono}>{clayFit(t.id) >= 1 ? 'High' : clayFit(t.id) >= 0.6 ? 'Medium' : 'Low'}</td></tr>
              })}</tbody></table></div>
          </details>
          {d.factors.length > 0 && <details>
            <summary className="cursor-pointer select-none text-[14px] font-medium py-2">Our winners vs losers, factor by factor ({d.worked.length} worked, {d.failed.length} failed)</summary>
            <table className="w-full text-[14px] mt-2"><tbody>{d.factors.map(f => (
              <tr key={f.factor} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3 font-medium align-top">{f.factor}</td>
                <td className="px-3 py-2 align-top" style={{ color: GOOD.fg }}>{f.worked}</td><td className="px-3 py-2 align-top" style={{ color: T.neg }}>{f.failed}</td></tr>))}</tbody></table>
          </details>}
          {fmts.length > 0 && <details>
            <summary className="cursor-pointer select-none text-[14px] font-medium py-2">Title formats in the niche</summary>
            <div className="overflow-x-auto"><table className="w-full text-[14px] mt-2" style={{ minWidth: 760 }}>
              <thead><tr style={head}><th className={`${th} text-left pl-0`}>Format</th><th className={`${th} text-right`}>Hit rate</th><th className={`${th} text-right`}>Below 0.5×</th><th className={`${th} text-left`}>Best example</th></tr></thead>
              <tbody>{fmts.map(f => { const b = vid.get(f.best[0]); return (
                <tr key={f.id} style={{ borderBottom: `1px solid ${T.border}` }}><td className="py-2 pr-3 font-medium">{formatLabel(f.id as FormatId)}</td>
                  <td className={num} style={{ ...mono, color: f.hits / f.n >= base ? GOOD.fg : T.neg }}>{fmtPct(f.hits / f.n, 0)} <span style={{ color: T.faint }}>of {fmtInt(f.n)}</span></td>
                  <td className={num} style={mono}>{fmtPct(f.below / f.n, 0)}</td>
                  <td className="px-3 py-2">{b ? <>{b.t} <span style={{ ...mono, color: T.muted }}>{r1(b.x)}×</span></> : '–'}</td></tr>) })}</tbody></table></div>
          </details>}
        </div>
      </Card>
    </Section>
  )
}

// ── 3. This week ───────────────────────────────────────────────────────────────
function ThisWeek({ s, d, thumbs, open }: { s: ScanDoc; d: CreatorsData; thumbs: Record<string, string>; open: Open }) {
  const vid = new Map(s.videos.map(v => [v.id, v]))
  const fresh = s.pulse.newVideos.map(i => vid.get(i)).filter((v): v is SV => !!v)
  const hot = fresh.filter(v => (v.x ?? 0) >= 1.5)
  const moving = s.themes.filter(t => t.recentN >= 10 && t.priorN >= 10).map(t => ({ t, r: t.recentHits / t.recentN, p: t.priorHits / t.priorN }))
    .map(x => ({ ...x, d: x.r - x.p })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 6)
  const since = s.prevFetchedAt ? `since the last scan (${s.prevFetchedAt.slice(0, 10)})` : `in the last ${SCAN.newDays} days (first scan)`
  const [more, setMore] = useState(false)
  return (
    <Section id="ci-week" eyebrow="Pulse" title="New this week"
      sub={`Videos first seen ${since} on the ${s.pool.channels} tracked channels, title terms rising against the past year, and themes gaining or losing hits. Early multiples are views so far against the channel’s median, so they can only go up. Click a video for its details.`}>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        {[[s.pulse.newTotal ?? fresh.length, 'new videos', `${s.pulse.earlyHits ?? hot.length} already at 1.5×+ their channel`], [s.pulse.newChannels.length, 'new channels', 'found by this week’s searches'], [s.pulse.terms.length, 'rising terms', 'at least 2× their share of last year’s titles']].map(([v, l, sub]) => (
          <div key={String(l)} className="rounded-[22px] p-5 flex flex-col gap-1" style={{ background: T.tile }}>
            <span className="text-[34px] leading-none" style={mono}>{fmtInt(Number(v))}</span><span className="text-[15px] font-medium">{l}</span><span className="text-[13px]" style={{ color: T.muted }}>{sub}</span>
          </div>))}
      </div>
      <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card className="p-5 sm:p-8 flex flex-col gap-3 min-w-0">
          <H2>Breaking out early</H2>
          <p className="text-[14px]" style={{ color: T.muted }}>New videos ranked by their early multiple. Next week they’re judged like the rest.</p>
          {fresh.length ? <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">{fresh.slice(0, more ? 30 : 9).map(v => {
            const c = s.channels[v.c]
            return (
              <button key={v.id} type="button" onClick={() => open({ k: 'niche', id: v.id })} className="flex flex-col gap-1.5 text-left rounded-xl p-2 -m-2 hover:bg-[#F1F0EC] min-w-0">
                <span className="relative"><Thumb vid={v.id} thumbs={thumbs} w={240} fluid />
                  <span className="absolute right-1.5 bottom-1.5 rounded px-1.5 py-0.5 text-[12px] font-semibold" style={{ ...mono, background: (v.x ?? 0) >= 1.5 ? '#1F6B3E' : 'rgba(0,0,0,0.7)', color: '#fff' }}>{v.x == null ? '–' : `${r1(v.x)}×`}</span></span>
                <span className="text-[14px] font-medium leading-snug line-clamp-2">{v.t}</span>
                <span className="text-[12px]" style={{ color: T.muted }}>{c?.t ?? '—'} · {compact(v.v)} views · {ageDays(v.p, s.fetchedAt)}d</span>
              </button>)
          })}</div> : <p className="text-[14px]" style={{ color: T.muted }}>No new videos in this scan.</p>}
          {fresh.length > 9 && <button type="button" onClick={() => setMore(x => !x)} className="self-start text-[14px] underline">{more ? 'Show fewer' : `Show ${Math.min(30, fresh.length) - 9} more`}</button>}
        </Card>
        <div className="flex flex-col gap-6 min-w-0">
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
        {niche.length ? <NicheTable rows={niche.slice(0, all ? 200 : 20)} s={s} showTheme open={open} /> : <p className="text-[14px]" style={{ color: T.muted }}>No scan videos for this slice.</p>}
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
