/**
 * Data contracts for every query result the dashboard shows, live or saved. A result that breaks its contract is
 * reported, never rendered as if it were real: the page shows the problem on that section, the daily refresh refuses to
 * store it over a good copy (scripts/refresh-cache.mjs pack), and the health check raises it (scripts/health-check.mjs).
 *
 * A contract checks shape (columns, row kinds), coverage (a row for every date range the copy claims to cover) and
 * invariants that can only fail when something upstream broke (conversions > visitors, negative counts, a day with no
 * visitors at all). Ranges are labels "<start>~<end>" (lib/plg/offline.ts).
 */
export type Name = 'main' | 'social' | 'startup' | 'tier4' | 'tier4list' | 'cro' | 'crotrend' | 'creators'
export type Verdict = { ok: boolean; problems: string[]; rows: number }

type Tbl = { columns: unknown[]; rows: unknown[][] }
const isTbl = (x: unknown): x is Tbl => !!x && Array.isArray((x as Tbl).columns) && Array.isArray((x as Tbl).rows)

/** Ranges that start on or after `from` (data that exists only since then). Keys without dates (cur, prev) are kept. */
const since = (ranges: string[], from: string) => ranges.filter(r => !r.includes('~') || r.split('~')[0] >= from)

/**
 * `ranges`: the labels the copy covers (saved-copy header). For a live single-view result pass the labels of the
 * view's own ranges, or nothing to skip coverage checks.
 */
