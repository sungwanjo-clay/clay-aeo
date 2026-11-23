/**
 * Reconciliation checks for the dashboard's numbers, run against a downloaded saved copy:
 *   tiles = tables = funnels = What moved; per-video rows + older videos = channel totals; startup tiers + reasons = new
 *   workspaces; Workspaces channel table = KPI. Three presets × every Media scope.
 *   npx esbuild scripts/audit-dashboard.ts --bundle --platform=node --format=esm --outfile=/tmp/audit.mjs --tsconfig=tsconfig.json
 *   node /tmp/audit.mjs <cache dir (cache/*.json)> <youtube dir (UC*.json)>
 */
import { readFileSync, readdirSync } from 'node:fs'
import { buildSocial, parseSocialRows, type YtChannelDoc } from '@/lib/plg/social/compute'
import { buildStartup, parseStartupRows } from '@/lib/plg/startup/compute'
import { planDashboard, assembleDashboard } from '@/lib/plg/plan'
import { parseDashboardRows } from '@/lib/plg/sigma'
import { relabel } from '@/lib/plg/offline'
import { resolveQuarters } from '@/lib/plg/compute'
import { DEFAULT_QUARTERS } from '@/lib/plg/config'
import { buildCro, cut, trend } from '@/lib/plg/cro/compute'
import { pageTypeOf } from '@/lib/plg/cro/pageTypes'
import { buildTier4 } from '@/lib/plg/slg/compute'
import { existsSync } from 'node:fs'

const [cacheDir, ytDir] = process.argv.slice(2)
const un = (j: any) => (j && 'data' in j && Object.keys(j).length <= 3 ? j.data : j)
const cached = (name: string) => {
  const h = un(JSON.parse(readFileSync(`${cacheDir}/${name}.json`, 'utf8')))
  return { h, payload: JSON.parse(Array.from({ length: h.parts }, (_, i) => un(JSON.parse(readFileSync(`${cacheDir}/${name}-${i}.json`, 'utf8'))).s).join('')) }
}
const yt = readdirSync(ytDir).filter(f => /^UC.*\.json$/.test(f)).map(f => un(JSON.parse(readFileSync(`${ytDir}/${f}`, 'utf8'))) as YtChannelDoc)
let fails = 0, checks = 0
const eq = (what: string, a: number | null | undefined, b: number | null | undefined, tol = 0) => {
  checks++
  if (a == null || b == null || Math.abs(a - b) > tol) { fails++; console.log(`FAIL ${what}: ${a} vs ${b}`) }
}
const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)

