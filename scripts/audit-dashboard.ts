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
console.log(`${checks - fails} of ${checks} checks passed`)
