import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { DashboardPayload } from '@/lib/plg/load'
import { fmtShort } from '@/lib/plg/dates'
import { Card, H2, T, fmtInt, fmtPctSigned, fmtSigned } from './ui'

export function Commentary({ v }: { v: DashboardPayload }) {
  const c = v.commentary
  if (!c) return null
  return (
    <section className="rounded-[28px] p-6 sm:p-10 flex flex-col gap-6" style={{ background: T.tile }}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <H2>Channel commentary</H2>
        <p className="text-[13px] uppercase" style={{ letterSpacing: '0.14em', color: T.muted, fontFamily: T.mono }}>
          Written for {c.label}
        </p>
      </div>
      <ul className="flex flex-col gap-4 list-disc pl-6 text-[16px] sm:text-[18px] leading-relaxed" style={{ color: T.ink }}>
        {c.bullets.map((b, i) => (
          <li key={i}><strong>{b.lead}</strong> — {b.body}</li>
        ))}
      </ul>
      <p className="text-[13px]" style={{ color: T.muted }}>
        Generated from week-over-week movers (|Δ| ≥ 30). Describes what moved, not why. Always the last complete Mon–Sun week, whatever the filter.
      </p>
    </section>
  )
}

export function Discuss({ v }: { v: DashboardPayload }) {
  if (!v.discuss.length) return null
  return (
    <Card className="p-6 sm:p-10 flex flex-col gap-4">
      <H2>Discuss</H2>
      <ol className="flex flex-col gap-3 list-decimal pl-6 text-[16px] sm:text-[17px] leading-relaxed" style={{ color: T.ink }}>
        {v.discuss.map((q, i) => <li key={i}>{q}</li>)}
      </ol>
    </Card>
  )
}

function Row({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : Info
  const color = tone === 'ok' ? '#1E7A46' : tone === 'warn' ? '#9A5B00' : T.muted
  return (
    <li className="flex items-start gap-3 text-[14px] leading-relaxed" style={{ color: T.ink }}>
      <Icon size={16} className="mt-[3px] shrink-0" style={{ color }} />
      <span>{children}</span>
    </li>
  )
}

export function DataQualityStrip({ v }: { v: DashboardPayload }) {
  const dq = v.dataQuality
  return (
    <Card className="p-6 sm:p-8 flex flex-col gap-4">
      <h3 className="text-[16px] font-bold" style={{ color: T.ink }}>Data quality</h3>
      <ul className="flex flex-col gap-2.5">
        {dq.unattrSpikes.length
          ? <Row tone="warn">Unattributable spike (&gt;12% of the day) on {dq.unattrSpikes.map(s => `${fmtShort(s.d)} (${(s.share * 100).toFixed(1)}%)`).join(', ')}. Usually a session-matching regression; check before reading channel mix.</Row>
          : <Row tone="ok">No unattributable spikes in the last 7 days of data (threshold 12% of a day).</Row>}
        {dq.incidents.map(k => (
          <Row key={k.label} tone="info">Known incident in range: {k.label} ({k.dates.map(fmtShort).join(', ')}).</Row>
        ))}
        {dq.reconMismatches.length > 0 && (
          <Row tone="warn">
            Workspace-level totals differ from fct_plg_workspace_blended_attribution_metrics on{' '}
            {dq.reconMismatches.slice(-5).map(m => `${fmtShort(m.day)} (${fmtInt(m.facts)} vs ${fmtInt(m.metrics)})`).join(', ')}.
          </Row>
        )}
        {dq.lastRun?.status === 'error' && <Row tone="warn">Last nightly refresh failed: {dq.lastRun.message}</Row>}
        <Row tone="info">
          {v.range.settled ? 'Selected dates are settled (closed 14+ days ago).' : 'Selected dates are still settling: expect roughly −4–5% restatement over the next 1–2 weeks as spam / Clay-internal filtering catches up.'}
        </Row>
        <Row tone="info">Instagram, Facebook and TikTok in-app browsers strip referrers, so those numbers come from the HDYHAU survey and won&apos;t reconcile with first-touch session data.</Row>
      </ul>
    </Card>
  )
}

export function RestatementBanner({ v }: { v: DashboardPayload }) {
  const r = v.dataQuality.restatements
  if (!r.length) return null
  return (
    <div className="rounded-2xl px-5 py-3 text-[14px] flex flex-col gap-1" style={{ background: T.amberBg, color: T.amberInk }} role="status">
      {r.map(x => (
        <p key={`${x.week_start}-${x.at}`}>
          Week of {fmtShort(x.week_start)} restated from {fmtInt(x.old)} to {fmtInt(x.new)} ({fmtSigned(x.new - x.old)}, {fmtPctSigned(x.old ? (x.new - x.old) / x.old : null)} vs last snapshot).
        </p>
      ))}
    </div>
  )
}
