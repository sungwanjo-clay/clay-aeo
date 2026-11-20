'use client'

import type { Insight, Para, Run } from '@/lib/plg/insights'
import { Card, Eyebrow, H2, T } from './ui'

const POS = '#1F8A4C', NEG = '#C4462B'

function RunView({ r }: { r: Run }) {
  if (typeof r === 'string') return <>{r}</>
  if (r.k === 'b') return <b>{r.s}</b>
  if (r.k === 'code') return <code className="rounded px-1 py-0.5 text-[0.92em]" style={{ background: T.tile, fontFamily: T.mono }}>{r.s}</code>
  // Change: colored arrow, positive magnitude.
  if (r.v == null) return <span style={{ color: T.muted }}>–</span>
  const flat = r.unit === 'pp' ? Math.abs(r.v) < 0.05 : r.unit === 'pct' ? Math.abs(r.v) < 0.005 : r.v === 0
  if (flat) return <span style={{ color: T.muted, fontFamily: T.mono }}>— 0{r.unit === 'pp' ? '.0pp' : r.unit === 'pct' ? '%' : ''}</span>
  const up = r.v > 0, good = (r.goodUp ?? true) ? up : !up
  const mag = r.unit === 'pct' ? `${Math.abs(r.v * 100).toFixed(Math.abs(r.v) < 0.1 ? 1 : 0)}%` : r.unit === 'pp' ? `${Math.abs(r.v).toFixed(1)}pp` : Math.abs(r.v).toLocaleString('en-US')
  return <span style={{ color: good ? POS : NEG, fontFamily: T.mono, whiteSpace: 'nowrap' }}>{up ? '▲' : '▼'}{mag}</span>
}
const P = ({ p }: { p: Para }) => <>{p.map((r, i) => <RunView key={i} r={r} />)}</>

/** "What moved": prose drivers, emerging signals and anomalies when there are any, and the full metric list collapsed. */
export default function WhatMoved({ insight: x }: { insight: Insight | null }) {
  if (!x) return null
  return (
    <Card className="p-5 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <H2>{x.title ?? 'What moved'}</H2>
      </div>
      {x.empty ? <p className="text-[15px]" style={{ color: T.muted }}>{x.empty}</p> : <>
        {x.drivers.length > 0 && <section className="flex flex-col gap-3">
          {x.drivers.map((p, i) => <p key={i} className="text-[15px] leading-relaxed" style={{ color: T.ink, maxWidth: '80ch' }}><P p={p} /></p>)}
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
