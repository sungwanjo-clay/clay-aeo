/**
 * Generated SAMPLE data for the AEO tab, shown (with a "Sample data" label) until scripts/sync-aeo.mjs has written the
 * real snapshot. Shaped like the real thing and anchored on the levels in the migration brief (Benchmark visibility
 * ChatGPT ~42%, Claude ~61%; ~5,000 responses a week; the Nov 16 competitor and domain shares). Deterministic, so
 * screenshots and tests are stable. None of these numbers are real.
 */
import { AEO_PLATFORMS, AEO_PROMPT_TYPES, sliceId, type AeoData, type AeoMeta, type AeoSlice, type WeekRow } from './data'

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 } }

const WEEKS = 26
const LAST = '2026-11-16'
const COMPETITORS: [string, number][] = [['HubSpot', 0.40], ['Apollo', 0.36], ['ZoomInfo', 0.31], ['Salesforce', 0.27], ['LinkedIn', 0.26],
  ['Cognism', 0.15], ['Lusha', 0.13], ['Outreach', 0.11], ['Smartlead', 0.10], ['6sense', 0.08], ['Instantly', 0.07], ['Seamless.AI', 0.05]]
const DOMAINS: [string, number, string][] = [['pipeline.zoominfo.com', 0.21, 'Competitor'], ['clay.com', 0.17, 'Owned'], ['apollo.io', 0.15, 'Competitor'],
  ['knowledge.hubspot.com', 0.14, 'Competitor'], ['ftc.gov', 0.13, 'Reference'], ['knowledge.apollo.io', 0.13, 'Competitor'], ['g2.com', 0.12, 'Review'],
  ['reddit.com', 0.10, 'Community'], ['linkedin.com', 0.09, 'Social'], ['salesforce.com', 0.08, 'Competitor'], ['cognism.com', 0.07, 'Competitor'],
  ['university.clay.com', 0.05, 'Owned'], ['youtube.com', 0.05, 'Video'], ['gartner.com', 0.04, 'Analyst']]
const PMM: [string, number, number][] = [['Data Enrichment & Quality', 0.22, 0.61], ['Prospecting & Lead Generation', 0.2, 0.55],
  ['Outbound & Sequencing', 0.14, 0.44], ['Signals & Intent', 0.11, 0.52], ['CRM Hygiene & Ops', 0.1, 0.48], ['AI Research Agents', 0.09, 0.66],
  ['Account-Based Marketing', 0.08, 0.39], ['Inbound Lead Routing', 0.06, 0.42], ['Event Campaigns', 0.02, 0.3]]
const TOPICS: [string, number, number][] = [['lead enrichment', 0.12, 0.62], ['email finding', 0.09, 0.51], ['waterfall enrichment', 0.05, 0.83],
  ['intent data', 0.07, 0.45], ['prospect list building', 0.08, 0.57], ['cold email tools', 0.07, 0.33], ['CRM data cleaning', 0.06, 0.47],
  ['AI SDR', 0.05, 0.4], ['company research', 0.06, 0.64], ['technographics', 0.04, 0.5], ['phone numbers', 0.04, 0.36],
  ['job change signals', 0.04, 0.58], ['ABM platforms', 0.04, 0.31], ['web scraping for sales', 0.04, 0.6], ['GTM engineering', 0.05, 0.78],
  ['data providers comparison', 0.06, 0.44], ['lead scoring', 0.04, 0.38], ['LinkedIn automation', 0.03, 0.29]]

function mondays(): string[] {
  const end = new Date(LAST + 'T00:00:00Z'), out: string[] = []
  for (let i = WEEKS - 1; i >= 0; i--) { const d = new Date(end); d.setUTCDate(d.getUTCDate() - 7 * i); out.push(d.toISOString().slice(0, 10)) }
  return out
}

