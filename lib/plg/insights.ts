/**
 * "What moved" narratives, shared by every dashboard tab. Adapted from the weekly SEO digest's rules:
 *
 *  - Three layers: headline (authoritative aggregate) → drivers (per-item contributors). Layers needn't reconcile.
 *  - Direction-aligned drivers: a segment that went down cites only items that went down; one opposite-direction item
 *    may follow as "Offsetting:". Never lead a declining paragraph with something that grew.
 *  - Every cited item carries "(X% of the net change)". Arrows carry direction; magnitudes are positive.
 *  - Prose, not bullets, in the driver paragraphs. No advice: never "monitor", "investigate", "consider", "worth
 *    tracking", "may need attention", "should look into". State the signal; the reader decides.
 *  - Optional sections (emerging, anomalies) are omitted entirely when nothing qualifies.
 *  - Low volume is called out instead of reported as a breakthrough.
 */

/** A run of text: plain, bold, monospace name, or a change with its colored arrow. */
export type Run =
  | string
  | { k: 'b'; s: string }
  | { k: 'code'; s: string }
  /** Change: pct = relative change (0.12 = 12%), pp = percentage points (already ×100), abs = count. goodUp: is up good? */
  | { k: 'chg'; v: number | null; unit: 'pct' | 'pp' | 'abs'; goodUp?: boolean }
export type Para = Run[]
export type GoalLine = { tone: 'good' | 'bad' | 'flat'; para: Para }
export type Insight = {
  title?: string
  /** One-line context, e.g. "Through Nov 17: one or more channels are lagging." */
  note?: string | null
  headline: Para[]
  drivers: Para[]
  emerging: Para[]
  anomalies: Para[]
  goals: GoalLine[]
  /** Shown when there's nothing to compare yet. */
  empty?: string | null
}

export const b = (s: string): Run => ({ k: 'b', s })
export const code = (s: string): Run => ({ k: 'code', s })
export const chg = (v: number | null, unit: 'pct' | 'pp' | 'abs' = 'pct', goodUp = true): Run => ({ k: 'chg', v, unit, goodUp })

const int = (n: number) => Math.round(n).toLocaleString('en-US')
export const pct = (v: number | null | undefined, d?: number) => (v == null ? '–' : `${(v * 100).toFixed(d ?? (Math.abs(v) < 0.1 ? 1 : 0))}%`)
const rel = (cur: number, prev: number) => (prev ? (cur - prev) / prev : null)

/** "Views: 8,010, ▲23% vs the period before" style headline line. */
export function headlineLine(label: string, cur: number | null, prev: number | null, o: { kind?: 'count' | 'rate' | 'usd'; goal?: number | null; floor?: { n: number; min: number; what: string } } = {}): Para {
  const kind = o.kind ?? 'count'
  if (cur == null) return [b(label), ': ', { k: 'code', s: 'not connected' }]
  const val = kind === 'rate' ? pct(cur) : kind === 'usd' ? usd(cur) : int(cur)
  const delta: Run = prev == null ? '– vs the period before' : kind === 'rate' ? chg((cur - prev) * 100, 'pp')
    : prev === 0 ? (cur === 0 ? chg(0) : `new (none in the period before)`) : chg(rel(cur, prev), 'pct')
  const out: Para = [b(label), `: ${val}, `, delta]
  if (prev != null && !(prev === 0 && cur !== 0 && kind !== 'rate')) out.push(' vs the period before')
  if (kind === 'rate' && o.goal != null) out.push(` · ${goalNote(cur, o.goal, o.floor)}`)
  return out
}

