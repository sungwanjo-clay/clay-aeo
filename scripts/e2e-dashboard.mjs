#!/usr/bin/env node
/**
 * End-to-end render test of the built dashboard (dist/plg-artifact.html) against downloaded artifact-db documents, in a
 * real browser (Playwright), the way a viewer without Sigma sees it.
 *
 *   node scripts/e2e-dashboard.mjs <html> <db dir: cache/, youtube/, portfolio/, config/> [--quick]
 *
 * For every tab × date preset × comparison it loads the page and fails on: a page or console error, a section that
 * crashed (error boundary), a data-contract failure, "NaN" / "undefined" / "Infinity" / "[object Object]" anywhere in
 * the text, or a missing section heading. Then it breaks the saved copies on purpose (no database, a corrupt part, a
 * missing part, a result that breaks its contract) and checks the page says so instead of crashing or showing zeros.
 * Exits 1 on any failure.
 */
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Playwright is installed globally in the dev environment (resolved through NODE_PATH, which ESM imports ignore).
const { chromium } = createRequire(import.meta.url)('playwright')

const [html, dbDir, ...flags] = process.argv.slice(2)
if (!html || !dbDir) { console.error('usage: e2e-dashboard.mjs <html> <db dir> [--quick]'); process.exit(2) }
const quick = flags.includes('--quick')
const un = j => (j && typeof j === 'object' && 'data' in j && Object.keys(j).length <= 3 ? j.data : j)
function loadDb(dir) {
  const docs = {}
  for (const col of ['cache', 'youtube', 'portfolio', 'config']) {
    const d = join(dir, col)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d).filter(f => f.endsWith('.json'))) docs[`${col}/${f.slice(0, -5)}`] = un(JSON.parse(readFileSync(join(d, f), 'utf8')))
  }
  return docs
}

const TABS = {
  workspaces: { hash: '', must: ['What moved', 'New workspaces by channel and tier', 'Conversion', 'Tier 4 hand-raisers'] },
  social: { hash: '#social', must: ['What moved'] },
  startup: { hash: '#startup', must: ['What moved', 'Funnel'] },
  portfolio: { hash: '#portfolio', must: [] },
  insights: { hash: '#insights', must: ['videos to make next', 'What we’re learning', 'New this week', 'Videos'] },
}
const PRESETS = quick ? ['last7', 'last28'] : ['last7', 'last28', 'last90', 'qtd', 'ytd']
const COMPARES = quick ? ['previous_period'] : ['previous_period', 'previous_year']
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]/

const browser = await chromium.launch()
let failures = 0, runs = 0
const fail = (where, what) => { failures++; console.log(`FAIL ${where}: ${what}`) }

/** Load the page with `docs` as its database and `qs` as the saved filter state; return what a viewer sees. */
async function visit(docs, hash, qs, wait = 4500) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  const errors = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`) })
  await page.addInitScript(([d, q]) => {
    try { if (q) localStorage.setItem('plg-filters', q) } catch { /* storage blocked */ }
    const snap = k => (d && d[k] ? { exists: true, data: () => d[k] } : { exists: false, data: () => undefined })
    window.claude = { use: async n => (n === 'db' ? (d ? { doc: k => ({ get: async () => snap(k), set: async () => { throw new Error('read-only viewer') } }) } : null) : null) }
  }, [docs, qs])
  await page.goto(`file://${html}${hash}`)
  await page.waitForTimeout(wait)
  const text = await page.locator('body').innerText()
  const heads = await page.locator('h1, h2').allInnerTexts()
  const crashed = await page.locator('[data-section-error]').evaluateAll(els => els.map(e => e.innerText))
  await page.close()
  return { errors, text, heads, crashed }
}

const docs = loadDb(dbDir)
console.log(`db: ${Object.keys(docs).length} documents`)

