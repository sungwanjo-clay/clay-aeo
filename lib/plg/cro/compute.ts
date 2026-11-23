/**
 * Conversion view model. Pure: Sigma rows (sql.ts), already relabelled to cur / prev for the range rows, in;
 * render-ready numbers out. "New visitors" are first-ever sessions that aren't likely bots and had no workspace;
 * workspaces and new customers are the blended attribution model's (unbounded window, first touch), by the landing
 * page of their attributed session; CTA clicks are within 1 day of the first visit.
 *
 * Every cut is kept by page type, so the section's page-type filter applies to all of it: tiles, channels, devices,
 * entry pages, CTA zones and the trend (`cut(view, types)`).
 */
import { addDays, type ISODate } from '../dates'
import { b, chg, code, driverPara, ratePara, type Block, type Insight, type Item, type Para } from '../insights'
import { PAGE_TYPES } from './pageTypes'

type Row = { k: string; b: string; d: string; n: number; a: number; p: number; x: number; c: number; y: number; z: number; q: number }
export function parseCroRows(payload: unknown): Row[] {
  const t = payload as { columns: string[]; rows: unknown[][] }
  if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(t.columns.map((c, i) => [String(c).toLowerCase(), i]))
  const s = (r: unknown[], c: string) => String(r[ix[c]] ?? '')
  const n = (r: unknown[], c: string) => Number(r[ix[c]] ?? 0) || 0
  return t.rows.map(r => ({ k: s(r, 'k'), b: s(r, 'b'), d: s(r, 'd'), n: n(r, 'n'), a: n(r, 'a'), p: n(r, 'p'), x: n(r, 'x'), c: n(r, 'c'), y: n(r, 'y'), z: n(r, 'z'), q: n(r, 'q') }))
}

/** One segment's entry funnel for a period. */
/** customers: of the converted, workspaces that have paid since (first invoice at any time up to now). */
export type Seg = { entries: number; newVisitors: number; converted: number; customers: number; clickers: number; demo: number; selfServe: number; bots: number }
const zero = (): Seg => ({ entries: 0, newVisitors: 0, converted: 0, customers: 0, clickers: 0, demo: 0, selfServe: 0, bots: 0 })
const seg = (r?: Row): Seg => ({ entries: r?.n ?? 0, newVisitors: r?.a ?? 0, converted: r?.p ?? 0, customers: r?.q ?? 0, clickers: r?.x ?? 0, demo: r?.c ?? 0, selfServe: r?.z ?? 0, bots: r?.y ?? 0 })
const plus = (a: Seg, x: Seg): Seg => ({ entries: a.entries + x.entries, newVisitors: a.newVisitors + x.newVisitors, converted: a.converted + x.converted,
  customers: a.customers + x.customers, clickers: a.clickers + x.clickers, demo: a.demo + x.demo, selfServe: a.selfServe + x.selfServe, bots: a.bots + x.bots })
export const rate = (n: number, d: number) => (d > 0 ? n / d : null)
export const convRate = (s: Seg) => rate(s.converted, s.newVisitors)
export const ctr = (s: Seg) => rate(s.clickers, s.newVisitors)
export const demoShare = (s: Seg) => rate(s.demo, s.demo + s.selfServe)
export const botShare = (s: Seg) => rate(s.bots, s.entries)

export type SegRow = { id: string; label: string; type?: string; cur: Seg; prev: Seg }
export const ZONE_LABEL: Record<string, string> = { hero: 'Hero', navbar: 'Navbar', body: 'Page body', footer: 'Footer', pricing_cards: 'Pricing plan cards', unknown: 'Not tagged', other: 'Other' }

type Cell = { type: string; key: string; cur: Seg; prev: Seg }
type Click = { type: string; zone: string; cur: { clicks: number; clickers: number }; prev: { clicks: number; clickers: number } }
export type DayRow = { day: ISODate; type: string; s: Seg }

