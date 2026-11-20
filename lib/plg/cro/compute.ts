/**
 * CRO view model. Pure: Sigma rows (sql.ts), already relabelled to cur / prev for the range rows, in; render-ready
 * numbers out. "New visitors" are first-ever sessions that aren't likely bots and had no workspace; conversion and
 * CTA clicks are within 1 day of that first visit.
 */
import { addDays, type ISODate } from '../dates'
import { b, chg, code, driverPara, ratePara, type Block, type Insight, type Item, type Para } from '../insights'
import { CRO } from './sql'

type Row = { k: string; b: string; d: string; n: number; a: number; p: number; x: number; c: number; y: number; z: number }
export function parseCroRows(payload: unknown): Row[] {
  const t = payload as { columns: string[]; rows: unknown[][] }
  if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new Error('Unexpected Sigma response shape')
  const ix = Object.fromEntries(t.columns.map((c, i) => [String(c).toLowerCase(), i]))
  const s = (r: unknown[], c: string) => String(r[ix[c]] ?? '')
  const n = (r: unknown[], c: string) => Number(r[ix[c]] ?? 0) || 0
  return t.rows.map(r => ({ k: s(r, 'k'), b: s(r, 'b'), d: s(r, 'd'), n: n(r, 'n'), a: n(r, 'a'), p: n(r, 'p'), x: n(r, 'x'), c: n(r, 'c'), y: n(r, 'y'), z: n(r, 'z') }))
}

/** One segment's entry funnel for a period. */
export type Seg = { entries: number; newVisitors: number; converted: number; clickers: number; demo: number; selfServe: number; bots: number }
const seg = (r?: Row): Seg => ({ entries: r?.n ?? 0, newVisitors: r?.a ?? 0, converted: r?.p ?? 0, clickers: r?.x ?? 0, demo: r?.c ?? 0, selfServe: r?.z ?? 0, bots: r?.y ?? 0 })
export const rate = (n: number, d: number) => (d > 0 ? n / d : null)
export const convRate = (s: Seg) => rate(s.converted, s.newVisitors)
export const ctr = (s: Seg) => rate(s.clickers, s.newVisitors)
export const demoShare = (s: Seg) => rate(s.demo, s.demo + s.selfServe)
export const botShare = (s: Seg) => rate(s.bots, s.entries)

export type SegRow = { id: string; label: string; cur: Seg; prev: Seg }
export const LP_LABEL: Record<string, string> = {
  homepage: 'Homepage', pricing: 'Pricing', product_features: 'Product and features', solutions: 'Solutions and use cases', customers: 'Customers',
  blog: 'Blog', guides_resources: 'Guides and resources', docs: 'Docs', demo_contact: 'Demo, contact, quote', signup_login: 'Signup and login', other: 'Other',
}
export const ZONE_LABEL: Record<string, string> = { hero: 'Hero', navbar: 'Navbar', body: 'Page body', footer: 'Footer', pricing_cards: 'Pricing plan cards', unknown: 'Not tagged', other: 'Other' }

export type Daily = { day: ISODate; newVisitors: number; converted: number; clickers: number; selfServe: number; demo: number; views: number }
export type Zone = { zone: string; clicks: number; clickers: number; demoClicks: number; selfServeClicks: number }
export type Window = { label: string; from: ISODate; to: ISODate; days: number; d: Daily; zones: Zone[] }

export type CroView = {
  all: { cur: Seg; prev: Seg }
  landing: SegRow[]; channels: SegRow[]; devices: SegRow[]; paths: SegRow[]
  cta: { zone: string; motion: string; cur: { clicks: number; clickers: number }; prev: { clicks: number; clickers: number } }[]
  pages: Record<'homepage' | 'pricing', Daily[]>
  launch: { before: Window; after: Window; latest: Window } | null
  /** Last day whose 1-day conversion window has closed. */
  complete: ISODate
}

