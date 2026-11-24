#!/usr/bin/env node
/**
 * Daily health check for the PLG dashboard's data. Reads documents already downloaded from the artifact db
 * (ArtifactData get/list with out_dir → <dir>/<collection>/<doc_id>.json) and writes the verdict to <out>
 * as the `config/health` document. Prints one line per check; exits 0 either way (the verdict is the output).
 *
 *   node scripts/health-check.mjs <download dir> <out.json> [now ISO]
 *
 * Needs no secrets: everything it checks is what viewers see. Clay-side failures are covered by Clay's own
 * alert rules on each workflow (email on any failed run); this catches what those can't: a run that never
 * happened, a sync that wasn't done, a refresh that "succeeded" without writing, or numbers that collapsed.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, out, nowArg] = process.argv.slice(2)
if (!dir || !out) { console.error('usage: health-check.mjs <download dir> <out.json> [now ISO]'); process.exit(2) }
const now = nowArg ? new Date(nowArg) : new Date()
const read = (col, id) => {
  const f = join(dir, col, `${id}.json`)
  if (!existsSync(f)) return null
  const j = JSON.parse(readFileSync(f, 'utf8'))
  return j && typeof j === 'object' && 'data' in j && Object.keys(j).length <= 3 ? j.data : j
}
const hours = iso => (now - new Date(iso)) / 36e5
const days = iso => hours(iso) / 24
const mondayOf = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }

// Channels the YouTube sync covers (scripts/sync-youtube.mjs CHANNELS). Other documents in the collection are left alone.
const CHANNEL_KEYS = new Set(['peter', 'payton', 'eric'])

const checks = []
const add = (id, level, ok, detail) => checks.push({ id, level, ok, detail })   // level: 'alert' (broken) or 'warn'

// 1. Saved views (daily scheduled refresh, 5:37 AM PT). Each copy must be present and whole (every part), fresh (stored in
// the last 30 hours, data no older than 3 days), cover every preset × comparison (a multi-range copy, not a single view a
// page wrote), and pass its data contract (lib/plg/contracts.ts): the right shape, a row for every range, no impossible
// counts. Anything less is what viewers without Sigma would see.
const CACHES = ['main', 'social', 'startup', 'tier4', 'tier4list', 'cro', 'crotrend', 'creators', 'daily']
const RANGED = new Set(['main', 'social', 'startup', 'tier4', 'cro'])
let contracts = null
try {
  const { build } = await import('esbuild')
  const root = new URL('..', import.meta.url).pathname
  const outFile = join(process.env.TMPDIR || '/tmp', `plg-contracts-${process.pid}.mjs`)
  await build({ entryPoints: [join(root, 'lib/plg/contracts.ts')], bundle: true, platform: 'node', format: 'esm', outfile: outFile, logLevel: 'error' })
  contracts = await import(outFile)
} catch (e) { add('contracts_load', 'warn', false, `Couldn’t load the data contracts (${e.message}); contract checks skipped`) }
for (const name of CACHES) {
  const h = read('cache', name)
  if (!h) { add(`cache_${name}`, 'alert', false, `Saved ${name} view is missing`); continue }
  const age = hours(h.storedAt)
  add(`cache_${name}`, 'alert', age <= 30, `Saved ${name} view refreshed ${age.toFixed(0)} h ago (data through ${h.dataEnd})`)
  if (h.dataEnd) add(`cache_${name}_data`, 'warn', days(h.dataEnd + 'T23:59:59Z') <= 3, `Saved ${name} view has data through ${h.dataEnd}`)
  if (RANGED.has(name)) add(`cache_${name}_ranges`, 'alert', (h.ranges?.length ?? 0) >= 10,
    h.ranges?.length ? `Saved ${name} view covers ${h.ranges.length} date ranges` : `Saved ${name} view covers only one view (a page overwrote the daily copy): presets other than the default are blank without Sigma`)
  const parts = Array.from({ length: h.parts ?? 0 }, (_, i) => read('cache', `${name}-${i}`))
  if (!h.parts || parts.some(p => !p || typeof p.s !== 'string')) { add(`cache_${name}_parts`, 'alert', false, `Saved ${name} view is missing parts (${parts.filter(Boolean).length} of ${h.parts ?? 0})`); continue }
  let payload = null
  try { payload = JSON.parse(parts.map(p => p.s).join('')) } catch { add(`cache_${name}_parse`, 'alert', false, `Saved ${name} view doesn’t parse`); continue }
  if (contracts) {
    const v = contracts.validate(name, payload, h.ranges ?? [])
    add(`cache_${name}_contract`, 'alert', v.ok, v.ok ? `Saved ${name} view passes its data checks (${v.rows} rows)` : `Saved ${name} view fails its data checks: ${v.problems.slice(0, 3).join('; ')}`)
  }
}
const ends = [...new Set(CACHES.map(n => read('cache', n)?.dataEnd).filter(Boolean))]
add('cache_dates', 'warn', ends.length <= 1, ends.length <= 1 ? `Saved views agree on the data date (${ends[0] ?? '–'})` : `Saved views disagree on the data date: ${ends.join(', ')}`)

// 1b. YouTube documents (Media properties tab), written by the YouTube sync step of the daily refresh. Only channels
// with an owner sign-in or Viewer access are held to these (Payton's has neither, so it carries no dates).
const ytDir = join(dir, 'youtube')
if (existsSync(ytDir)) {
  for (const f of readdirSync(ytDir).filter(f => f.endsWith('.json'))) {
    const y = read('youtube', f.replace(/\.json$/, ''))
    if (!y?.key || !CHANNEL_KEYS.has(y.key)) continue
    const label = y.title ?? y.key
    add(`yt_${y.key}_sync`, 'alert', hours(y.fetchedAt) <= 30, `YouTube ${label}: synced ${hours(y.fetchedAt).toFixed(0)} h ago`)
    const lastViews = y.analyticsThrough ?? y.daily?.at(-1)?.[0]
    // Analytics normally reports through 2–3 days ago; 5 means YouTube or the sync has stalled.
    if (y.analyticsAccess && lastViews) add(`yt_${y.key}_views`, 'warn', days(lastViews + 'T23:59:59Z') <= 5, `YouTube ${label}: views through ${lastViews}`)
    if (Array.isArray(y.impressionsDaily) && y.impressionsDaily.length) {
      const imp = y.impressionsThrough ?? y.impressionsDaily.map(r => r[0]).sort().at(-1)
      add(`yt_${y.key}_impr`, 'warn', days(imp + 'T23:59:59Z') <= 4, `YouTube ${label}: impressions through ${imp}`)
      // Gaps in the last 28 delivered days (a report Google never sent, or one that failed and had nothing to carry over).
      const have = new Set(y.impressionsDaily.map(r => r[0]))
      const gaps = []
      for (let i = 0; i < 28; i++) { const d = new Date(Date.parse(imp + 'T00:00:00Z') - i * 864e5).toISOString().slice(0, 10); if (d >= y.impressionsDaily[0][0] && !have.has(d)) gaps.push(d) }
      add(`yt_${y.key}_gaps`, 'warn', gaps.length === 0, gaps.length ? `YouTube ${label}: impressions missing for ${gaps.join(', ')}` : `YouTube ${label}: no missing impression days`)
    }
  }
} else add('yt_sync', 'alert', false, 'YouTube documents were not downloaded')

// 1d. Content insights: the weekly niche scan (youtube/scan). Weekly, so 8 days without one is a warning.
const sc = existsSync(ytDir) ? read('youtube', 'scan') : null
add('scan_sync', 'warn', !!sc && hours(sc.fetchedAt) <= 8 * 24, sc ? `Content insights: niche scan from ${String(sc.fetchedAt).slice(0, 10)}${sc.partial ? ' (partial: YouTube quota ran out)' : ''}` : 'Content insights: no niche scan yet')
if (sc?.partial) add('scan_partial', 'warn', false, 'Content insights: the last niche scan is partial (YouTube quota ran out)')

// 1c. Content insights: the creator program list (youtube/creators, scripts/sync-creators.mjs). The sheet half is a manual
// export for now, so this only warns: a week without a re-sync means new videos and links are missing from the tab.
const cr = existsSync(ytDir) ? read('youtube', 'creators') : null
if (!cr) add('creators_sync', 'warn', false, 'Content insights: the creator program list has never been synced')
else {
  add('creators_sync', 'warn', hours(cr.fetchedAt) <= 8 * 24, `Content insights: creator list synced ${(hours(cr.fetchedAt) / 24).toFixed(0)} days ago`)
  const missing = Array.from({ length: cr.thumbParts ?? 0 }, (_, i) => read('youtube', `creators-thumbs-${i}`)).filter(x => !x).length
  if (missing) add('creators_thumbs', 'warn', false, `Content insights: ${missing} of ${cr.thumbParts} thumbnail parts missing`)
}

// 2. Portfolio: synced in the last 8 days, latest closed week is this week or last week, every company chunk present.
const meta = read('portfolio', 'meta')
if (!meta) add('portfolio_sync', 'alert', false, 'Portfolio data has never been synced')
else {
  add('portfolio_sync', 'alert', days(meta.syncedAt) <= 8, `Portfolio last synced ${days(meta.syncedAt).toFixed(1)} days ago`)
  const latest = meta.latest?.snapshot_date
  const lastMonday = new Date(mondayOf(now) + 'T00:00:00Z'); lastMonday.setUTCDate(lastMonday.getUTCDate() - 7)
  add('portfolio_week', 'alert', !!latest && latest >= lastMonday.toISOString().slice(0, 10),
    latest ? `Latest closed week is the week of ${latest}` : 'No closed weekly snapshot')
  // The sync writes company chunks before meta, so the last chunk existing means the whole list landed.
  const n = meta.companyChunks ?? 0
  const last = n ? read('portfolio', `companies-${n - 1}`) : null
  add('portfolio_chunks', 'alert', !n || (Array.isArray(last?.rows) && last.rows.length > 0), n ? `Company list: last of ${n} documents ${last ? 'present' : 'missing'}` : 'No company documents')
  // Week over week: firms with a roster and verified companies shouldn't collapse.
  const t = d => meta.totals?.find(r => r.snapshot_date === d && r.cut === 'all')
  const cur = t(latest), prev = meta.previous ? t(meta.previous) : null
  if (cur && prev) add('portfolio_drop', 'warn', cur.portfolio >= prev.portfolio * 0.9, `Verified companies ${prev.portfolio} → ${cur.portfolio} week over week`)
  const firmRows = meta.firmRowChunks
    ? Array.from({ length: meta.firmRowChunks }, (_, i) => read('portfolio', `firmrows-${i}`)?.rows ?? []).flat()
    : meta.firmRows ?? []
  if (meta.firmRowChunks) add('portfolio_firmrows', 'alert', firmRows.length > 0, `Firm rows: ${firmRows.length} across ${meta.firmRowChunks} documents`)
  const firms = d => new Set(firmRows.filter(r => r.snapshot_date === d).map(r => r.firm_id)).size
  if (latest && meta.previous) add('portfolio_firms', 'warn', firms(latest) >= firms(meta.previous) * 0.9, `Firms with a roster ${firms(meta.previous)} → ${firms(latest)}`)
  if (cur) add('portfolio_unknown', 'warn', (cur.workspace_unknown ?? 0) <= cur.portfolio * 0.05,
    `${cur.workspace_unknown ?? 0} companies with an unknown Clay lookup (${((cur.workspace_unknown ?? 0) / Math.max(1, cur.portfolio) * 100).toFixed(1)}%)`)
  // Source runs in the last 8 days: failures are expected occasionally, a high share means a provider or step is broken.
  const src = read('portfolio', 'sources')
  if (src?.runs) {
    const recent = Object.values(src.runs).flatMap(m => Object.values(m)).filter(v => v[2] && days(v[2] + 'T00:00:00Z') <= 8)
    const failed = recent.filter(v => v[0] === 'failed').length
    add('source_runs', 'warn', recent.length === 0 || failed / recent.length <= 0.2, `${failed} of ${recent.length} source runs failed in the last 8 days`)
  }
}

// 3. AI visibility: synced in the last 8 days, and the latest batch is no older than the Monday before last.
const aeo = read('aeo', 'meta')
if (!aeo) add('aeo_sync', 'alert', false, 'AI visibility data has never been synced')
else {
  add('aeo_sync', 'alert', days(aeo.syncedAt) <= 8, `AI visibility last synced ${days(aeo.syncedAt).toFixed(1)} days ago`)
  const lastWeek = aeo.weeks?.[aeo.weeks.length - 1]
  const due = new Date(mondayOf(now) + 'T00:00:00Z'); due.setUTCDate(due.getUTCDate() - 7)
  add('aeo_week', 'warn', !!lastWeek && lastWeek >= due.toISOString().slice(0, 10), lastWeek ? `Latest AI visibility batch is the week of ${lastWeek}` : 'No AI visibility batch')
  const s = read('aeo', 'slice-all-all')
  const w = s?.w ?? [], a = w[w.length - 1]?.[0] ?? 0, b = w[w.length - 2]?.[0] ?? 0
  if (b) add('aeo_batch', 'warn', a >= b * 0.8, `AI visibility responses ${b} → ${a} in the latest batch`)
}

const alerts = checks.filter(c => !c.ok && c.level === 'alert'), warns = checks.filter(c => !c.ok && c.level === 'warn')
const health = {
  version: 1, checkedAt: now.toISOString(),
  status: alerts.length ? 'alert' : warns.length ? 'warn' : 'ok',
  problems: [...alerts, ...warns].map(c => ({ id: c.id, level: c.level, detail: c.detail })),
  checks,
}
writeFileSync(out, JSON.stringify(health))
for (const c of checks) console.log(`${c.ok ? 'ok   ' : c.level === 'alert' ? 'ALERT' : 'WARN '} ${c.detail}`)
console.log(`STATUS ${health.status.toUpperCase()}${health.problems.length ? ': ' + health.problems.map(p => p.detail).join('; ') : ''}`)