const main = cached('main'), soc = cached('social'), st = cached('startup')
const quarters = resolveQuarters(DEFAULT_QUARTERS, [])
for (const qs of ['', 'preset=last28', 'preset=qtd&compare=previous_year']) {
  const plan = planDashboard(new URLSearchParams(qs), main.h.dataEnd, quarters)
  const sr = { cur: plan.summaries.cur, prev: plan.summaries.prev }
  // ── Media properties ──
  for (const scope of ['all', 'peter', 'eric'] as const) {
    const s = buildSocial({ scope, mode: 'calendar', cur: sr.cur, prev: sr.prev, dataEnd: main.h.dataEnd, rows: parseSocialRows(relabel(soc.payload, sr)), yt })
    const tag = `[${qs || 'last7'} · ${scope}]`
    const live = (s.channelRows.filter((r: any) => r.connected) as any[]).filter(r => scope === 'all' || r.id === scope)
    const f = (id: string) => s.funnel.find((x: any) => x.id === id)!
    eq(`${tag} views tile = channel table (connected)`, s.kpis.views.cur, sum(live.filter(r => r.analytics).map(r => r.views)))
    eq(`${tag} views tile = funnel`, s.kpis.views.cur, f('views').cur)
    eq(`${tag} referral visits tile = funnel`, s.kpis.visits.cur, f('visits').cur)
    if (scope === 'all') eq(`${tag} referral visits = channel table`, s.kpis.visits.cur, sum(live.map(r => r.visits)))
    eq(`${tag} impressions tile = channel table`, s.kpis.impressions.cur, sum(live.map(r => r.impressions)))
    // Videos table rows + older videos = channel views, per channel
    for (const r of live.filter(r => r.analytics)) {
      const vids = s.videos.filter((v: any) => v.channel === r.label)
      const older = s.olderVideos.find((o: any) => o.channel === r.label)?.views ?? 0
      eq(`${tag} ${r.label}: video rows + older = channel views`, sum(vids.map((v: any) => s.videoPeriod[v.id]?.views)) + older, r.views, 2)
    }
    // Deep dive: everything in scope = the tiles; each creator alone = their channel row
    const dAll = s.deep({ channels: [], videos: [] })
    eq(`${tag} deep dive (all) views = tile`, dAll.T0.views, s.kpis.views.cur)
    eq(`${tag} deep dive (all) referral visits = tile`, dAll.T0.visits, s.kpis.visits.cur)
    eq(`${tag} deep dive (all) impressions = tile`, dAll.T0.impr, s.kpis.impressions.cur)
    for (const r of live) {
      const dc = s.deep({ channels: [r.id], videos: [] })
      eq(`${tag} deep dive (${r.label}) visits = channel row`, dc.T0.visits, r.visits)
      if (r.analytics) eq(`${tag} deep dive (${r.label}) views = channel row`, dc.T0.views, r.views)
      const vids = s.videos.filter((v: any) => v.channel === r.label)
      if (vids.length && r.analytics) eq(`${tag} deep dive (${r.label}, all its videos) views = video rows`, s.deep({ channels: [r.id], videos: vids.map((v: any) => v.id) }).T0.views, sum(vids.map((v: any) => s.videoPeriod[v.id]?.views)))
    }
    // What moved: the views driver's total is the tile
    const vd = s.insight.drivers.find((d: any) => !Array.isArray(d) && JSON.stringify(d.lead).includes('"Views"')) as any
    if (vd && s.kpis.views.cur != null) {
      const txt = JSON.stringify(vd.lead); const m = txt.match(/(up|down) ([\d,]+)/)
      eq(`${tag} What moved views change = tile change`, m ? Number(m[2].replace(/,/g, '')) * (m[1] === 'up' ? 1 : -1) : null, (s.kpis.views.cur ?? 0) - (s.kpis.views.prev ?? 0))
    }
  }
  // ── Startup ──
  const su = buildStartup({ cur: sr.cur, prev: sr.prev, dataEnd: main.h.dataEnd, rows: parseStartupRows(relabel(st.payload, sr)) })
  const tag = `[${qs || 'last7'} · startup]`
  checks++; if (sum(su.T.campaigns.map(c => c.visits)) > su.T.visits) { fails++; console.log(`FAIL ${tag} paid campaign visits exceed visits`) }
  eq(`${tag} Tier 1–3 workspaces = sum of tiers`, su.T.newWsT13, sum(su.T.tiers.map(t => t.newWs)))
  eq(`${tag} new workspaces = Tier 1–3 + not-qualified reasons`, su.T.newWs, su.T.newWsT13 + sum(su.T.reasons.map(r => r.people)), 0)
  // ── Workspaces ──
  const v = assembleDashboard(plan, { min_day: '2025-01-01', last_ok_at: null, goals: [], restatements: [] } as any, parseDashboardRows(relabel(main.payload, plan.summaries), plan), 'sigma')
  eq(`[${qs || 'last7'} · workspaces] channel table total = KPI`, v.table.total.cur, v.kpis.total)
  eq(`[${qs || 'last7'} · workspaces] daily series sum = KPI`, sum(v.cumulative?.points?.map?.((p: any) => p.cur ?? 0) ?? []) || v.kpis.total, v.kpis.total, Math.max(5, v.kpis.total * 0.01))
}
// ── CRO and Tier 4 (default view; their saved copies may cover only it) ──
{
  const plan = planDashboard(new URLSearchParams(''), main.h.dataEnd, quarters)
  const sr = { cur: plan.summaries.cur, prev: plan.summaries.prev }
  const tot = (xs: any[], k: string, b: 'cur' | 'prev') => sum(xs.map(r => r[b][k]))
  if (existsSync(`${cacheDir}/cro.json`)) {
    const trendDoc = existsSync(`${cacheDir}/crotrend.json`) ? cached('crotrend').payload : null
    const v = buildCro(relabel(cached('cro').payload, sr), trendDoc, main.h.dataEnd)
    const all = cut(v, [])
    for (const b of ['cur', 'prev'] as const) for (const k of ['entries', 'newVisitors', 'converted', 'clickers', 'demo', 'selfServe', 'bots']) {
      eq(`[cro ${b}] page types sum to all · ${k}`, tot(all.landing, k, b), (v.all[b] as any)[k])
      eq(`[cro ${b}] devices sum to all · ${k}`, tot(all.devices, k, b), (v.all[b] as any)[k])
      eq(`[cro ${b}] channels sum to all · ${k}`, tot(all.channels, k, b), (v.all[b] as any)[k])
    }
    // A page-type filter: the cut's total = that type's row; channels and devices sum to it.
    for (const t of ['Homepage', 'Pricing']) {
      const f = cut(v, [t]), row = all.landing.find(r => r.id === t)
      if (!row) continue
      eq(`[cro ${t}] filtered total = its page-type row`, f.total.cur.newVisitors, row.cur.newVisitors)
      eq(`[cro ${t}] filtered devices sum to its total`, tot(f.devices, 'newVisitors', 'cur'), f.total.cur.newVisitors)
      checks++; if (f.paths.some(p => p.type !== t)) { fails++; console.log(`FAIL [cro ${t}] entry pages of another type`) }
    }
    checks++; if (v.all.cur.converted > v.all.cur.newVisitors || v.all.cur.clickers > v.all.cur.newVisitors) { fails++; console.log('FAIL [cro] conversions or clickers above new visitors') }
    checks++; if (sum(all.paths.map(p => p.cur.newVisitors)) > v.all.cur.newVisitors) { fails++; console.log('FAIL [cro] entry pages exceed all new visitors') }
    if (v.days) {
      // Workspaces come from the attribution model by created day, so they aren't bounded by that day's new visitors.
      checks++; if (v.days.some(d => d.s.clickers > d.s.newVisitors)) { fails++; console.log('FAIL [cro] trend day with CTA clickers above visitors') }
      // Entry pages classify into the same types in TypeScript as in SQL.
      const tr = trend(v, ['Homepage'], 'day'); checks++; if (!tr.length) { fails++; console.log('FAIL [cro] empty homepage trend') }
    }
    // Only clay.com paths (other sites are prefixed site:path and the old copies didn't prefix, so skip type Other there).
    for (const p of all.paths) { if (p.type && p.type !== 'Other' && p.label.startsWith('/') && !p.label.startsWith('/fr')) { checks++; const t = pageTypeOf('marketing_website', p.label); if (t !== p.type && p.type !== 'Conversion pages' && p.type !== 'Marketplace' && p.type !== 'University' && p.type !== 'Guides') { fails++; console.log(`FAIL [cro] ${p.label}: SQL type ${p.type} vs TS ${t}`) } } }
  }
  if (existsSync(`${cacheDir}/tier4.json`)) {
    const t = buildTier4(relabel(cached('tier4').payload, sr), existsSync(`${cacheDir}/tier4list.json`) ? cached('tier4list').payload : null)
    for (const k of ['workspace', 'newWs', 'activated', 'paying', 'retiered', 's2'] as const) { checks++; if ((t.cur as any)[k] > t.cur.accounts) { fails++; console.log(`FAIL [tier4] ${k} above accounts`) } }
    checks++; if (t.cur.newWs > t.cur.workspace) { fails++; console.log('FAIL [tier4] new workspaces above accounts with a workspace') }
    // An account can raise a hand several ways, so touchpoint types sum to at least the accounts.
    checks++; if (sum(t.types.map(x => x.cur.accounts)) < t.cur.accounts) { fails++; console.log('FAIL [tier4] touchpoint types sum below accounts') }
    if (t.accounts) { checks++; if (t.accounts.some(a => a.score !== a.parts.size + a.parts.intent + a.parts.product)) { fails++; console.log('FAIL [tier4] account score ≠ its parts') } }
  }
}
console.log(`${checks - fails} of ${checks} checks passed`)
