#!/usr/bin/env node
/**
 * AEO sync: the AEO Supabase project's daily cache tables → the AI visibility tab's documents (db collection `aeo`).
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/sync-aeo.mjs <out.json> [--weeks 26]
 *
 * Env (or files of the same name in PORTFOLIO_SECRETS_DIR): AEO_SUPABASE_URL, AEO_SUPABASE_KEY (the publishable key;
 * the aeo_cache_* tables are readable with it). Writes {docs: [{path, data}]}: aeo/slice-* first, aeo/meta last.
 * docs/aeo-tab.md has the shape and the definitions.
 *
 * Weeks: Monday-start. Until Oct 30, 2026 every prompt ran daily; since Nov 2 it runs once each Monday. Each week's
 * counts are averaged per run day (summed, then divided by the number of days that platform × prompt type ran that
 * week), so a week always means one run of every prompt and counts stay comparable across the cadence change. Rates
 * are unchanged by this (numerator and denominator divide by the same number).
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const out = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--weeks')
const WEEKS = Number(args[args.indexOf('--weeks') + 1] || 26) || 26
if (!out) { console.error('usage: sync-aeo.mjs <out.json> [--weeks 26]'); process.exit(2) }

function secret(name) {
  const v = process.env[name] || (process.env.PORTFOLIO_SECRETS_DIR && existsSync(join(process.env.PORTFOLIO_SECRETS_DIR, name))
    ? readFileSync(join(process.env.PORTFOLIO_SECRETS_DIR, name), 'utf8') : '')
  if (!v.trim()) { console.error(`missing ${name} (env or PORTFOLIO_SECRETS_DIR/${name})`); process.exit(2) }
  return v.trim()
}
const URL_ = secret('AEO_SUPABASE_URL').replace(/\/$/, ''), KEY = secret('AEO_SUPABASE_KEY')
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function page(table, query, from, to) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${URL_}/rest/v1/${table}?${query}`, { headers: { ...H, Range: `${from}-${to}`, 'Range-Unit': 'items' } })
    if (r.ok) return r.json()
    if (attempt >= 4) throw new Error(`${table}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
    await new Promise(res => setTimeout(res, 1000 * attempt))
  }
}
/** Every row of a filtered table, 1,000 at a time, 6 pages in flight. */
async function all(table, query) {
  const rows = [], N = 1000
  for (let base = 0; ; base += N * 6) {
    const pages = await Promise.all(Array.from({ length: 6 }, (_, i) => page(table, query, base + i * N, base + (i + 1) * N - 1)))
    for (const p of pages) rows.push(...p)
    if (pages.some(p => p.length < N)) return rows
  }
}

const monday = d => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
const t0 = Date.now()

// 1. The weeks: the last WEEKS Mondays that have a run.
const daily = await all('aeo_cache_daily', 'select=*&order=run_day.desc')
const weeksAll = [...new Set(daily.map(r => monday(r.run_day)))].sort()
const weeks = weeksAll.slice(-WEEKS)
const since = weeks[0]
const wi = Object.fromEntries(weeks.map((w, i) => [w, i]))
const LEAF = { ChatGPT: 'chatgpt', Claude: 'claude' }, TYPE = { Benchmark: 'benchmark', Branded: 'branded' }
const leafOf = r => (LEAF[r.platform] && TYPE[r.prompt_type] ? `${LEAF[r.platform]}-${TYPE[r.prompt_type]}` : null)

// Run days per leaf × week: the divisor that turns a week of daily runs into one run.
const days = {}
for (const r of daily) { const l = leafOf(r), w = monday(r.run_day); if (!l || !(w in wi)) continue; ((days[l] ??= {})[w] ??= new Set()).add(r.run_day) }
const div = (l, w) => days[l]?.[w]?.size || 1

