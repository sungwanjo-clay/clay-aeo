/** What moved on the Workspaces tab (lib/plg/insights.ts rules), for the selected range vs the comparison range. */
import { chg, driverPara, headlineLine, type Block, type Insight, type Item, type Para } from './insights'
import type { DashboardPayload } from './plan'

const int = (n: number) => Math.round(n).toLocaleString('en-US')

export function workspacesInsight(v: DashboardPayload, extra: Block[] = []): Insight {
  const k = v.kpis
  const rc = k.rates.cur, rp = k.rates.prev
  const headline: Para[] = [
    headlineLine('New workspaces', k.total, k.prevTotal),
    headlineLine('High-quality trial users', k.hqTotal, k.hqPrevTotal),
    headlineLine('Tier 1–3 workspaces', k.tier13.cur, k.tier13.prev),
    ...(rc ? [
      headlineLine('Visitors', rc.visitors, rp?.visitors ?? null),
      headlineLine('Visit → HQ trial', rc.visitToHq, rp?.visitToHq ?? null, { kind: 'rate' }),
      headlineLine('Activation rate', rc.activation, rp?.activation ?? null, { kind: 'rate' }),
      headlineLine('Trial → paid', rc.trialToPaid, rp?.trialToPaid ?? null, { kind: 'rate' }),
    ] : []),
  ]
  // Drivers: every channel (MCP platforms roll up into their channel row), and the channel groups for tiers.
  const pretty = (l: string) => (l === 'undefined' ? 'No channel recorded' : l === 'unattributable' ? 'Unattributable' : l)
  const channels: Item[] = v.table.groups.flatMap(g => g.children.map(c => ({ label: pretty(c.label), cur: c.cur, prev: c.prev, tags: [g.row.label] })))
  const drivers = [
    driverPara('New workspaces', 'workspaces', { cur: k.total, prev: k.prevTotal }, channels, { minVolume: 10, noun: 'channels' }),
  ].filter((p): p is Block => !!p).concat(extra)
  const anomalies: Para[] = []
  if (v.quality.shift.fired) anomalies.push([`High-quality share of non-personal workspaces moved `, chg(v.quality.shift.shiftPp, 'pp'),
    ` while non-personal volume held roughly flat: about ${int(v.quality.shift.reclassified)} workspaces look reclassified from high to low quality, so the HQ figures reflect a scoring change more than a change in signups.`])
  const note = v.range.settled ? null : 'The latest days are still settling; counts can move about 5% as attribution completes.'
  return { note, headline, drivers, emerging: [], anomalies, goals: [] }
}