// 1. Every tab × preset × comparison.
for (const [tab, t] of Object.entries(TABS)) {
  // Portfolio and Content insights ignore the dashboard's dates: one load each.
  const ownDates = tab === 'portfolio' || tab === 'insights'
  for (const preset of ownDates ? ['last7'] : PRESETS) {
    for (const compare of ownDates ? ['previous_period'] : COMPARES) {
      const qs = new URLSearchParams({ preset, ...(compare !== 'previous_period' ? { compare } : {}) }).toString()
      const where = `${tab} · ${preset} · ${compare}`
      const r = await visit(docs, t.hash, qs); runs++
      for (const e of r.errors) fail(where, e)
      for (const c of r.crashed) fail(where, `section crashed: ${c}`)
      const bad = r.text.match(BAD_TEXT); if (bad) fail(where, `text shows "${bad[0]}" near “${r.text.slice(Math.max(0, bad.index - 60), bad.index + 40).replace(/\s+/g, ' ')}”`)
      if (/Data check failed/.test(r.text)) fail(where, `data check failed: ${(r.text.match(/Data check failed[^\n]*/) ?? [''])[0]}`)
      for (const h of t.must) if (!r.heads.some(x => x.includes(h))) fail(where, `missing section “${h}”`)
    }
  }
}

// 2. Broken saved copies: the page must explain, never crash or render zeros.
const clone = () => JSON.parse(JSON.stringify(docs))
const scenarios = [
  ['no database', null, /Clay Sigma|claude\.ai/],
  ['corrupt main part', (() => { const d = clone(); d['cache/main-0'] = { s: '{"columns": [' }; return d })(), /Clay Sigma|claude\.ai/],
  ['missing main part', (() => { const d = clone(); const h = d['cache/main']; if (h) delete d[`cache/main-${(h.parts ?? 1) - 1}`]; return d })(), /Clay Sigma|claude\.ai/],
  ['CRO breaks its contract', (() => {
    const d = clone(); const h = d['cache/cro']
    if (h) { const p = JSON.parse(Array.from({ length: h.parts }, (_, i) => d[`cache/cro-${i}`].s).join('')); p.rows = p.rows.filter(r => r[0] !== 'all'); d['cache/cro-0'] = { s: JSON.stringify(p) }; d['cache/cro'] = { ...h, parts: 1 } }
    return d
  })(), /Data check failed/],
  ['creators breaks its contract', (() => {
    const d = clone(); const h = d['cache/creators']
    if (h) { const p = JSON.parse(Array.from({ length: h.parts }, (_, i) => d[`cache/creators-${i}`].s).join('')); p.rows = p.rows.filter(r => r[0] !== 'w'); d['cache/creators-0'] = { s: JSON.stringify(p) }; d['cache/creators'] = { ...h, parts: 1 } }
    return d
  })(), /Data check failed/, '#insights'],
  ['creator list not synced', (() => { const d = clone(); delete d['youtube/creators']; return d })(), /creator program list isn’t synced/, '#insights'],
  ['no niche scan yet', (() => { const d = clone(); delete d['youtube/scan']; return d })(), /No niche scan yet/, '#insights'],
  // An idea's own link opens its side panel: sources, the brief, the reasons.
  ...(() => { const r = clone()['youtube/scan']?.recs?.[0]; return r ? [['idea link opens its brief', clone(), /Sourced from[\s\S]*The brief[\s\S]*Why each decision/, `#insights-idea=${encodeURIComponent(`${r.theme}:${r.format ?? ''}`)}`]] : [] })(),
  // Scans before Nov 23 have no angles or written briefs per angle: one idea per theme, still a table.
  ['scan without angles', (() => { const d = clone(); const sc = d['youtube/scan']; if (sc) { for (const t of sc.themes) delete t.angles; delete sc.recs; delete sc.prevRecKeys } return d })(), /videos to make next[\s\S]*What we’re learning/, '#insights'],
]
for (const [name, d, expect, hash = ''] of scenarios) {
  const r = await visit(d, hash, '', 4000); runs++
  for (const e of r.errors) fail(`scenario ${name}`, e)
  if (!expect.test(r.text)) fail(`scenario ${name}`, `page didn’t say what’s wrong (expected ${expect})`)
}

await browser.close()
console.log(`${runs} page loads, ${failures} failures`)
process.exit(failures ? 1 : 0)
