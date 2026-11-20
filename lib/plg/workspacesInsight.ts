/**
 * What moved on the Workspaces tab (lib/plg/insights.ts rules), for the selected range vs the comparison range.
 * Same shape as the Media properties and Startup narratives: a channel summary first (which channel groups moved
 * the total, then which channels inside them), MCP platforms, the conversion rates with what moved them, then
 * emerging channels and anomalies.
 */
import { b, chg, code, driverPara, headlineLine, ratePara, type Block, type Insight, type Item, type Para } from './insights'
import type { DashboardPayload } from './plan'

const int = (n: number) => Math.round(n).toLocaleString('en-US')
const pretty = (l: string) => (l === 'undefined' ? 'No channel recorded' : l === 'unattributable' ? 'Unattributable' : l)

export function workspacesInsight(v: DashboardPayload): Insight {
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
  if (!k.total && !k.prevTotal) return { headline, drivers: [], emerging: [], anomalies: [], goals: [], empty: 'No new workspaces in either period.' }

  const groups = v.table.groups
  const groupItems: Item[] = groups.map(g => ({ label: g.row.label, cur: g.row.cur, prev: g.row.prev }))
  const channels: Item[] = groups.flatMap(g => g.children.map(c => ({ label: pretty(c.label), cur: c.cur, prev: c.prev, tags: [g.row.label] })))
  const mcpItems: Item[] = v.mcp.rows.map(r => ({ label: !r.platform || r.platform === 'undefined' ? 'Unknown platform' : r.platform, cur: r.cur, prev: r.cur - r.delta }))
  const mcpPrev = mcpItems.reduce((a, i) => a + i.prev, 0)

  const drivers: (Para | Block)[] = []
  // 1. Channel summary: which channel groups moved the total.
  const byGroup = driverPara('New workspaces', 'workspaces', { cur: k.total, prev: k.prevTotal }, groupItems, { noun: 'channel groups' })
  if (byGroup) drivers.push(byGroup)
  // 2. The channels inside them that moved most (same direction as the total, one offsetting).
  const byChannel = driverPara('By channel', 'workspaces', { cur: k.total, prev: k.prevTotal }, channels, { minVolume: 10, noun: 'channels' })
  if (byChannel && byChannel.bullets.length) drivers.push({ ...byChannel, lead: [b('By channel'), ', the biggest movers:'] })
  // 3. MCP signups by platform.
  if (v.mcp.total || mcpPrev) {
    const m = driverPara('MCP signups', 'workspaces', { cur: v.mcp.total, prev: mcpPrev }, mcpItems, { minVolume: 5, noun: 'platforms' })
    if (m) {
      if (v.mcp.share != null && v.mcp.prevShare != null) m.lead.push(` · ${(v.mcp.share * 100).toFixed(1)}% of new workspaces (`, chg((v.mcp.share - v.mcp.prevShare) * 100, 'pp'), ')')
      drivers.push(m)
    }
  }
  // 4. Rates, and whether the numerator or the denominator moved them.
  if (rc && rp) {
    drivers.push(...[
      ratePara('Visit → HQ trial', { cur: k.hqTotal, prev: k.hqPrevTotal, noun: 'high-quality trials' }, { cur: rc.visitors, prev: rp.visitors, noun: 'visitors' }, 200),
      ratePara('Activation rate', { cur: rc.activated, prev: rp.activated, noun: 'activated workspaces' }, { cur: rc.matured, prev: rp.matured, noun: 'workspaces with a full week' }, 50),
      ratePara('Trial → paid', { cur: rc.paid, prev: rp.paid, noun: 'paying workspaces' }, { cur: k.hqTotal, prev: k.hqPrevTotal, noun: 'high-quality trials' }, 50),
    ].filter((p): p is Para => !!p))
  }

  // Emerging: channels that are new or tripled, with real volume.
  const emerging: Para[] = []
  for (const c of [...channels].sort((a, x) => x.cur - a.cur)) {
    if (emerging.length >= 3) break
    if (c.cur >= 20 && (c.prev === 0 || c.cur >= c.prev * 3))
      emerging.push([code(c.label), ` (${c.tags?.[0]}): ${int(c.cur)} new workspaces${c.prev ? ` vs ${int(c.prev)}` : ', none the period before'}.`])
  }
  for (const m of mcpItems) if (m.cur >= 10 && m.prev === 0 && emerging.length < 4) emerging.push([code(`MCP · ${m.label}`), `: ${int(m.cur)} new workspaces, the first in this comparison.`])

  const anomalies: Para[] = []
  if (v.quality.shift.fired) anomalies.push([`High-quality share of non-personal workspaces moved `, chg(v.quality.shift.shiftPp, 'pp'),
    ` while non-personal volume held roughly flat: about ${int(v.quality.shift.reclassified)} workspaces look reclassified from high to low quality, so the HQ figures reflect a scoring change more than a change in signups.`])
  const spikes = v.dataQuality.unattrSpikes
  if (spikes.length) anomalies.push([`Unattributable signups spiked on ${spikes.map(s => s.d).join(', ')} (up to ${(Math.max(...spikes.map(s => s.share)) * 100).toFixed(0)}% of the day), which usually means session matching broke, so channel shares on those days are understated.`])
  const note = v.range.settled ? null : 'The latest days are still settling; counts can move about 5% as attribution completes.'
  return { note, headline, drivers, emerging, anomalies, goals: [] }
}