const filt = `run_day=gte.${since}`
const [comp, dom, pmm, topic] = await Promise.all([
  all('aeo_cache_competitors', `select=run_day,platform,prompt_type,competitor_name,mention_count&${filt}&mention_count=gte.10`),
  all('aeo_cache_domains', `select=run_day,platform,prompt_type,domain,citation_type,response_count&${filt}&response_count=gte.10`),
  all('aeo_cache_pmm', `select=run_day,platform,prompt_type,pmm_use_case,total_responses,clay_mentioned&${filt}`),
  all('aeo_cache_topics', `select=run_day,platform,prompt_type,topic,total_responses,clay_mentioned&${filt}`),
])
console.log(`read: daily ${daily.length}, competitors ${comp.length}, domains ${dom.length}, pmm ${pmm.length}, topics ${topic.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)

// 2. Leaf slices (platform × prompt type), counts summed per week then divided by run days.
const n = weeks.length
const zeros = () => new Array(n).fill(0)
const leaves = {}
const leaf = l => (leaves[l] ??= { w: Array.from({ length: n }, () => new Array(11).fill(0)), comp: {}, dom: {}, pmm: {}, topic: {} })
for (const r of daily) {
  const l = leafOf(r), w = monday(r.run_day); if (!l || !(w in wi)) continue
  const row = leaf(l).w[wi[w]]
  const v = [r.total_responses, r.clay_mentioned, r.clay_cited_responses, r.total_with_citations, r.sum_position, r.count_position,
    r.positive_sentiment, r.neutral_sentiment, r.negative_sentiment, r.claygent_mentioned, r.clay_followup]
  v.forEach((x, i) => { row[i] += Number(x) || 0 })
}
const addTo = (rec, key, w, val) => { (rec[key] ??= zeros())[wi[w]] += val }
const addPair = (rec, key, w, t, m) => { const p = (rec[key] ??= [zeros(), zeros()]); p[0][wi[w]] += t; p[1][wi[w]] += m }
const typeVotes = {}
// Brand names as the scorer wrote them: merge spellings of one brand, drop Clay's own products (Clay is its own row).
const ALIAS = { 'apollo.io': 'Apollo', 'hunter.io': 'Hunter', 'sales navigator': 'LinkedIn Sales Navigator', 'zoominfo sales': 'ZoomInfo', 'hubspot crm': 'HubSpot' }
const OWN = /^(clay|claygent|clay mcp|clay\.com)$/i
const brand = name => { const k = name.trim(); return ALIAS[k.toLowerCase()] ?? k }
// Spellings of one brand can appear in the same answer, so merged spellings take the larger daily count, never the sum.
const spell = {}
for (const r of comp) {
  const l = leafOf(r), w = monday(r.run_day); if (!l || !(w in wi) || !r.competitor_name || OWN.test(r.competitor_name.trim())) continue
  const b = brand(r.competitor_name), k = `${l}|${r.run_day}|${b}`
  spell[k] = Math.max(spell[k] ?? 0, r.mention_count)
}
for (const [k, v] of Object.entries(spell)) { const [l, day, b] = k.split('|'); addTo(leaf(l).comp, b, monday(day), v) }
for (const r of dom) {
  const l = leafOf(r), w = monday(r.run_day); if (!l || !(w in wi) || !r.domain) continue
  const d = r.domain.trim().toLowerCase().replace(/^www\./, '')
  addTo(leaf(l).dom, d, w, r.response_count)
  if (r.citation_type) ((typeVotes[d] ??= {})[r.citation_type] = (typeVotes[d][r.citation_type] ?? 0) + r.response_count)
}
for (const r of pmm) { const l = leafOf(r), w = monday(r.run_day); if (l && w in wi && r.pmm_use_case) addPair(leaf(l).pmm, r.pmm_use_case.trim(), w, r.total_responses, r.clay_mentioned) }
for (const r of topic) { const l = leafOf(r), w = monday(r.run_day); if (l && w in wi && r.topic) addPair(leaf(l).topic, r.topic.trim(), w, r.total_responses, r.clay_mentioned) }

for (const [l, s] of Object.entries(leaves)) {
  const k = i => div(l, weeks[i])
  s.w = s.w.map((row, i) => row.map(x => Math.round(x / k(i))))
  for (const rec of [s.comp, s.dom]) for (const a of Object.values(rec)) a.forEach((x, i) => { a[i] = Math.round(x / k(i)) })
  for (const rec of [s.pmm, s.topic]) for (const p of Object.values(rec)) for (const a of p) a.forEach((x, i) => { a[i] = Math.round(x / k(i)) })
}

// 3. Keep the entities worth showing (ranked over all leaves), so every document stays small.
const isClayDomain = d => /(^|\.)clay\.com$/.test(d)
const rank = (pick, top, keep = () => false) => {
  const tot = {}
  for (const s of Object.values(leaves)) for (const [k, a] of Object.entries(pick(s))) tot[k] = (tot[k] ?? 0) + (Array.isArray(a[0]) ? a[0] : a).reduce((x, y) => x + y, 0)
  const names = Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([k]) => k)
  return new Set([...names.slice(0, top), ...names.filter(keep)])
}
const keepComp = rank(s => s.comp, 40)
const keepDom = rank(s => s.dom, 40, isClayDomain)
const keepTopic = rank(s => s.topic, 60)
const only = (rec, set) => Object.fromEntries(Object.entries(rec).filter(([k]) => set.has(k)))
for (const s of Object.values(leaves)) {
  s.comp = only(s.comp, keepComp); s.dom = only(s.dom, keepDom); s.topic = only(s.topic, keepTopic)
}

// 4. 'all' slices: sums of the leaves.
const sumSlices = list => {
  const o = { w: Array.from({ length: n }, () => new Array(11).fill(0)), comp: {}, dom: {}, pmm: {}, topic: {} }
  for (const s of list) {
    s.w.forEach((row, i) => row.forEach((x, j) => { o.w[i][j] += x }))
    for (const f of ['comp', 'dom']) for (const [k, a] of Object.entries(s[f])) { const t = (o[f][k] ??= zeros()); a.forEach((x, i) => { t[i] += x }) }
    for (const f of ['pmm', 'topic']) for (const [k, p] of Object.entries(s[f])) { const t = (o[f][k] ??= [zeros(), zeros()]); p.forEach((a, j) => a.forEach((x, i) => { t[j][i] += x })) }
  }
  return o
}
const L = id => leaves[id] ?? sumSlices([])
const slices = { ...Object.fromEntries(['chatgpt-benchmark', 'claude-benchmark', 'chatgpt-branded', 'claude-branded'].map(id => [id, L(id)])) }
slices['chatgpt-all'] = sumSlices([L('chatgpt-benchmark'), L('chatgpt-branded')])
slices['claude-all'] = sumSlices([L('claude-benchmark'), L('claude-branded')])
slices['all-benchmark'] = sumSlices([L('chatgpt-benchmark'), L('claude-benchmark')])
slices['all-branded'] = sumSlices([L('chatgpt-branded'), L('claude-branded')])
slices['all-all'] = sumSlices([slices['chatgpt-all'], slices['claude-all']])

// 5. Checks: a count never exceeds its denominator, and the latest week isn't a partial batch.
for (const [id, s] of Object.entries(slices)) {
  s.w.forEach((r, i) => { if (r[1] > r[0] || r[2] > r[3] || r[3] > r[0]) { console.error(`${id} ${weeks[i]}: a count exceeds its denominator`); process.exit(3) } })
}
const last = slices['all-all'].w[n - 1][0], prev = slices['all-all'].w[n - 2]?.[0]
if (prev && last < prev * 0.8) console.warn(`warning: the latest week (${weeks[n - 1]}) has ${last} responses vs ${prev} the week before (partial batch?)`)

// 6. Cited URLs under the kept domains (aeo_cache_domain_urls), per leaf × week, averaged per run day like the rest.
//    Top 15 URLs per domain, ranked over all leaves. Titles and URL types go in aeo/urlinfo.
const domList = [...keepDom]
const urlRows = []
for (let i = 0; i < domList.length; i += 10) {
  const inList = domList.slice(i, i + 10).map(d => `"${d.replace(/"/g, '')}"`).join(',')
  urlRows.push(...await all('aeo_cache_domain_urls', `select=run_day,platform,prompt_type,domain,url,title,url_type,url_count&${filt}&url_count=gte.2&domain=in.(${encodeURIComponent(inList)})`))
}
const urlTot = {}, urlInfo = {}, urlLeaf = {}
for (const r of urlRows) {
  const l = leafOf(r), w = monday(r.run_day); if (!l || !(w in wi) || !r.url) continue
  const d = r.domain.trim().toLowerCase().replace(/^www\./, '')
  if (!keepDom.has(d)) continue
  const u = r.url.trim()
  urlTot[d] ??= {}; urlTot[d][u] = (urlTot[d][u] ?? 0) + r.url_count
  if (!urlInfo[u] && (r.title || r.url_type)) urlInfo[u] = [String(r.title ?? '').slice(0, 160), r.url_type ?? '']
  const rec = ((urlLeaf[l] ??= {})[d] ??= {}); (rec[u] ??= zeros())[wi[w]] += r.url_count
}
const keepUrl = Object.fromEntries(Object.entries(urlTot).map(([d, m]) => [d, new Set(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([u]) => u))]))
const urlSlice = {}
for (const l of Object.keys(leaves)) {
  const o = {}
  for (const [d, m] of Object.entries(urlLeaf[l] ?? {})) for (const [u, a] of Object.entries(m)) if (keepUrl[d]?.has(u)) (o[d] ??= {})[u] = a.map((x, i) => Math.round(x / div(l, weeks[i])))
  urlSlice[l] = o
}
const sumUrls = list => { const o = {}; for (const s of list) for (const [d, m] of Object.entries(s)) for (const [u, a] of Object.entries(m)) { const t = ((o[d] ??= {})[u] ??= zeros()); a.forEach((x, i) => { t[i] += x }) } return o }
const U = id => urlSlice[id] ?? {}
const urls = { 'chatgpt-benchmark': U('chatgpt-benchmark'), 'claude-benchmark': U('claude-benchmark'), 'chatgpt-branded': U('chatgpt-branded'), 'claude-branded': U('claude-branded') }
urls['chatgpt-all'] = sumUrls([U('chatgpt-benchmark'), U('chatgpt-branded')]); urls['claude-all'] = sumUrls([U('claude-benchmark'), U('claude-branded')])
urls['all-benchmark'] = sumUrls([U('chatgpt-benchmark'), U('claude-benchmark')]); urls['all-branded'] = sumUrls([U('chatgpt-branded'), U('claude-branded')])
urls['all-all'] = sumUrls([urls['chatgpt-all'], urls['claude-all']])
const keptUrls = new Set(Object.values(keepUrl).flatMap(s => [...s]))
const urlInfoKept = Object.fromEntries(Object.entries(urlInfo).filter(([u]) => keptUrls.has(u)))