function segRows(rows: Row[], k: string, label: (d: string) => string): SegRow[] {
  const m = new Map<string, SegRow>()
  for (const r of rows.filter(r => r.k === k && (r.b === 'cur' || r.b === 'prev'))) {
    const x = m.get(r.d) ?? { id: r.d, label: label(r.d), cur: seg(), prev: seg() }
    x[r.b as 'cur' | 'prev'] = seg(r)
    m.set(r.d, x)
  }
  return [...m.values()].sort((a, c) => c.cur.newVisitors - a.cur.newVisitors)
}

const sumDaily = (xs: Daily[]): Daily => xs.reduce((a, x) => ({ day: a.day, newVisitors: a.newVisitors + x.newVisitors, converted: a.converted + x.converted,
  clickers: a.clickers + x.clickers, selfServe: a.selfServe + x.selfServe, demo: a.demo + x.demo, views: a.views + x.views }),
  { day: xs[0]?.day ?? ('' as ISODate), newVisitors: 0, converted: 0, clickers: 0, selfServe: 0, demo: 0, views: 0 })

export function buildCro(payload: unknown, dataEnd: ISODate): CroView {
  const rows = parseCroRows(payload)
  const complete = addDays(dataEnd, -1)
  const pages: CroView['pages'] = { homepage: [], pricing: [] }
  for (const r of rows.filter(r => r.k === 'pg')) {
    const day = r.b.slice(0, 10) as ISODate
    if (r.d === 'homepage' || r.d === 'pricing') pages[r.d].push({ day, newVisitors: r.n, converted: r.a, clickers: r.p, selfServe: r.x, demo: r.c, views: r.y })
  }
  for (const k of ['homepage', 'pricing'] as const) pages[k].sort((a, c) => a.day.localeCompare(c.day))
  const hz = rows.filter(r => r.k === 'hz').map(r => { const [motion, zone] = r.d.split('|'); return { day: r.b.slice(0, 10) as ISODate, motion, zone, clicks: r.n, clickers: r.a } })

  const win = (label: string, from: ISODate, to: ISODate): Window => {
    const ds = pages.homepage.filter(x => x.day >= from && x.day <= to)
    const zm = new Map<string, Zone>()
    for (const h of hz.filter(x => x.day >= from && x.day <= to)) {
      const z = zm.get(h.zone) ?? { zone: h.zone, clicks: 0, clickers: 0, demoClicks: 0, selfServeClicks: 0 }
      // Unique clickers are per day and zone, so summed over days a person clicking on two days counts twice (close enough for zone shares).
      z.clicks += h.clicks; z.clickers += h.clickers
      if (h.motion === 'demo') z.demoClicks += h.clicks; else if (h.motion === 'self_serve') z.selfServeClicks += h.clicks
      zm.set(h.zone, z)
    }
    return { label, from, to, days: ds.length, d: sumDaily(ds), zones: [...zm.values()].sort((a, c) => c.clickers - a.clickers) }
  }
  const L = CRO.launch
  const launch = pages.homepage.length ? {
    before: win('4 weeks before', CRO.seriesStart, addDays(L, -2)),
    after: win('First 4 weeks after', L, addDays(L, 26)),
    latest: win('Latest 4 weeks', addDays(complete, -27), complete),
  } : null

  const ctaMap = new Map<string, CroView['cta'][number]>()
  for (const r of rows.filter(r => r.k === 'cta' && (r.b === 'cur' || r.b === 'prev'))) {
    const [zone, motion] = r.d.split('|')
    const x = ctaMap.get(r.d) ?? { zone, motion, cur: { clicks: 0, clickers: 0 }, prev: { clicks: 0, clickers: 0 } }
    x[r.b as 'cur' | 'prev'] = { clicks: r.n, clickers: r.a }
    ctaMap.set(r.d, x)
  }
  const all = rows.filter(r => r.k === 'all')
  return {
    all: { cur: seg(all.find(r => r.b === 'cur')), prev: seg(all.find(r => r.b === 'prev')) },
    landing: segRows(rows, 'lp', d => LP_LABEL[d] ?? d),
    channels: segRows(rows, 'ch', d => d),
    devices: segRows(rows, 'dev', d => d),
    paths: segRows(rows, 'path', d => d || '/'),
    cta: [...ctaMap.values()].sort((a, c) => c.cur.clicks - a.cur.clicks),
    pages, launch, complete,
  }
}