export type CroData = {
  all: { cur: Seg; prev: Seg }
  byChannel: Cell[]; byDevice: Cell[]; paths: Cell[]; zones: Click[]
  /** Zone × motion, all page types (motion isn't kept by page type). */
  cta: { zone: string; motion: string; cur: { clicks: number; clickers: number }; prev: { clicks: number; clickers: number } }[]
  /** Daily trend by page type (separate query; null until it loads). */
  days: DayRow[] | null
  /** Last day whose CTA-click window (1 day after the visit) has closed. */
  complete: ISODate
}

function cells(rows: Row[], k: string): Cell[] {
  const m = new Map<string, Cell>()
  for (const r of rows.filter(r => r.k === k && (r.b === 'cur' || r.b === 'prev'))) {
    const i = r.d.indexOf('|'); const type = r.d.slice(0, i), key = r.d.slice(i + 1)
    const x = m.get(r.d) ?? { type, key, cur: zero(), prev: zero() }
    x[r.b as 'cur' | 'prev'] = seg(r)
    m.set(r.d, x)
  }
  return [...m.values()]
}

export function buildCro(payload: unknown, trendPayload: unknown | null, dataEnd: ISODate): CroData {
  const rows = parseCroRows(payload)
  const all = rows.filter(r => r.k === 'all')
  const zones = new Map<string, Click>()
  for (const r of rows.filter(r => r.k === 'lz' && (r.b === 'cur' || r.b === 'prev'))) {
    const i = r.d.indexOf('|'); const type = r.d.slice(0, i), zone = r.d.slice(i + 1)
    const x = zones.get(r.d) ?? { type, zone, cur: { clicks: 0, clickers: 0 }, prev: { clicks: 0, clickers: 0 } }
    x[r.b as 'cur' | 'prev'] = { clicks: r.n, clickers: r.a }
    zones.set(r.d, x)
  }
  const cta = new Map<string, CroData['cta'][number]>()
  for (const r of rows.filter(r => r.k === 'cta' && (r.b === 'cur' || r.b === 'prev'))) {
    const [zone, motion] = r.d.split('|')
    const x = cta.get(r.d) ?? { zone, motion, cur: { clicks: 0, clickers: 0 }, prev: { clicks: 0, clickers: 0 } }
    x[r.b as 'cur' | 'prev'] = { clicks: r.n, clickers: r.a }
    cta.set(r.d, x)
  }
  const days = trendPayload ? parseCroRows(trendPayload).filter(r => r.k === 'day').map(r => ({ day: r.b.slice(0, 10) as ISODate, type: r.d, s: seg(r) })) : null
  return {
    all: { cur: seg(all.find(r => r.b === 'cur')), prev: seg(all.find(r => r.b === 'prev')) },
    byChannel: cells(rows, 'lx'), byDevice: cells(rows, 'ld'), paths: cells(rows, 'path'), zones: [...zones.values()],
    cta: [...cta.values()].sort((a, c) => c.cur.clicks - a.cur.clicks),
    days, complete: addDays(dataEnd, -1),
  }
}

/** Entry-page label: the SQL prefixes paths on other sites with the site id; show where the page lives instead. */
export function pathLabel(type: string, key: string): string {
  if (!key) return '/'
  const i = key.indexOf(':')
  if (i < 0 || key.startsWith('/')) return key
  const site = key.slice(0, i), path = key.slice(i + 1) || '/'
  if (type === 'Marketplace') return `marketplace.clay.com${path === '/' ? '' : path}`
  if (site === 'ploy-guides') return `clay.com${path}`
  if (site === 'university') return `university.clay.com${path === '/' ? '' : path}`
  if (site === 'signup' || site === 'login') return `app.clay.com/${site}${path === '/' ? '' : path}`
  return key
}

/** Sum cells over the selected page types, grouped by their key (channel, device or path). */
function rollup(cs: Cell[], types: Set<string> | null, label = (k: string) => k): SegRow[] {
  const m = new Map<string, SegRow>()
  for (const c of cs) {
    if (types && !types.has(c.type)) continue
    const x = m.get(c.key) ?? { id: c.key, label: label(c.key), type: c.type, cur: zero(), prev: zero() }
    x.cur = plus(x.cur, c.cur); x.prev = plus(x.prev, c.prev)
    m.set(c.key, x)
  }
  return [...m.values()].sort((a, c) => c.cur.newVisitors - a.cur.newVisitors)
}

