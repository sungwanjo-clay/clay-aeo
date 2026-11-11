import type { DashboardPayload } from '@/lib/plg/load'
import { GUARDRAILS } from '@/lib/plg/config'
import { Card, Delta, Eyebrow, H2, Pill, T, deltaColor, fmtInt, fmtPct, fmtPctSigned, fmtPp, fmtSigned } from './ui'

export function McpByPlatform({ v }: { v: DashboardPayload }) {
  const m = v.mcp
  const max = Math.max(1, ...m.rows.map(r => r.cur))
  const dir = m.share != null && m.prevShare != null ? (m.share >= m.prevShare ? 'up' : 'down') : null
  return (
    <Card className="p-5 sm:p-10 flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <H2>OAuth: MCP by platform</H2>
        <p className="text-[15px]" style={{ color: T.muted }}>
          <span style={{ fontFamily: T.mono }}>{fmtPct(m.share)}</span> of all workspaces
          {dir && <>, {dir} from <span style={{ fontFamily: T.mono }}>{fmtPct(m.prevShare)}</span></>}
        </p>
      </div>
      {m.rows.length === 0 ? <p style={{ color: T.muted }}>No MCP signups in this range.</p> : (
        <ul className="flex flex-col gap-3">
          {m.rows.map(r => (
            <li key={r.platform} className="grid grid-cols-[minmax(96px,140px)_1fr_64px_48px] sm:grid-cols-[160px_1fr_72px_56px] items-center gap-3 sm:gap-6 text-[16px]">
              <span className="truncate" style={{ color: T.ink }}>{r.platform}</span>
              <div className="h-[18px] rounded-md" style={{ background: '#F1F0EC' }}>
                <div className="h-full rounded-md" style={{ width: `${Math.max(0.6, (r.cur / max) * 100)}%`, background: T.pos }} />
              </div>
              <span className="text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.cur)}</span>
              <span className="text-right" style={{ fontFamily: T.mono, color: deltaColor(r.delta) }}>{r.delta === 0 ? '0' : fmtSigned(r.delta)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ShareTile({ label, cur, prev, invert, title }: { label: string; cur: number | null; prev: number | null; invert?: boolean; title?: string }) {
  const pp = cur != null && prev != null ? (cur - prev) * 100 : null
  // For low-quality share, an increase is bad → colour it negative.
  const tone = pp == null ? null : invert ? -pp : pp
  return (
    <div className="rounded-[18px] p-5 sm:p-6 flex flex-col gap-3" style={{ background: T.tile }} title={title}>
      <Eyebrow>{label}</Eyebrow>
      <p className="text-[32px] leading-none" style={{ fontFamily: T.mono, color: T.ink }}>{fmtPct(cur)}</p>
      <p className="text-[15px]" style={{ color: T.ink }}>
        vs {fmtPct(prev)}{pp != null && <> · <Delta value={tone}>{fmtPp(pp)}</Delta></>}
      </p>
    </div>
  )
}

export function DomainQuality({ v }: { v: DashboardPayload }) {
  const q = v.quality
  const dc = q.domainCheck
  const npDelta = dc.nonPersonal != null && dc.prevNonPersonal != null ? dc.nonPersonal - dc.prevNonPersonal : null
  const verify = dc.nonPersonal != null
    ? `Independent check (CUSTOMERS.CUSTOMER_DOMAIN_SEGMENT): non-personal ${fmtInt(dc.nonPersonal)} vs ${fmtInt(dc.prevNonPersonal)}` +
      (npDelta != null ? ` (${fmtSigned(npDelta)})` : '') +
      `. Quality-scored non-personal: ${fmtInt(dc.scoredNonPersonal)} vs ${fmtInt(dc.prevScoredNonPersonal)}. ` +
      'If CUSTOMERS non-personal is flat but HQ moved, it is a classification shift.'
    : 'Independent CUSTOMERS domain check not loaded for this range.'
  return (
    <Card className="p-5 sm:p-10 flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <H2>Domain quality mix</H2>
        {q.shift.fired && (
          <Pill tone="amber" title="Non-personal volume is roughly flat but the HQ/Low-Q split moved sharply. Confirm with data-eng before interpreting HQ share.">
            Likely classification shift
          </Pill>
        )}
      </div>
      <table className="w-full text-[16px]" style={{ color: T.ink }}>
        <thead>
          <tr className="text-[12px] uppercase" style={{ color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` }}>
            <th className="py-3 text-left font-medium">Domain type</th>
            <th className="py-3 text-right font-medium">Selected</th>
            <th className="py-3 text-right font-medium">Δ</th>
            <th className="py-3 text-right font-medium">%</th>
          </tr>
        </thead>
        <tbody>
          {q.rows.map(r => (
            <tr key={r.key} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td className="py-4">{r.label}</td>
              <td className="py-4 text-right" style={{ fontFamily: T.mono }}>{fmtInt(r.cur)}</td>
              <td className="py-4 text-right" style={{ fontFamily: T.mono, color: deltaColor(r.delta) }}>{r.delta === 0 ? '0' : fmtSigned(r.delta)}</td>
              <td className="py-4 text-right" style={{ fontFamily: T.mono, color: deltaColor(r.deltaPct) }}>{fmtPctSigned(r.deltaPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ShareTile label="HQ share" cur={q.hqShare} prev={q.prevHqShare} title={verify} />
        <ShareTile label="Low-quality share" cur={q.lowShare} prev={q.prevLowShare} invert />
      </div>
      <p className="text-[13px]" style={{ color: T.muted }}>
        Shares are of all new workspaces. Shift detector fires when HQ share of non-personal moves ≥{GUARDRAILS.hqShareShiftPp}pp
        {q.shift.shiftPp != null && <> (now {fmtPp(q.shift.shiftPp)})</>} or low-quality share of total exceeds {GUARDRAILS.lowQualityShareOfTotal * 100}%.
        Weekend HQ counts can lag 24–48h; don&apos;t react to a single weekend-day dip.
      </p>
    </Card>
  )
}
