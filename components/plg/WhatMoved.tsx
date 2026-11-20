'use client'

import type { Block, Insight, Para, Run } from '@/lib/plg/insights'
import { Card, Eyebrow, H2, T } from './ui'

const POS = '#1F8A4C', NEG = '#C4462B'

function RunView({ r }: { r: Run }) {
  if (typeof r === 'string') return <>{r}</>
  if (r.k === 'b') return <b>{r.s}</b>
  if (r.k === 'code') return <span className="font-medium" style={{ color: T.ink }}>{r.s}</span>
  // Change: colored arrow, positive magnitude.
  if (r.v == null) return <span style={{ color: T.muted }}>–</span>
  const flat = r.unit === 'pp' ? Math.abs(r.v) < 0.05 : r.unit === 'pct' ? Math.abs(r.v) < 0.005 : r.v === 0
  if (flat) return <span style={{ color: T.muted, fontFamily: T.mono }}>— 0{r.unit === 'pp' ? '.0pp' : r.unit === 'pct' ? '%' : ''}</span>
  const up = r.v > 0, good = (r.goodUp ?? true) ? up : !up
  const mag = r.unit === 'pct' ? `${Math.abs(r.v * 100).toFixed(Math.abs(r.v) < 0.1 ? 1 : 0)}%` : r.unit === 'pp' ? `${Math.abs(r.v).toFixed(1)}pp` : Math.abs(r.v).toLocaleString('en-US')
  return <span style={{ color: good ? POS : NEG, fontFamily: T.mono, whiteSpace: 'nowrap' }}>{up ? '▲' : '▼'}{mag}</span>
}
const P = ({ p }: { p: Para }) => <>{p.map((r, i) => <RunView key={i} r={r} />)}</>

/** A driver: lead line, one bullet per contributor, closing line. Plain paragraphs (rates, context) render as one line. */
function DriverView({ d }: { d: Para | Block }) {
  if (Array.isArray(d)) return <p className="text-[15px] leading-relaxed min-w-0" style={{ color: T.ink }}><P p={d} /></p>
  return (
    <div className="flex flex-col gap-1.5 min-w-0 text-[15px]" style={{ color: T.ink }}>
      <p><P p={d.lead} /></p>
      {d.bullets.length > 0 && <ul className="flex flex-col gap-1 pl-1">
        {d.bullets.map((b, i) => <li key={i} className="flex gap-2 leading-snug"><span style={{ color: T.faint }}>•</span><span className="min-w-0"><P p={b} /></span></li>)}
      </ul>}
      {d.note && <p className="text-[14px]" style={{ color: T.muted }}><P p={d.note} /></p>}
    </div>
  )
}

/** "What moved": prose drivers, emerging signals and anomalies when there are any, and the full metric list collapsed. */
export default function WhatMoved({ insight: x }: { insight: Insight | null }) {
  if (!x) return null
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <H2>{x.title ?? 'What moved'}</H2>
      </div>
      {x.empty ? <p className="text-[15px]" style={{ color: T.muted }}>{x.empty}</p> : <>
        {x.drivers.length > 0 && <section className="grid gap-x-8 gap-y-5 grid-cols-1 lg:grid-cols-2">
          {x.drivers.map((d, i) => <DriverView key={i} d={d} />)}
        </section>}
        {x.emerging.length > 0 && <section className="flex flex-col gap-2 pt-1" style={{ borderTop: `1px solid ${T.border}` }}>
          <Eyebrow>Emerging signals</Eyebrow>
          <ul className="flex flex-col gap-1.5 text-[15px]">{x.emerging.map((p, i) => <li key={i} className="flex gap-2"><span style={{ color: T.faint }}>•</span><span><P p={p} /></span></li>)}</ul>
        </section>}
        {x.anomalies.length > 0 && <section className="flex flex-col gap-2 rounded-xl p-4" style={{ background: T.amberBg, color: T.amberInk }}>
          <Eyebrow>Anomalies</Eyebrow>
          <ul className="flex flex-col gap-1.5 text-[15px]">{x.anomalies.map((p, i) => <li key={i}><P p={p} /></li>)}</ul>
        </section>}
        {/* The tiles above already show the headline numbers; the full list stays one click away. */}
        {x.headline.length > 0 && <details className="text-[14px]" style={{ color: T.muted }}>
          <summary className="cursor-pointer select-none">All metrics vs the period before</summary>
          <ul className="flex flex-col gap-1.5 text-[15px] pt-3" style={{ color: T.ink }}>
            {x.headline.map((p, i) => <li key={i} className="flex gap-2"><span style={{ color: T.faint }}>•</span><span><P p={p} /></span></li>)}
          </ul>
        </details>}
      </>}
    </Card>
  )
}