/** What moved for CRO (lib/plg/insights.ts rules): where workspace conversions came from, the rates, and outliers. */
export function croInsight(v: CroView): Insight {
  const { cur: c, prev: p } = v.all
  if (!c.newVisitors && !p.newVisitors) return { headline: [], drivers: [], emerging: [], anomalies: [], goals: [], empty: 'No new visitors in either period.' }
  const conv = (rows: SegRow[]): Item[] => rows.map(r => ({ label: r.label, cur: r.cur.converted, prev: r.prev.converted }))
  const visits = (rows: SegRow[]): Item[] => rows.map(r => ({ label: r.label, cur: r.cur.newVisitors, prev: r.prev.newVisitors }))
  const drivers: (Para | Block)[] = []
  const d1 = driverPara('Workspaces from new visitors (within 1 day)', 'workspaces', { cur: c.converted, prev: p.converted }, conv(v.landing), { minVolume: 10, noun: 'landing page types' })
  if (d1) drivers.push(d1)
  const d2 = driverPara('New visitors', 'visitors', { cur: c.newVisitors, prev: p.newVisitors }, visits(v.landing), { minVolume: 100, noun: 'landing page types' })
  if (d2) drivers.push(d2)
  const r1 = ratePara('Visit → workspace (1 day)', { cur: c.converted, prev: p.converted, noun: 'workspaces' }, { cur: c.newVisitors, prev: p.newVisitors, noun: 'new visitors' }, 500)
  const r2 = ratePara('CTA click-through', { cur: c.clickers, prev: p.clickers, noun: 'clickers' }, { cur: c.newVisitors, prev: p.newVisitors, noun: 'new visitors' }, 500)
  for (const r of [r1, r2]) if (r) drivers.push(r)
  const ds = demoShare(c), dps = demoShare(p)
  if (ds != null && dps != null && Math.abs(ds - dps) >= 0.02)
    drivers.push([b('CTA mix'), ' ', chg((ds - dps) * 100, 'pp', true), ` · demo is now ${(ds * 100).toFixed(0)}% of CTA clickers (${c.demo.toLocaleString('en-US')} demo vs ${c.selfServe.toLocaleString('en-US')} self-serve).`])

  const emerging: Para[] = []
  for (const r of v.paths) {
    if (emerging.length >= 3) break
    const cr = convRate(r.cur), pr = convRate(r.prev)
    if (r.cur.newVisitors >= 200 && cr != null && (pr == null || r.prev.newVisitors < 50 || cr >= pr * 2) && r.cur.converted >= 20)
      emerging.push([code(r.label), `: ${r.cur.newVisitors.toLocaleString('en-US')} new visitors converting at ${(cr * 100).toFixed(1)}%${pr != null && r.prev.newVisitors >= 50 ? ` (was ${(pr * 100).toFixed(1)}%)` : ''}.`])
  }
  const anomalies: Para[] = []
  const bs = botShare(c), bps = botShare(p)
  if (bs != null && bps != null && Math.abs(bs - bps) >= 0.1)
    anomalies.push([`Likely-bot share of entry sessions moved `, chg((bs - bps) * 100, 'pp', false), ` to ${(bs * 100).toFixed(0)}%. Bots are excluded from new visitors, but a swing this size usually means some unflagged bot traffic is still in the denominator.`])
  for (const r of v.devices) if (r.cur.newVisitors >= 200 && r.cur.converted === 0 && anomalies.length < 3)
    anomalies.push([code(r.label), `: ${r.cur.newVisitors.toLocaleString('en-US')} new visitors and no workspaces within a day. Either signup is broken there or these visitors can't be linked to a workspace.`])
  return { headline: [], drivers, emerging, anomalies, goals: [] }
}