function base(platform: 'ChatGPT' | 'Claude', type: 'Benchmark' | 'Branded', seed: number): AeoSlice {
  const r = rng(seed)
  const n = type === 'Benchmark' ? 2120 : 376
  const vis = type === 'Branded' ? 0.97 : platform === 'ChatGPT' ? 0.42 : 0.61
  const citShare = platform === 'ChatGPT' ? 0.78 : 0.55
  const w: WeekRow[] = [], comp: AeoSlice['comp'] = {}, dom: AeoSlice['dom'] = {}, pmm: AeoSlice['pmm'] = {}, topic: AeoSlice['topic'] = {}
  for (const [c] of COMPETITORS) comp[c] = []
  for (const [d] of DOMAINS) dom[d] = []
  for (const [p] of PMM) pmm[p] = [[], []]
  for (const [t] of TOPICS) topic[t] = [[], []]
  for (let i = 0; i < WEEKS; i++) {
    const trend = (i - WEEKS / 2) / WEEKS * 0.04          // a slow climb over the half year
    const j = () => (r() - 0.5) * 0.03
    const total = n + Math.round((r() - 0.5) * 12)
    const v = Math.min(0.99, vis + (type === 'Branded' ? 0 : trend) + j())
    const mentioned = Math.round(total * v)
    const withCit = Math.round(total * (citShare + j()))
    const cited = Math.round(withCit * (type === 'Branded' ? 0.48 : 0.25 + trend * 0.6 + j()))
    const cntPos = mentioned, sumPos = Math.round(cntPos * (type === 'Branded' ? 1.6 : 4.4 - trend * 5 + j() * 4))
    const pos = Math.round(mentioned * (0.72 + j())), neg = Math.round(mentioned * (0.015 + j() / 6)), neu = mentioned - pos - neg
    const claygent = Math.round(total * (platform === 'Claude' ? 0.42 : 0.24) * (1 + trend * 3 + j()))
    const followup = Math.round(mentioned * (0.53 + j()))
    w.push([total, mentioned, cited, withCit, sumPos, cntPos, pos, neu, neg, claygent, followup])
    for (const [c, s] of COMPETITORS) comp[c].push(Math.round(total * Math.max(0, s * (platform === 'Claude' ? 0.9 : 1.1) + j() - (c === 'ZoomInfo' && i > WEEKS - 3 ? 0.08 : 0))))
    for (const [d, s] of DOMAINS) dom[d].push(d.endsWith('clay.com') ? Math.round(cited * (d === 'clay.com' ? 1 : 0.3)) : Math.round(withCit * Math.max(0, s + j())))
    for (const [p, s, cv] of PMM) { const t = Math.round(total * s); pmm[p][0].push(t); pmm[p][1].push(Math.round(t * Math.min(0.99, type === 'Branded' ? 0.96 : cv * (vis / 0.52) + trend + j()))) }
    for (const [tp, s, cv] of TOPICS) { const t = Math.round(total * s); topic[tp][0].push(t); topic[tp][1].push(Math.round(t * Math.min(0.99, type === 'Branded' ? 0.96 : cv * (vis / 0.52) + trend + j()))) }
  }
  return { w, comp, dom, pmm, topic }
}

function add(a: AeoSlice, b: AeoSlice): AeoSlice {
  const v = (x: number[], y: number[]) => x.map((n, i) => n + (y[i] ?? 0))
  const rec = <T,>(x: Record<string, T>, y: Record<string, T>, f: (p: T, q: T) => T) =>
    Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map(k => [k, x[k] && y[k] ? f(x[k], y[k]) : (x[k] ?? y[k])]))
  return {
    w: a.w.map((r, i) => v(r, b.w[i])),
    comp: rec(a.comp, b.comp, v), dom: rec(a.dom, b.dom, v),
    pmm: rec(a.pmm, b.pmm, (p, q) => [v(p[0], q[0]), v(p[1], q[1])]),
    topic: rec(a.topic, b.topic, (p, q) => [v(p[0], q[0]), v(p[1], q[1])]),
  }
}

export function sampleAeo(): AeoData {
  const leaf = {
    'chatgpt-benchmark': base('ChatGPT', 'Benchmark', 11), 'claude-benchmark': base('Claude', 'Benchmark', 23),
    'chatgpt-branded': base('ChatGPT', 'Branded', 37), 'claude-branded': base('Claude', 'Branded', 41),
  } as Record<string, AeoSlice>
  const slices: Record<string, AeoSlice> = { ...leaf }
  slices['chatgpt-all'] = add(leaf['chatgpt-benchmark'], leaf['chatgpt-branded'])
  slices['claude-all'] = add(leaf['claude-benchmark'], leaf['claude-branded'])
  slices['all-benchmark'] = add(leaf['chatgpt-benchmark'], leaf['claude-benchmark'])
  slices['all-branded'] = add(leaf['chatgpt-branded'], leaf['claude-branded'])
  slices['all-all'] = add(slices['chatgpt-all'], slices['claude-all'])
  const meta: AeoMeta = {
    version: 1, syncedAt: LAST + 'T12:00:00Z', sample: true, weeks: mondays(),
    domType: Object.fromEntries(DOMAINS.map(([d, , t]) => [d, t])), clayDomains: ['clay.com', 'university.clay.com'],
    slices: AEO_PLATFORMS.flatMap(p => AEO_PROMPT_TYPES.map(t => sliceId(p, t))),
  }
  return { meta, slices }
}
