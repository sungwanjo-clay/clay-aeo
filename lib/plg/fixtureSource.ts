import { readFileSync } from 'node:fs'
import type { DailyPoint, Meta, RangeSummary } from './compute'
import type { PlgSource } from './load'
import type { ISODate } from './dates'

/**
 * Local-dev source: reads a JSON file of fact rows and aggregates in memory the
 * same way the Supabase RPCs do. Enabled only outside production via
 * PLG_FIXTURE_PATH. The UI labels it "FIXTURE DATA" so it can't be mistaken
 * for live numbers.
 *
 * Accepts either an array of row objects
 *   [{ day, channel_category, channel, subchannel, sales_tier, quality_segment, n }]
 * or a {columns, rows} table in that column order.
 */
type Fact = { day: ISODate; channel_category: string; channel: string; subchannel: string; sales_tier: string; quality_segment: string; n: number }

export function fixtureSource(path: string): PlgSource {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const facts: Fact[] = Array.isArray(raw)
    ? raw
    : raw.rows.map((r: unknown[]) => ({
        day: String(r[0]).slice(0, 10), channel_category: String(r[1]), channel: String(r[2]),
        subchannel: String(r[3]), sales_tier: String(r[4]), quality_segment: String(r[5]), n: Number(r[6]),
      }))
  const days = facts.map(f => f.day).sort()
  const inRange = (s: ISODate, e: ISODate) => facts.filter(f => f.day >= s && f.day <= e)
  const group = <K extends string>(rows: Fact[], key: (f: Fact) => K) => {
    const m = new Map<K, number>()
    for (const f of rows) m.set(key(f), (m.get(key(f)) ?? 0) + f.n)
    return m
  }

  return {
    kind: 'fixture',
    async meta(): Promise<Meta> {
      return { min_day: days[0] ?? null, max_day: days[days.length - 1] ?? null, last_ok_at: null, last_run: null,
        restatements: [], recon_mismatches: [], goals: [] }
    },
    async summary(s, e): Promise<RangeSummary> {
      const rows = inRange(s, e)
      return {
        channels: [...group(rows, f => `${f.channel_category}\u0000${f.channel}\u0000${f.sales_tier}`)]
          .map(([k, n]) => { const [c, ch, t] = k.split('\u0000'); return { c, ch, t, n } }),
        hqTiers: [...group(rows.filter(f => f.quality_segment === 'non-personal: high quality'), f => f.sales_tier)].map(([t, n]) => ({ t, n })),
        mcp: [...group(rows.filter(f => f.channel === 'OAuth: MCP'), f => f.subchannel)].map(([s2, n]) => ({ s: s2, n })),
        quality: [...group(rows, f => f.quality_segment)].map(([q, n]) => ({ q, n })),
        domain: [],
      }
    },
    async daily(s, e): Promise<DailyPoint[]> {
      const by = new Map<ISODate, DailyPoint>()
      for (const f of inRange(s, e)) {
        const p = by.get(f.day) ?? { d: f.day, n: 0, unattr: 0, hq: 0, lowq: 0 }
        p.n += f.n
        if (f.channel === 'unattributable') p.unattr! += f.n
        if (f.quality_segment === 'non-personal: high quality') p.hq! += f.n
        if (f.quality_segment === 'non-personal: low quality') p.lowq! += f.n
        by.set(f.day, p)
      }
      return [...by.values()].sort((a, b) => a.d.localeCompare(b.d))
    },
  }
}