/** The section's numbers for a page-type selection (null = all page types). */
export type CroCut = {
  total: { cur: Seg; prev: Seg }
  landing: SegRow[]; channels: SegRow[]; devices: SegRow[]; paths: SegRow[]
  zones: { zone: string; cur: { clicks: number; clickers: number }; prev: { clicks: number; clickers: number }; ss: number | null; demo: number | null }[]
}
export function cut(v: CroData, selected: string[] | null): CroCut {
  const types = selected && selected.length ? new Set(selected) : null
  // Page types: always every type (the table is where you pick them).
  const landing = rollup(v.byChannel.map(c => ({ ...c, key: c.type })), null)
  const order = new Map(PAGE_TYPES.map((t, i) => [t, i]))
  landing.sort((a, c) => c.cur.newVisitors - a.cur.newVisitors || (order.get(a.id as never) ?? 99) - (order.get(c.id as never) ?? 99))
  const channels = rollup(v.byChannel, types), devices = rollup(v.byDevice, types)
  const total = types ? channels.reduce((a, r) => ({ cur: plus(a.cur, r.cur), prev: plus(a.prev, r.prev) }), { cur: zero(), prev: zero() }) : v.all
  const zm = new Map<string, CroCut['zones'][number]>()
  for (const z of v.zones) {
    if (types && !types.has(z.type)) continue
    const x = zm.get(z.zone) ?? { zone: z.zone, cur: { clicks: 0, clickers: 0 }, prev: { clicks: 0, clickers: 0 }, ss: types ? null : 0, demo: types ? null : 0 }
    x.cur.clicks += z.cur.clicks; x.cur.clickers += z.cur.clickers; x.prev.clicks += z.prev.clicks; x.prev.clickers += z.prev.clickers
    zm.set(z.zone, x)
  }
  if (!types) for (const c of v.cta) { const x = zm.get(c.zone); if (x) { if (c.motion === 'demo') x.demo! += c.cur.clicks; else if (c.motion === 'self_serve') x.ss! += c.cur.clicks } }
  const paths = v.paths.filter(p => !types || types.has(p.type)).map(p => ({ id: `${p.type}|${p.key}`, label: pathLabel(p.type, p.key), type: p.type, cur: p.cur, prev: p.prev }))
    .sort((a, c) => c.cur.newVisitors - a.cur.newVisitors)
  return { total, landing, channels, devices, paths, zones: [...zm.values()].sort((a, c) => c.cur.clicks - a.cur.clicks) }
}

/** Daily (or weekly) series per selected page type. */
export function trend(v: CroData, types: string[], grain: 'day' | 'week'): { k: string; byType: Record<string, Seg> }[] {
  if (!v.days) return []
  const monday = (d: ISODate) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
  const m = new Map<string, Record<string, Seg>>()
  for (const r of v.days) {
    if (r.day > v.complete || !types.includes(r.type)) continue
    const k = grain === 'week' ? monday(r.day) : r.day
    const g = m.get(k) ?? {}
    g[r.type] = plus(g[r.type] ?? zero(), r.s)
    m.set(k, g)
  }
  // Weekly: only whole weeks, so a week cut by the window's start or the data end doesn't plot as a dip.
  const days = new Map<string, Set<string>>()
  if (grain === 'week') for (const r of v.days) if (r.day <= v.complete) { const k = monday(r.day); (days.get(k) ?? days.set(k, new Set()).get(k)!).add(r.day) }
  return [...m.entries()].filter(([k]) => grain === 'day' || (days.get(k)?.size ?? 0) === 7)
    .sort(([a], [c]) => a.localeCompare(c)).map(([k, byType]) => ({ k, byType }))
}

