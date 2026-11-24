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
/** A driver section: one lead line, one bullet per contributor, and an optional closing line. */
export type Block = { lead: Para; bullets: Para[]; note?: Para | null }
export type GoalLine = { tone: 'good' | 'bad' | 'flat'; para: Para }
export type Insight = {
  title?: string
  /** One-line context, e.g. "Through Nov 17: one or more channels are lagging." */
  note?: string | null
  headline: Para[]
  drivers: (Para | Block)[]
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
 * One driver section. `metric` is the plural or mass noun ("Views", "Paying ARR"); `unit` the noun for an item's
 * change ("views", "visits"). Items below `minVolume` in both periods are never cited.
 *   Lead:    Views ▲23% · up 1,483 vs the period before
 *   Bullets: "Title" +1,219 views · 82% of the net change · Peter Kang       (same direction only, top 3)
 *            Offsetting: "Title" −147 views · offsets 10%                   (at most one)
 */
export function driverPara(metric: string, unit: string, total: { cur: number; prev: number }, items: Item[], o: { minVolume?: number; usd?: boolean; noun?: string; goodUp?: boolean } = {}): Block | null {
  const net = total.cur - total.prev
  const amt = (n: number) => (o.usd ? usd(Math.abs(n)) : int(Math.abs(n)))
  const fmt = (n: number) => (o.usd ? `${n > 0 ? '+' : '−'}${usd(Math.abs(n))}` : `${n > 0 ? '+' : '−'}${int(Math.abs(n))} ${Math.abs(n) === 1 ? unit.replace(/s$/, '') : unit}`)
  if (!total.cur && !total.prev) return null
  const min = o.minVolume ?? 0
  if (net === 0) {
    // Flat overall can still hide a shift between items: name the biggest move each way.
    const moved = items.filter(i => Math.max(i.cur, i.prev) >= min && i.cur !== i.prev).sort((a, c) => Math.abs(c.cur - c.prev) - Math.abs(a.cur - a.prev))
    const up = moved.find(i => i.cur > i.prev), down = moved.find(i => i.cur < i.prev)
    return { lead: [b(metric), ` flat at ${o.usd ? usd(total.cur) : int(total.cur)} vs the period before${up && down ? ', with a shift between them' : ''}`],
      bullets: up && down ? [[code(up.label), ` ${fmt(up.cur - up.prev)}`], [code(down.label), ` ${fmt(down.cur - down.prev)}`]] : [] }
  }
  const dir = Math.sign(net)
  const lead: Para = total.prev === 0 ? [b(metric), ` · up ${amt(net)} from none in the period before`]
    : [b(metric), ' ', chg(rel(total.cur, total.prev), 'pct', o.goodUp ?? true), ` · ${dir > 0 ? 'up' : 'down'} ${amt(net)} vs the period before`]
  const eligible = items.filter(i => Math.max(i.cur, i.prev) >= min && i.cur !== i.prev)
  const same = eligible.filter(i => Math.sign(i.cur - i.prev) === dir).sort((a, c) => Math.abs(c.cur - c.prev) - Math.abs(a.cur - a.prev))
  const opp = eligible.filter(i => Math.sign(i.cur - i.prev) === -dir).sort((a, c) => Math.abs(c.cur - c.prev) - Math.abs(a.cur - a.prev))
  const share = (i: Item) => `${Math.round(Math.abs(i.cur - i.prev) / Math.abs(net) * 100)}%`
  // When single items swing harder than the net (a mix shift), percentages of the net read as nonsense (367%):
  // show the swings themselves instead and say so in the lead.
  const swing = eligible.some(i => Math.abs(i.cur - i.prev) > Math.abs(net))
  if (swing) lead.push(' · items moved both ways by more than the net')
  const top = same.slice(0, 3)
  const tags = (i: Item): Run[] => (i.tags?.length ? [` · ${i.tags.join(' · ')}`] : [])
  const bullets: Para[] = top.map(i => [code(i.label), ` ${fmt(i.cur - i.prev)}`, ...(swing ? [] : [` · ${share(i)} of the net change`]), ...tags(i)])
  if (opp[0]) bullets.push(['Offsetting: ', code(opp[0].label), ` ${fmt(opp[0].cur - opp[0].prev)}`, ...(swing ? [] : [` · offsets ${share(opp[0])}`])])
  const note: Para | null = null
  return { lead, bullets, note }
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

/**
 * How much of an output's change came from its input's volume and how much from the conversion rate, the standard
 * split: volume = Δinput × previous rate, rate = current input × Δrate (they add up to the change).
 * "Why: fewer visits (215 → 180) account for −3 workspaces and the visit → workspace rate fell from 8% to 3% for −9: mostly conversion."
 */
export function volumeVsRate(out: { cur: number; prev: number; noun: string }, inp: { cur: number; prev: number; noun: string }, rateName: string): Para | null {
  if (!inp.prev || !inp.cur || out.cur === out.prev) return null
  const pr = out.prev / inp.prev, cr = out.cur / inp.cur
  const vol = (inp.cur - inp.prev) * pr, rt = inp.cur * (cr - pr)
  const sgn = (x: number) => `${x >= 0 ? '+' : '−'}${int(Math.abs(x))}`
  const rateMove = `${rateName} ${cr > pr ? 'rose' : 'fell'} from ${pct(pr)} to ${pct(cr)}`
  if (inp.cur === inp.prev) return [`Why: ${inp.noun} held at ${int(inp.cur)}, so all of it is conversion: ${rateMove}.`]
  if (Math.abs(cr - pr) < 0.0005) return [`Why: conversion held at ${pct(cr)}, so all of it is volume: ${inp.noun} went from ${int(inp.prev)} to ${int(inp.cur)}.`]
  const main = Math.abs(vol) >= Math.abs(rt) ? 'mostly volume' : 'mostly conversion'
  return [`Why: ${inp.cur > inp.prev ? 'more' : 'fewer'} ${inp.noun} (${int(inp.prev)} → ${int(inp.cur)}) account for ${sgn(vol)} ${out.noun} and the ${rateMove} for ${sgn(rt)}: ${main}.`]
}

/**
 * A rate paragraph: how much the rate moved, and whether the numerator or the denominator moved it.
 * "Visit → workspace is down 3.4pp to 5.0% (▼3.4pp): new workspaces fell 50% (18 → 9) while visits fell 16% (215 → 180)."
 * Adds a low-volume clause when the current denominator is under `minDen`.
 */
export function ratePara(label: string, num: { cur: number; prev: number; noun: string }, den: { cur: number; prev: number; noun: string }, minDen = 20): Para | null {
  if (!den.cur || !den.prev) return null
  const r = num.cur / den.cur, pr = num.prev / den.prev
  const d = (r - pr) * 100
  if (Math.abs(d) < 0.05) return [b(label), ` held at ${pct(r)}.`]
  const move = (x: { cur: number; prev: number; noun: string }) => {
    const c = rel(x.cur, x.prev)
    return c == null ? `${x.noun} went from 0 to ${int(x.cur)}` : Math.abs(c) < 0.005 ? `${x.noun} held at ${int(x.cur)}`
      : `${x.noun} ${c > 0 ? 'rose' : 'fell'} ${Math.abs(c * 100).toFixed(0)}% (${int(x.prev)} → ${int(x.cur)})`
  }
  const out: Para = [b(label), ' ', chg(d, 'pp'), ` · now ${pct(r)}: ${move(num)} while ${move(den)}.`]
  if (den.cur < minDen) out.push(` This period rests on ${int(den.cur)} ${den.noun}, so a few people move the rate a lot.`)
  return out
}
