/**
 * Prints the acceptance-checklist numbers (build prompt §9) for one week, from a
 * fixture file of fact rows, so the dashboard math can be eyeballed against a
 * reference Slack post.
 *
 *   npx tsx scripts/plg-check.ts <fixture.json> [weekStart=2026-11-02]
 *
 * The fixture must cover weekStart-7 … weekStart+6 (and the quarter-to-date for
 * the QTD/projection lines).
 */
import { fixtureSource } from '../lib/plg/fixtureSource'
import { loadDashboard } from '../lib/plg/load'
import { addDays } from '../lib/plg/dates'

async function main() {
  const [path, weekStart = '2026-11-02'] = process.argv.slice(2)
  if (!path) throw new Error('usage: plg-check.ts <fixture.json> [weekStart]')
  const sp = new URLSearchParams({ start: weekStart, end: addDays(weekStart, 6), compare: 'previous_period' })
  const v = await loadDashboard(sp, fixtureSource(path))
  const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`)
  const n = (x: number | null | undefined) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'))
  const sg = (x: number) => (x >= 0 ? '+' : '') + n(x)

  console.log(`Range ${v.range.label} vs ${v.range.prevLabel}`)
  console.log(`NEW WORKSPACES      ${n(v.kpis.total)} · ${sg(v.kpis.total - v.kpis.prevTotal)} · ${pct(v.kpis.deltaPct)}`)
  console.log(`PACE VS GOAL        ${pct(v.kpis.paceVsGoal)} (${n(v.kpis.total)} of ${n(v.kpis.goal)})`)
  const pr = v.kpis.projection
  console.log(`PROJECTED ${pr?.label} FINISH  ${n(pr?.value)} (${pct(pr?.pctOfGoal, 0)} of ${n(pr?.quarterGoal)}) · QTD ${n(pr?.qtdActual)} · need ${n(pr?.neededPerWeek)}/wk`)
  console.log(`TIER 1-2 SHARE      ${pct(v.kpis.tier12.share)} (${n(v.kpis.tier12.count)}) · goal mix ${pct(v.kpis.tier12.goalMix)}`)
  console.log('Tier pacing        ', v.tiers.map(t => `${t.tier} ${n(t.actual)}/${n(t.goal)} ${pct(t.pct, 0)} ${t.status}`).join(' | '))
  for (const g of v.table.groups) {
    const r = g.row
    console.log(`  ${r.label.padEnd(26)} ${n(r.cur).padStart(6)} ${sg(r.delta).padStart(6)} ${pct(r.deltaPct).padStart(7)} goal ${n(r.goal).padStart(6)} ${pct(r.vsGoal, 0).padStart(5)} tiers ${r.tiers.map(n).join('/')}`)
  }
  const t = v.table.total
  console.log(`  ${'TOTAL'.padEnd(26)} ${n(t.cur).padStart(6)} ${sg(t.delta).padStart(6)} ${pct(t.deltaPct).padStart(7)} goal ${n(t.goal).padStart(6)} ${pct(t.vsGoal, 0).padStart(5)} tiers ${t.tiers.map(n).join('/')}`)
  console.log('MCP                ', v.mcp.rows.slice(0, 4).map(r => `${r.platform} ${n(r.cur)} (${sg(r.delta)})`).join(', '),
    `· share ${pct(v.mcp.share)} from ${pct(v.mcp.prevShare)}`)
  console.log('Domain quality     ', v.quality.rows.map(r => `${r.label} ${n(r.cur)}`).join(', '))
  console.log(`HQ share ${pct(v.quality.hqShare)} vs ${pct(v.quality.prevHqShare)} · Low-Q ${pct(v.quality.lowShare)} vs ${pct(v.quality.prevLowShare)} · shift badge: ${v.quality.shift.fired}`)
  console.log(`Commentary (${v.commentary?.label}):`)
  for (const b of v.commentary?.bullets ?? []) console.log(`  • ${b.lead} — ${b.body}`)
  console.log('Discuss:', v.discuss)
  console.log('DQ unattributable spikes:', v.dataQuality.unattrSpikes)
}

main().catch(e => { console.error(e); process.exit(1) })