// 7. Narratives: the themes each answer attaches to Clay (responses.themes: [{theme, sentiment, snippet}]), counted as
//    answers per (theme, sentiment) per week. One run day per week (the earliest that week, i.e. the Monday batch since
//    Nov 2) so a week is one run of every prompt. Top 40 themes per sentiment per leaf; newest 6 snippets each.
const runDay = {}
for (const r of daily) { const w = monday(r.run_day); if (w in wi && (!runDay[w] || r.run_day < runDay[w])) runDay[w] = r.run_day }
const dayList = Object.values(runDay).sort()
const themed = []
for (let i = 0; i < dayList.length; i += 4) {
  themed.push(...await all('responses', `select=run_day,platform,prompt_type,topic,themes&run_day=in.(${dayList.slice(i, i + 4).join(',')})&themes=neq.[]`))
}
const SENTS = ['Negative', 'Neutral', 'Positive']
const normTheme = t => String(t ?? '').trim().replace(/\s+/g, ' ')
const narrLeaf = {}
for (const r of themed) {
  const l = leafOf(r), w = monday(r.run_day); if (!l || !(w in wi) || !Array.isArray(r.themes)) continue
  const seen = new Set()
  for (const t of r.themes) {
    const name = normTheme(t?.theme), s = SENTS.find(x => x.toLowerCase() === String(t?.sentiment ?? '').toLowerCase())
    if (!name || !s) continue
    const key = `${s}|${name.toLowerCase()}`
    const rec = ((narrLeaf[l] ??= {})[key] ??= { name, s, n: zeros(), snip: [] })
    if (!seen.has(key)) { rec.n[wi[w]] += 1; seen.add(key) }
    const text = String(t?.snippet ?? '').trim()
    if (text) rec.snip.push({ t: text.length > 280 ? text.slice(0, 277) + '…' : text, p: r.platform, tp: r.topic ?? '', d: r.run_day })
  }
}
const trimNarr = (m, per = 40) => {
  const o = {}
  for (const s of SENTS) {
    const rows = Object.entries(m).filter(([, v]) => v.s === s).sort((a, b) => b[1].n.reduce((x, y) => x + y, 0) - a[1].n.reduce((x, y) => x + y, 0)).slice(0, per)
    for (const [k, v] of rows) {
      const seen = new Set(), snip = []
      for (const x of v.snip.sort((a, b) => b.d.localeCompare(a.d))) { const sig = x.t.toLowerCase(); if (seen.has(sig)) continue; seen.add(sig); snip.push(x); if (snip.length >= 6) break }
      o[k] = { name: v.name, s: v.s, n: v.n, snip }
    }
  }
  return o
}
const mergeNarr = list => {
  const o = {}
  for (const m of list) for (const [k, v] of Object.entries(m)) {
    const t = (o[k] ??= { name: v.name, s: v.s, n: zeros(), snip: [] }); v.n.forEach((x, i) => { t.n[i] += x }); t.snip.push(...v.snip)
  }
  return o
}
const N = id => narrLeaf[id] ?? {}
const narrRaw = { 'chatgpt-benchmark': N('chatgpt-benchmark'), 'claude-benchmark': N('claude-benchmark'), 'chatgpt-branded': N('chatgpt-branded'), 'claude-branded': N('claude-branded') }
narrRaw['chatgpt-all'] = mergeNarr([N('chatgpt-benchmark'), N('chatgpt-branded')]); narrRaw['claude-all'] = mergeNarr([N('claude-benchmark'), N('claude-branded')])
narrRaw['all-benchmark'] = mergeNarr([N('chatgpt-benchmark'), N('claude-benchmark')]); narrRaw['all-branded'] = mergeNarr([N('chatgpt-branded'), N('claude-branded')])
narrRaw['all-all'] = mergeNarr([narrRaw['chatgpt-all'], narrRaw['claude-all']])
const narr = Object.fromEntries(Object.entries(narrRaw).map(([k, v]) => [k, trimNarr(v)]))
console.log(`urls: ${urlRows.length} rows, ${keptUrls.size} kept · narratives: ${themed.length} answers with themes on ${dayList.length} run days`)

