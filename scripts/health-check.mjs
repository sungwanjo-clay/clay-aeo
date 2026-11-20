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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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

const checks = []
const add = (id, level, ok, detail) => checks.push({ id, level, ok, detail })   // level: 'alert' (broken) or 'warn'

// 1. Saved 7-day views (daily scheduled refresh, 5:37 AM PT): each copy no older than 30 hours, data no older than 3 days.
for (const name of ['main', 'social', 'startup']) {
  const h = read('cache', name)
  if (!h) { add(`cache_${name}`, 'alert', false, `Saved ${name} view is missing`); continue }
  const age = hours(h.storedAt)
  add(`cache_${name}`, 'alert', age <= 30, `Saved ${name} view refreshed ${age.toFixed(0)} h ago (data through ${h.dataEnd})`)
  if (h.dataEnd) add(`cache_${name}_data`, 'warn', days(h.dataEnd + 'T23:59:59Z') <= 3, `Saved ${name} view has data through ${h.dataEnd}`)
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
  const firms = d => new Set((meta.firmRows ?? []).filter(r => r.snapshot_date === d).map(r => r.firm_id)).size
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
