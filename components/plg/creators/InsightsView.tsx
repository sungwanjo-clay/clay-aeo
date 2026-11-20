'use client'

import { useMemo, useState } from 'react'
import { ATTRIBUTION, PERIODS, creatorsInsight, type CreatorsData, type Period, type VideoRow } from '@/lib/plg/creators/compute'
import WhatMoved from '../WhatMoved'
import SectionBar, { Chip } from '../SectionBar'
import { Card, Def, Eyebrow, H2, InfoTip, T, fmtInt, fmtPct } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-3 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const num = 'px-3 py-2.5 text-right whitespace-nowrap'
const r1 = (x: number | null | undefined) => (x == null ? '–' : x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2))
const rate = (a: number, b: number) => (b ? a / b : null)
const compact = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}K` : fmtInt(x))
const BAR = '#3B6FE0', BAR_SOFT = '#C9D7F7'

function Tile({ label, value, tip, children }: { label: string; value: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[22px] p-6 flex flex-col gap-3 min-w-0" style={{ background: T.tile }}>
      <div className="flex items-center gap-2"><Eyebrow>{label}</Eyebrow>{tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}</div>
      <p className="text-[40px] leading-none" style={{ ...mono, color: T.ink }}>{value}</p>
      <p className="text-[15px] leading-snug" style={{ color: T.ink }}>{children}</p>
    </div>
  )
}

function PreviewBadge() {
  return <span className="rounded-full px-2.5 py-1 text-[11px] uppercase" style={{ ...mono, letterSpacing: '0.1em', background: T.amberBg, color: T.amberInk }}>Preview</span>
}

function Spark({ xs }: { xs: number[] }) {
  if (xs.length < 2) return <span style={{ color: T.faint }}>–</span>
  const max = Math.max(1, ...xs), w = 84, h = 22
  const pts = xs.map((x, i) => `${(i / (xs.length - 1)) * w},${h - (x / max) * h}`).join(' ')
  return <svg width={w} height={h} aria-hidden><polyline points={pts} fill="none" stroke={BAR} strokeWidth="1.5" /></svg>
}

function Attr({ v }: { v: VideoRow }) {
  const tone = v.attribution === 'direct' ? { bg: '#E3F1E8', fg: '#1F6B3E' } : v.attribution === 'shared' ? { bg: T.amberBg, fg: T.amberInk } : { bg: '#EFEEEA', fg: T.muted }
  const label = v.attribution === 'shared' ? `Shared by ${v.sharedWith}` : ATTRIBUTION[v.attribution]
  return <span className="rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap" style={{ background: tone.bg, color: tone.fg }}>{label}</span>
}

export default function InsightsView({ d, period, onPeriod, thumbs, loading }: {
  d: CreatorsData; period: Period; onPeriod: (p: Period) => void; thumbs: Record<string, string>; loading?: boolean
}) {
  const [ownOnly, setOwnOnly] = useState(false)
  const insight = useMemo(() => creatorsInsight(d), [d])
  // Placements with no views and no traffic (dead, deleted, not live yet) stay in the sheet, not in the table.
  const shown = d.videos.filter(v => (v.views ?? 0) > 0 || v.life.vis > 0 || v.life.ws > 0)
  const videos = ownOnly ? shown.filter(v => v.attribution === 'direct') : shown
  const best = d.videos.filter(v => v.perK != null && !v.young).sort((a, b) => b.perK! - a.perK!)[0]
  const pl = PERIODS.find(p => p.id === period)!.label

  return (
    <div className="flex flex-col gap-6 sm:gap-8 transition-opacity" style={{ opacity: loading ? 0.55 : 1 }} aria-busy={loading}>
      <SectionBar label="Content insights filters">
        {PERIODS.map(p => <Chip key={p.id} on={period === p.id} onClick={() => onPeriod(p.id)}>{p.label}</Chip>)}
        <span className="mx-1 h-5 w-px" style={{ background: T.border }} />
        <Chip on={ownOnly} onClick={() => setOwnOnly(x => !x)} title="Videos with a link token of their own: the only ones a per-video rate is fair for">Own links only</Chip>
        <span className="ml-auto text-[13px]" style={{ color: T.muted }}>Weeks start Sunday · data through {d.dataEnd}</span>
      </SectionBar>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Program workspaces" value={fmtInt(d.program.ws)}
          tip={<Def d="New workspaces whose first-touch session landed on a creator program link (clay.com/?via=<token>), 90-day window." src="FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION × MARKETING_WEBSITE_SESSIONS; tokens from the program sheet" />}>
          {d.programShare != null ? `${fmtPct(d.programShare, 0)} of ${fmtInt(d.all.ws)} affiliate-link workspaces` : 'No affiliate workspaces'} · {pl === PERIODS[0].label ? pl.replace('Since', 'since') : pl.toLowerCase()}
        </Tile>
        <Tile label="Tier 1–3" value={fmtInt(d.program.t13)} tip={<Def d="Workspaces on a Tier 1–3 Salesforce account domain, the Marketing tile’s rule." />}>
          {fmtPct(rate(d.program.t13, d.program.ws), 1)} of program workspaces
        </Tile>
        <Tile label="Activated in 7 days" value={fmtPct(rate(d.program.act, d.program.mat), 0)}
          tip={<Def d="Activated within 7 days of creation, out of program workspaces at least 7 days old." />}>
          {fmtInt(d.program.act)} of {fmtInt(d.program.mat)} · {fmtInt(d.program.paid)} paid
        </Tile>
        <Tile label="Best yield" value={best ? r1(best.perK) : '–'}
          tip={<Def d="New workspaces per 1,000 YouTube views, lifetime, for videos with a link of their own and live 14+ days." note={d.medianPerK != null ? `Program median: ${r1(d.medianPerK)}.` : undefined} />}>
          {best ? <>workspaces per 1K views · {best.creator}</> : 'No video with its own link yet'}
        </Tile>
      </div>

      <WhatMoved insight={insight} />

      <Funnel d={d} />

      <Card className="p-5 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div className="flex flex-col gap-1">
            <H2>Videos that drive workspaces</H2>
            <p className="text-[15px]" style={{ color: T.muted }}>Program videos ranked by new workspaces {pl === PERIODS[0].label ? pl.replace('Since', 'since') : pl.toLowerCase()}. Per 1K views and × channel median are lifetime.</p>
          </div>
        </div>
        <div className="overflow-x-auto -mx-5 sm:-mx-8">
          <table className="w-full text-[14px]" style={{ color: T.ink, minWidth: 1100 }}>
            <thead><tr style={head}>
              <th className={`${th} text-left pl-5 sm:pl-8`}>Video</th>
              <th className={`${th} text-left`}>Placement</th>
              <th className={`${th} text-right`}>Views</th>
              <th className={`${th} text-right`}><span className="inline-flex items-center gap-1">× median<InfoTip label="About × median"><Def d="Views against the channel’s median long-form video (recent uploads, newest 5 excluded). Under 1 = the sponsored video did worse than the channel’s usual." /></InfoTip></span></th>
              <th className={`${th} text-right`}>Length</th>
              <th className={`${th} text-right`}>Workspaces</th>
              <th className={`${th} text-right`}>Tier 1–3</th>
              <th className={`${th} text-right`}>Act. 7d</th>
              <th className={`${th} text-right`}>Paid</th>
              <th className={`${th} text-right`}>Per 1K views</th>
              <th className={`${th} text-left`}>Weekly since live</th>
              <th className={`${th} text-left pr-5 sm:pr-8`}>Link</th>
            </tr></thead>
            <tbody>
              {videos.map(v => (
                <tr key={v.key} style={{ borderBottom: `1px solid ${T.border}` }}>
                  <td className="px-3 py-2.5 pl-5 sm:pl-8">
                    <div className="flex items-center gap-3 min-w-[300px]">
                      {v.vid && thumbs[v.vid] ? <img src={thumbs[v.vid]} alt="" width={96} height={54} className="rounded-md shrink-0" style={{ objectFit: 'cover' }} />
                        : <span className="w-[96px] h-[54px] rounded-md shrink-0" style={{ background: T.tile }} />}
                      <span className="flex flex-col min-w-0">
                        {v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="font-medium leading-snug hover:underline line-clamp-2">{v.title}</a> : <span className="font-medium leading-snug line-clamp-2">{v.title}</span>}
                        <span className="text-[13px]" style={{ color: T.muted }}>{v.creator}{v.fit ? ` · ${v.fit}` : ''}{v.live ? ` · live ${v.live}` : ''}{v.young ? ' · new' : ''}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{v.placement}</td>
                  <td className={num} style={mono}>{fmtInt(v.views)}</td>
                  <td className={num} style={{ ...mono, color: v.multiple == null ? T.faint : v.multiple >= 2 ? '#1F6B3E' : v.multiple < 0.7 ? T.neg : T.ink }}>{v.multiple == null ? '–' : `${r1(v.multiple)}×`}</td>
                  <td className={num} style={mono}>{v.mins == null ? '–' : `${Math.round(v.mins)}m`}</td>
                  <td className={num} style={{ ...mono, fontWeight: 600 }}>{fmtInt(v.m.ws)}</td>
                  <td className={num} style={mono}>{fmtInt(v.m.t13)}</td>
                  <td className={num} style={mono}>{v.m.mat ? fmtPct(v.m.act / v.m.mat, 0) : '–'}</td>
                  <td className={num} style={mono}>{fmtInt(v.m.paid)}</td>
                  <td className={num} style={{ ...mono, fontWeight: 600 }}>{r1(v.perK)}</td>
                  <td className="px-3 py-2.5"><Spark xs={v.spark} /></td>
                  <td className="px-3 py-2.5 pr-5 sm:pr-8"><span className="flex flex-col gap-1 items-start"><Attr v={v} /><code className="text-[11px]" style={{ color: T.faint }}>{v.token}</code></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] mt-4" style={{ color: T.muted }}>Shared links count every video on the token, so they’re shown but not rated per view. “Excluded” and “Not measurable” follow the program sheet’s own flags.</p>
      </Card>

      <Patterns d={d} />

      <div className="grid gap-6 sm:gap-8 grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Creators d={d} />
        <Checks d={d} />
      </div>

      <PreviewDemand d={d} />
      <PreviewBriefs d={d} />
    </div>
  )
}

function Funnel({ d }: { d: CreatorsData }) {
  const steps = d.funnel
  return (
    <Card className="p-5 sm:p-8">
      <div className="flex flex-col gap-1 mb-5">
        <H2>YouTube creator funnel</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Program to date, every stage with its owner. Greyed stages have no data source yet.</p>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-9">
        {steps.map(s => {
          const conv = s.value != null && s.of?.value ? s.value / s.of.value : null
          return (
            <div key={s.label} className="rounded-2xl p-4 flex flex-col gap-1.5 min-w-0" style={{ background: s.value == null ? '#F6F5F2' : T.tile, opacity: s.value == null ? 0.7 : 1 }}>
              <span className="text-[12px] uppercase" style={{ ...mono, letterSpacing: '0.08em', color: T.muted }}>{s.label}</span>
              <span className="text-[24px] leading-none" style={{ ...mono, color: s.value == null ? T.faint : T.ink }} title={s.value == null ? undefined : fmtInt(s.value)}>{s.value == null ? 'n/a' : compact(s.value)}</span>
              <span className="text-[12px]" style={{ ...mono, color: T.muted }}>{conv != null ? `${fmtPct(conv, conv < 0.01 ? 2 : 1)} of ${s.of!.label}` : '\u00a0'}</span>
              <span className="text-[12px] leading-snug" style={{ color: T.muted }}>{s.note}</span>
              <span className="text-[11px] mt-auto" style={{ color: T.faint }}>Owner: {s.owner}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function Patterns({ d }: { d: CreatorsData }) {
  const max = Math.max(0.01, ...d.patterns.flatMap(p => p.rows.map(r => r.median ?? 0)))
  return (
    <Card className="p-5 sm:p-8">
      <div className="flex flex-col gap-1 mb-5">
        <H2>What the winners share</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>Median workspaces per 1K views by trait. Videos with their own link, live 14+ days, long-form only. Small groups: read as direction, not proof.</p>
      </div>
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {d.patterns.map(p => (
          <div key={p.factor} className="flex flex-col gap-2.5 min-w-0">
            <Eyebrow>{p.factor}</Eyebrow>
            {p.rows.map(r => (
              <div key={r.label} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-[14px]">
                  <span>{r.label}</span>
                  <span style={{ ...mono, color: T.muted }}><b style={{ color: T.ink }}>{r1(r.median)}</b> · {r.videos} videos · {fmtInt(r.ws)} ws</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: '#EFEEEA' }}>
                  <div className="h-2 rounded-full" style={{ width: `${Math.max(2, ((r.median ?? 0) / max) * 100)}%`, background: BAR }} />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  )
}

function Creators({ d }: { d: CreatorsData }) {
  return (
    <Card className="p-5 sm:p-8">
      <H2>Creators</H2>
      <p className="text-[15px] mt-1 mb-4" style={{ color: T.muted }}>Each link counted once, so shared links don’t double up.</p>
      <div className="overflow-x-auto -mx-5 sm:-mx-8">
        <table className="w-full text-[14px]" style={{ color: T.ink, minWidth: 620 }}>
          <thead><tr style={head}>
            <th className={`${th} text-left pl-5 sm:pl-8`}>Creator</th>
            <th className={`${th} text-right`}>Videos</th>
            <th className={`${th} text-right`}>Views</th>
            <th className={`${th} text-right`}>Workspaces</th>
            <th className={`${th} text-right`}>Tier 1–3</th>
            <th className={`${th} text-right pr-5 sm:pr-8`}>Per 1K views</th>
          </tr></thead>
          <tbody>
            {d.creators.filter(c => c.views || c.m.ws).map(c => (
              <tr key={c.creator} style={{ borderBottom: `1px solid ${T.border}` }}>
                <td className="px-3 py-2.5 pl-5 sm:pl-8"><span className="font-medium">{c.creator}</span><span className="text-[13px]" style={{ color: T.muted }}>{c.fit ? ` · ${c.fit}` : ''}{c.agency ? ` · ${c.agency}` : ''}</span></td>
                <td className={num} style={mono}>{c.videos}</td>
                <td className={num} style={mono}>{fmtInt(c.views)}</td>
                <td className={num} style={{ ...mono, fontWeight: 600 }}>{fmtInt(c.m.ws)}</td>
                <td className={num} style={mono}>{fmtInt(c.m.t13)}</td>
                <td className={`${num} pr-5 sm:pr-8`} style={mono}>{r1(c.perK)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Checks({ d }: { d: CreatorsData }) {
  return (
    <Card className="p-5 sm:p-8">
      <H2>Data checks</H2>
      <p className="text-[15px] mt-1 mb-4" style={{ color: T.muted }}>For the affiliate team: links worth naming, and where Rewardful and the warehouse disagree.</p>
      <Eyebrow>Links not in the program sheet</Eyebrow>
      <div className="overflow-x-auto"><table className="w-full text-[14px] mt-2 mb-6" style={{ color: T.ink, minWidth: 340 }}>
        <thead><tr style={head}><th className={`${th} text-left px-0`}>Token</th><th className={`${th} text-right`}>Visitors</th><th className={`${th} text-right`}>Workspaces</th><th className={`${th} text-right pr-0`}>Paid</th></tr></thead>
        <tbody>{d.unmapped.slice(0, 10).map(u => (
          <tr key={u.tok} style={{ borderBottom: `1px solid ${T.border}` }}>
            <td className="py-2"><code className="text-[13px]">{u.tok}</code></td>
            <td className={num} style={mono}>{fmtInt(u.m.vis)}</td>
            <td className={num} style={mono}>{fmtInt(u.m.ws)}</td>
            <td className={`${num} pr-0`} style={mono}>{fmtInt(u.m.paid)}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="flex items-center gap-2"><Eyebrow>Rewardful signups vs warehouse workspaces</Eyebrow>
        <InfoTip label="About this check"><Def d="Lifetime, per token. Rewardful counts a signup on the link; the warehouse counts a new workspace whose first-touch session was the link. Close on clean links; far apart when a link was reused outside its video." /></InfoTip></div>
      <div className="overflow-x-auto"><table className="w-full text-[14px] mt-2" style={{ color: T.ink, minWidth: 340 }}>
        <thead><tr style={head}><th className={`${th} text-left px-0`}>Token</th><th className={`${th} text-right`}>Rewardful</th><th className={`${th} text-right`}>Warehouse</th><th className={`${th} text-right pr-0`}>Ratio</th></tr></thead>
        <tbody>{d.reconcile.slice(0, 12).map(r => {
          const x = r.rewardful ? r.warehouse / r.rewardful : null
          const off = x != null && r.rewardful >= 20 && (x < 0.6 || x > 1.6)
          return (
            <tr key={r.token} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="py-2"><code className="text-[13px]">{r.token}</code></td>
              <td className={num} style={mono}>{fmtInt(r.rewardful)}</td>
              <td className={num} style={mono}>{fmtInt(r.warehouse)}</td>
              <td className={`${num} pr-0`} style={{ ...mono, color: off ? T.neg : T.ink }}>{x == null ? '–' : `${x.toFixed(2)}×`}</td>
            </tr>)
        })}</tbody>
      </table></div>
    </Card>
  )
}

function PreviewDemand({ d }: { d: CreatorsData }) {
  const p = d.preview
  if (!p) return null
  const subj = [...p.subjects].sort((a, b) => b[2] / b[1] - a[2] / a[1])
  return (
    <Card className="p-5 sm:p-8">
      <div className="flex flex-wrap items-center gap-3 mb-1"><H2>What the niche watches</H2><PreviewBadge /></div>
      <p className="text-[15px] mb-5" style={{ color: T.muted }}>{p.source}. Becomes a weekly look-alike scan in phase 3, with the workspace overlay from the tables above.</p>
      <div className="grid gap-8 grid-cols-1 xl:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <Eyebrow>Hit rate by subject (share of videos at 3×+ their channel)</Eyebrow>
          {subj.map(([s, vids, hits, chans]) => {
            const hr = hits / vids
            return (
              <div key={s} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2 text-[14px]"><span>{s}</span><span style={{ ...mono, color: T.muted }}><b style={{ color: T.ink }}>{fmtPct(hr, 0)}</b> · {hits} on {chans} channels</span></div>
                <div className="h-2 rounded-full" style={{ background: '#EFEEEA' }}><div className="h-2 rounded-full" style={{ width: `${hr / 0.35 * 100}%`, background: hr >= p.baseRate ? BAR : BAR_SOFT }} /></div>
              </div>
            )
          })}
          <p className="text-[13px]" style={{ color: T.muted }}>Niche base rate {fmtPct(p.baseRate, 0)}; darker bars beat it.</p>
        </div>
        <div className="flex flex-col gap-2.5">
          <Eyebrow>Title formats</Eyebrow>
          {p.formats.map(([f, vids, hits]) => {
            const hr = hits / vids
            return (
              <div key={f} className="flex flex-col gap-1">
                <div className="flex justify-between gap-2 text-[14px]"><span>{f}</span><span style={{ ...mono, color: T.muted }}><b style={{ color: hr >= p.baseRate ? T.ink : T.neg }}>{fmtPct(hr, 0)}</b> · {hits} of {vids}</span></div>
                <div className="h-2 rounded-full" style={{ background: '#EFEEEA' }}><div className="h-2 rounded-full" style={{ width: `${hr / 0.4 * 100}%`, background: hr >= p.baseRate ? BAR : BAR_SOFT }} /></div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}

function PreviewBriefs({ d }: { d: CreatorsData }) {
  const p = d.preview
  if (!p) return null
  const tbd = <span style={{ color: T.faint }}>To define</span>
  return (
    <Card className="p-5 sm:p-8">
      <div className="flex flex-wrap items-center gap-3 mb-1"><H2>Next videos to make</H2><PreviewBadge /></div>
      <p className="text-[15px] mb-5" style={{ color: T.muted }}>Eric’s top 5 from the demand map. Phase 4 fills in the offer, CTA, landing page and nurture track for each, from what converts above.</p>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {p.ideas.map((x, i) => (
          <div key={x.idea} className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: T.tile }}>
            <div className="flex items-center justify-between gap-2"><Eyebrow>{i + 1}. {x.idea}</Eyebrow><span className="text-[12px] rounded-full px-2 py-0.5" style={{ background: '#E3F1E8', color: '#1F6B3E' }}>{x.verdict}</span></div>
            <p className="text-[17px] font-semibold leading-snug">{x.title}</p>
            <p className="text-[14px]" style={{ color: T.muted }}>{x.evidence}. {x.why}.</p>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px] pt-2" style={{ borderTop: `1px solid ${T.border}` }}>
              <dt style={{ color: T.muted }}>Platform</dt><dd>YouTube, long-form</dd>
              <dt style={{ color: T.muted }}>Offer / CTA</dt><dd>{tbd}</dd>
              <dt style={{ color: T.muted }}>Landing page</dt><dd>{tbd}</dd>
              <dt style={{ color: T.muted }}>Nurture track</dt><dd>{tbd}</dd>
              <dt style={{ color: T.muted }}>Proof it converts</dt><dd>{tbd}</dd>
            </dl>
          </div>
        ))}
      </div>
    </Card>
  )
}