const domType = Object.fromEntries(Object.entries(typeVotes).filter(([d]) => keepDom.has(d)).map(([d, v]) => [d, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]))
const meta = { version: 1, syncedAt: new Date().toISOString(), weeks, domType, clayDomains: [...keepDom].filter(isClayDomain), slices: Object.keys(slices),
  cadence: { dailyUntil: '2026-10-30', note: 'Weeks before Nov 2 averaged per run day' }, narrDays: runDay, urls: true, narratives: true }
const docs = [...Object.entries(slices).map(([id, s]) => ({ path: `aeo/slice-${id}`, data: s })),
  ...Object.entries(urls).map(([id, u]) => ({ path: `aeo/urls-${id}`, data: { u } })),
  ...Object.entries(narr).map(([id, t]) => ({ path: `aeo/narr-${id}`, data: { t } })),
  { path: 'aeo/urlinfo', data: { i: urlInfoKept } }, { path: 'aeo/meta', data: meta }]
for (const d of docs) { const b = Buffer.byteLength(JSON.stringify(d.data)); if (b > 250_000) { console.error(`${d.path} is ${b} bytes (cap 262144)`); process.exit(2) } }
writeFileSync(out, JSON.stringify({ docs }))
const a = slices['all-benchmark'].w[n - 1]
console.log(`weeks ${weeks[0]} → ${weeks[n - 1]} · latest Benchmark week: ${a[0]} responses, visibility ${(a[1] / a[0] * 100).toFixed(1)}% · ${docs.length} docs → ${out} (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