export function validate(name: Name, payload: unknown, ranges: string[] = []): Verdict {
  const problems: string[] = []
  if (!isTbl(payload)) return { ok: false, problems: ['not a {columns, rows} result'], rows: 0 }
  const cols = payload.columns.map(c => String(c).toLowerCase())
  const ix = (c: string) => cols.indexOf(c)
  const need = (cs: string[]) => { const miss = cs.filter(c => ix(c) < 0); if (miss.length) problems.push(`missing columns ${miss.join(', ')}`); return !miss.length }
  const rows = payload.rows
  if (!rows.length) problems.push('no rows')
  // Sigma caps a query result at 10,000 rows and drops the rest without an error.
  if (rows.length >= 10000) problems.push(`${rows.length} rows: the result hit Sigma's 10,000-row limit and is truncated`)
  const v = (r: unknown[], c: string) => r[ix(c)]
  const num = (r: unknown[], c: string) => Number(v(r, c) ?? 0)
  const str = (r: unknown[], c: string) => String(v(r, c) ?? '')
  const negative = (cs: string[]) => {
    const bad = rows.filter(r => cs.some(c => ix(c) >= 0 && num(r, c) < 0)).length
    if (bad) problems.push(`${bad} rows with negative counts`)
  }
  const nonNum = (cs: string[]) => {
    const bad = rows.filter(r => cs.some(c => ix(c) >= 0 && v(r, c) != null && !Number.isFinite(Number(v(r, c))))).length
    if (bad) problems.push(`${bad} rows with non-numeric counts`)
  }

  switch (name) {
    case 'main': {
      if (!need(['b', 'n'])) break
      nonNum(['n']); negative(['n'])
      // Every range has visitors (x:<label>:visitors) and at least one new-workspace row (<label>).
      const vis = new Map(rows.filter(r => str(r, 'b').startsWith('x:') && str(r, 'b').endsWith(':visitors')).map(r => [str(r, 'b').slice(2, -9), num(r, 'n')]))
      const ws = new Set(rows.map(r => str(r, 'b')))
      for (const l of ranges) {
        if (!(vis.get(l)! > 0)) problems.push(`no visitors for ${l}`)
        if (!ws.has(l)) problems.push(`no new workspaces for ${l}`)
      }
      break
    }
    case 'social': {
      if (!need(['k', 'b'])) break
      if (!rows.some(r => str(r, 'k') === 'vis')) problems.push('no visitor rows')
      break
    }
    case 'startup': {
      if (!need(['k', 'b', 'd', 'n', 'a', 'p', 'x', 'c'])) break
      nonNum(['n', 'a', 'p', 'x', 'c']); negative(['n', 'a', 'p', 'x', 'c'])
      const vis = new Map(rows.filter(r => str(r, 'k') === 'vis').map(r => [str(r, 'b'), r]))
      // The startup page went live 2026-07-01; earlier ranges legitimately have no visits.
      for (const l of since(ranges, '2026-07-01')) if (!(num(vis.get(l) ?? [], 'n') > 0)) problems.push(`no startup-page visits for ${l}`)
      for (const r of rows.filter(r => str(r, 'k') === 'ws')) if (num(r, 'a') > num(r, 'n') || num(r, 'p') > num(r, 'n')) problems.push(`activated or paid above new workspaces (${str(r, 'b')})`)
      break
    }
    case 'tier4': {
      if (!need(['k', 'b', 'd', 'n', 'a', 'p', 'x', 'c', 'y', 'z'])) break
      nonNum(['n', 'a', 'p', 'x', 'c', 'y', 'z']); negative(['n', 'a', 'p', 'x', 'c', 'y', 'z'])
      const mv = new Map(rows.filter(r => str(r, 'k') === 'mv').map(r => [str(r, 'b'), r]))
      for (const l of since(ranges, '2026-02-01')) if (!(num(mv.get(l) ?? [], 'n') > 0)) problems.push(`no Tier 4 accounts for ${l}`)
      for (const [l, r] of mv) for (const c of ['a', 'p', 'x', 'c', 'y', 'z']) if (num(r, c) > num(r, 'n')) { problems.push(`${c} above accounts for ${l}`); break }
      if (!rows.some(r => str(r, 'k') === 'mo')) problems.push('no monthly cohorts')
      break
    }
    case 'tier4list': {
      if (!need(['aid', 'name', 'dom', 'score', 'ntp', 'last'])) break
      if (rows.length < 50) problems.push(`only ${rows.length} accounts (expected hundreds)`)
      const ids = new Set(rows.map(r => str(r, 'aid')))
      if (ids.size !== rows.length) problems.push('duplicate accounts')
      if (rows.some(r => num(r, 'score') < 0 || num(r, 'score') > 100)) problems.push('score outside 0–100')
      break
    }
    case 'crotrend': {
      if (!need(['k', 'b', 'd', 'n', 'a', 'p', 'x'])) break
      nonNum(['n', 'a', 'p', 'x']); negative(['n', 'a', 'p', 'x'])
      const days = new Set(rows.map(r => str(r, 'b').slice(0, 10)))
      if (days.size < 150) problems.push(`trend covers only ${days.size} days`)
      const hp = new Map<string, number>()
      for (const r of rows) if (str(r, 'd') === 'Homepage') hp.set(str(r, 'b').slice(0, 10), num(r, 'a'))
      const empty = [...days].filter(d => !(hp.get(d)! > 0))
      if (empty.length > 2) problems.push(`days with no new homepage visitors: ${empty.slice(0, 5).join(', ')}`)
      if (rows.some(r => num(r, 'p') > num(r, 'a') || num(r, 'x') > num(r, 'a'))) problems.push('a day with conversions or clickers above new visitors')
      break
    }
    case 'creators': {
      if (!need(['k', 'tok', 'wk', 'n1', 'n2', 'n3', 'n4', 'n5'])) break
      nonNum(['n1', 'n2', 'n3', 'n4', 'n5']); negative(['n1', 'n2', 'n3', 'n4', 'n5'])
      if (!rows.some(r => str(r, 'k') === 'v')) problems.push('no affiliate visitor rows')
      if (!rows.some(r => str(r, 'k') === 'w')) problems.push('no affiliate workspace rows')
      const ws = rows.filter(r => str(r, 'k') === 'w')
      if (ws.some(r => num(r, 'n2') > num(r, 'n1') || num(r, 'n5') > num(r, 'n1') || num(r, 'n4') > num(r, 'n1') || num(r, 'n3') > num(r, 'n4')))
        problems.push('a token-week with Tier 1–3, matured, activated or paid above its workspaces')
      const weeks = new Set(rows.map(r => str(r, 'wk').slice(0, 10)))
      if (weeks.size < 8) problems.push(`only ${weeks.size} weeks of affiliate data`)
      break
    }
    case 'cro': {
      if (!need(['k', 'b', 'd', 'n', 'a', 'p', 'x', 'c', 'y', 'z'])) break
      nonNum(['n', 'a', 'p', 'x', 'c', 'y', 'z']); negative(['n', 'a', 'p', 'x', 'c', 'y', 'z'])
      const all = new Map(rows.filter(r => str(r, 'k') === 'all').map(r => [str(r, 'b'), r]))
      for (const l of ranges) {
        const r = all.get(l)
        if (!r || !(num(r, 'a') > 0)) { problems.push(`no new visitors for ${l}`); continue }
        if (num(r, 'p') > num(r, 'a')) problems.push(`more conversions than new visitors for ${l}`)
        if (num(r, 'x') > num(r, 'a')) problems.push(`more CTA clickers than new visitors for ${l}`)
        if (num(r, 'a') > num(r, 'n')) problems.push(`more new visitors than entry sessions for ${l}`)
      }
      if (!rows.some(r => str(r, 'k') === 'lx')) problems.push('no page type × channel rows')
      break
    }
  }
  return { ok: problems.length === 0, problems, rows: rows.length }
}