/** What moved for Conversion (lib/plg/insights.ts rules), for the selection. */
export function croInsight(c: CroCut): Insight {
  const { cur, prev } = c.total
  if (!cur.newVisitors && !prev.newVisitors) return { headline: [], drivers: [], emerging: [], anomalies: [], goals: [], empty: 'No new visitors in either period.' }
  const conv = (rows: SegRow[]): Item[] => rows.map(r => ({ label: r.label, cur: r.cur.converted, prev: r.prev.converted }))
  const visits = (rows: SegRow[]): Item[] => rows.map(r => ({ label: r.label, cur: r.cur.newVisitors, prev: r.prev.newVisitors }))
  const drivers: (Para | Block)[] = []
  const d1 = driverPara('Workspaces (attribution model)', 'workspaces', { cur: cur.converted, prev: prev.converted }, conv(c.landing), { minVolume: 10, noun: 'page types' })
  if (d1) drivers.push(d1)
  const d2 = driverPara('New visitors', 'visitors', { cur: cur.newVisitors, prev: prev.newVisitors }, visits(c.landing), { minVolume: 100, noun: 'page types' })
  if (d2) drivers.push(d2)
  const r1 = ratePara('Workspaces per new visitor', { cur: cur.converted, prev: prev.converted, noun: 'workspaces' }, { cur: cur.newVisitors, prev: prev.newVisitors, noun: 'new visitors' }, 500)
  const r2 = ratePara('CTA click-through', { cur: cur.clickers, prev: prev.clickers, noun: 'clickers' }, { cur: cur.newVisitors, prev: prev.newVisitors, noun: 'new visitors' }, 500)
  for (const r of [r1, r2]) if (r) drivers.push(r)
  const ds = demoShare(cur), dps = demoShare(prev)
  if (ds != null && dps != null && Math.abs(ds - dps) >= 0.02)
    drivers.push([b('CTA mix'), ' ', chg((ds - dps) * 100, 'pp', true), ` · demo is now ${(ds * 100).toFixed(0)}% of CTA clickers (${cur.demo.toLocaleString('en-US')} demo vs ${cur.selfServe.toLocaleString('en-US')} self-serve).`])
  const emerging: Para[] = []
  for (const r of c.paths) {
    if (emerging.length >= 3) break
    const cr = convRate(r.cur), pr = convRate(r.prev)
    if (r.cur.newVisitors >= 200 && cr != null && (pr == null || r.prev.newVisitors < 50 || cr >= pr * 2) && r.cur.converted >= 20)
      emerging.push([code(r.label), `: ${r.cur.newVisitors.toLocaleString('en-US')} new visitors converting at ${(cr * 100).toFixed(1)}%${pr != null && r.prev.newVisitors >= 50 ? ` (was ${(pr * 100).toFixed(1)}%)` : ''}.`])
  }
  const anomalies: Para[] = []
  const bs = botShare(cur), bps = botShare(prev)
  if (bs != null && bps != null && Math.abs(bs - bps) >= 0.1)
    anomalies.push([`Likely-bot share of entry sessions moved `, chg((bs - bps) * 100, 'pp', false), ` to ${(bs * 100).toFixed(0)}%. Bots are excluded from new visitors, but a swing this size usually means some unflagged bot traffic is still in the denominator.`])
  for (const r of c.devices) if (r.cur.newVisitors >= 200 && r.cur.converted === 0 && anomalies.length < 3)
    anomalies.push([code(r.label), `: ${r.cur.newVisitors.toLocaleString('en-US')} new visitors and no attributed workspaces. Either signup is broken there or the attribution model can't link these visitors to a workspace.`])
  const nf = c.landing.find(r => r.id === 'Not found (404)')
  if (nf && nf.cur.newVisitors >= 500) anomalies.push([code('Not found (404)'), `: ${nf.cur.newVisitors.toLocaleString('en-US')} new visitors landed on a missing page this period. Broken inbound links are a direct conversion leak.`])
  return { headline: [], drivers, emerging, anomalies, goals: [] }
}