export const usd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${Math.round(n)}`)

/** Goal language: at/above → just the number; below; far below (≤ half); far above on low volume → caveat. */
export function goalNote(cur: number, goal: number, floor?: { n: number; min: number; what: string }): string {
  if (floor && floor.n < floor.min && cur >= goal * 3) return `${pct(cur)} of a ${pct(goal)} goal (above, but on ${int(floor.n)} ${floor.what}: low volume)`
  if (cur >= goal) return `${pct(cur)} of a ${pct(goal)} goal`
  if (cur <= goal / 2) return `${pct(cur)} of a ${pct(goal)} goal (far below)`
  return `${pct(cur)} of a ${pct(goal)} goal (below)`
}

export type Item = { label: string; cur: number; prev: number; tags?: string[] }

/**
 * One driver paragraph. `metric` is plural ("Views", "Referral visits"); `unit` the noun for an item's change
 * ("views", "visits"). Items below `minVolume` in both periods are never cited.
 */
export function driverPara(metric: string, unit: string, total: { cur: number; prev: number }, items: Item[], o: { minVolume?: number; usd?: boolean; noun?: string } = {}): Para | null {
  const net = total.cur - total.prev
  const fmt = (n: number) => (o.usd ? usd(Math.abs(n)) : `${int(Math.abs(n))} ${Math.abs(n) === 1 ? unit.replace(/s$/, '') : unit}`)
  if (!total.cur && !total.prev) return null
  if (net === 0) return [`${metric} are flat at ${o.usd ? usd(total.cur) : int(total.cur)} vs the period before.`]
  const dir = Math.sign(net)
  const out: Para = [`${metric} are ${dir > 0 ? 'up' : 'down'} ${o.usd ? usd(Math.abs(net)) : int(Math.abs(net))} vs the period before (`, chg(rel(total.cur, total.prev)), '). ']
  const min = o.minVolume ?? 0
  const eligible = items.filter(i => Math.max(i.cur, i.prev) >= min && i.cur !== i.prev)
  const same = eligible.filter(i => Math.sign(i.cur - i.prev) === dir).sort((a, c) => Math.abs(c.cur - c.prev) - Math.abs(a.cur - a.prev))
  const opp = eligible.filter(i => Math.sign(i.cur - i.prev) === -dir).sort((a, c) => Math.abs(c.cur - c.prev) - Math.abs(a.cur - a.prev))
  const share = (i: Item) => `${Math.round(Math.abs(i.cur - i.prev) / Math.abs(net) * 100)}% of the net change`
  const top = same.slice(0, 3)
  if (top.length) {
    out.push(dir > 0 ? `Biggest gains: ` : `Biggest declines: `)
    top.forEach((i, ix) => {
      if (ix) out.push(ix === top.length - 1 ? ' and ' : '; ')
      out.push(code(i.label), ` ${dir > 0 ? 'gained' : 'lost'} ${fmt(i.cur - i.prev)} (${[share(i), ...(i.tags ?? [])].join('; ')})`)
    })
    out.push('. ')
  }
  if (opp[0]) out.push('Offsetting: ', code(opp[0].label), ` ${dir > 0 ? 'down' : 'up'} ${fmt(opp[0].cur - opp[0].prev)} (offsetting ${share(opp[0])}). `)
  // Interpretation (when the move is 10%+): how concentrated the change is. Descriptive only.
  const r = rel(total.cur, total.prev)
  if (top.length && r != null && Math.abs(r) >= 0.1) {
    const s1 = Math.abs(top[0].cur - top[0].prev) / Math.abs(net)
    const s3 = top.reduce((a, i) => a + Math.abs(i.cur - i.prev), 0) / Math.abs(net)
    const noun = o.noun ?? 'items'
    out.push(s1 >= 0.5 ? `Most of the change comes from one of the ${noun}.`
      : s3 >= 0.8 ? `The top ${top.length} account for ${Math.round(s3 * 100)}% of the change.`
      : `The change is spread across many ${noun}.`)
  }
  return out
}

/** Goal line: good when at/above goal or moving toward it, bad otherwise; names the biggest gap contributor if given. */
export function goalLine(label: string, cur: number | null, prev: number | null, goal: number, gap?: string | null, floor?: { n: number; min: number; what: string }): GoalLine | null {
  if (cur == null) return null
  const toward = prev != null && cur > prev
  const tone: GoalLine['tone'] = cur >= goal || toward ? 'good' : prev != null && Math.abs(cur - prev) < 0.0005 ? 'flat' : 'bad'
  const para: Para = [b(label), `: ${pct(cur)} vs a ${pct(goal)} goal`]
  if (cur < goal) para.push(` (${Math.round(cur / goal * 100)}% of the way)`)
  else if (floor && floor.n < floor.min) para.push(` (low volume: ${int(floor.n)} ${floor.what})`)
  if (prev != null) para.push(', ', chg((cur - prev) * 100, 'pp'), ' vs the period before')
  if (gap && cur < goal) para.push(`. Biggest gap: ${gap}`)
  para.push('.')
  return { tone, para }
}
