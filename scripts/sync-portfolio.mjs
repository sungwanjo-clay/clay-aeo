/**
 * Reads the Supabase portfolio reporting views and writes the artifact db docs for the Portfolio tab.
 *
 *   node scripts/sync-portfolio.mjs <out.json>
 *
 * Env: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PORTFOLIO_READ_KEY (or files of those names in
 * PORTFOLIO_SECRETS_DIR). Uses only public.portfolio_export with the read key: dashboard views, no tables.
 *
 * Output: {docs: [{path, data}]} for collection `portfolio` (portfolio/meta, portfolio/companies-<n>),
 * written to the artifact db with ArtifactData. Only COMPLETE, non-staging snapshots are used. If there
 * is none yet, meta.latest is null and the tab says so. Nothing is invented: unknowns stay null.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const secret = name => {
  if (process.env[name]) return process.env[name].trim()
  const dir = process.env.PORTFOLIO_SECRETS_DIR
  if (dir && existsSync(join(dir, name))) return readFileSync(join(dir, name), 'utf8').trim()
  throw new Error(`missing ${name} (env or PORTFOLIO_SECRETS_DIR/${name})`)
}
const URL_ = (process.env.SUPABASE_URL || 'https://erfisyzlrwzdgcafscmz.supabase.co').replace(/\/$/, '')
const PK = secret('SUPABASE_PUBLISHABLE_KEY')
const RK = secret('PORTFOLIO_READ_KEY')
const out = process.argv[2]
if (!out) { console.error('usage: node scripts/sync-portfolio.mjs <out.json>'); process.exit(1) }

async function view(name) {
  const rows = []
  for (let offset = 0; ; offset += 5000) {
    let j
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${URL_}/rest/v1/rpc/portfolio_export`, {
        method: 'POST', headers: { apikey: PK, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_key: RK, p_view: name, p_offset: offset, p_limit: 5000 }),
      })
      j = await res.json()
      if (res.ok) break
      // Heavy views can hit the statement timeout while others run; retry once on its own.
      if (attempt < 1 && /statement timeout/i.test(j.message ?? '')) { await new Promise(r => setTimeout(r, 3000)); continue }
      throw new Error(`${name}: ${j.message ?? res.status}`)
    }
    rows.push(...j.rows)
    if (j.done) return rows
  }
}

// One view at a time: the snapshot views are heavy, and running them together hits Supabase's statement timeout.
const NAMES = ['snapshots', 'portfolio_totals', 'firm_penetration', 'snapshot_companies', 'firms', 'roster', 'companies', 'company_status',
  'source_coverage', 'source_runs']
const got = []
for (const n of NAMES) { const t = Date.now(); got.push(await view(n)); console.error(`${n}: ${got.at(-1).length} rows in ${Date.now() - t} ms`) }
const [snapshots, totals, firmPen, snapCos, firms, roster, companies, status, coverage, sourceRuns] = got

const complete = snapshots.filter(s => s.status === 'complete' && !s.is_staging).sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
const latest = complete[0] ?? null
const previous = complete[1]?.snapshot_date ?? null
const keep = new Set([latest?.snapshot_date, previous].filter(Boolean))
const num = x => (x == null ? 0 : Number(x))
const counts = r => ({
  portfolio: num(r.portfolio), with_workspace: num(r.with_workspace), no_exact_match: num(r.no_exact_match),
  workspace_unknown: num(r.workspace_unknown), ever_paid: num(r.ever_paid), paying_now: num(r.paying_now),
  paying_unknown: num(r.paying_unknown), eligible_to_date: num(r.eligible_to_date), redeemed: num(r.redeemed),
  redemption_connected: r.redemption_connected ?? null,
  ...(r.shared_by_partner != null ? { shared_by_partner: num(r.shared_by_partner) } : {}),
})

const coById = new Map(companies.map(c => [c.company_id, c]))
const statusById = new Map(status.map(s => [s.company_id, s]))
const firmCut = new Map(firms.map(f => [f.firm_id, f.partnership_cut]))

const rows = []
const inSnapshot = new Set()
if (latest) {
  for (const s of snapCos.filter(x => x.snapshot_date === latest.snapshot_date)) {
    const c = coById.get(s.company_id) ?? {}
    const st = statusById.get(s.company_id) ?? {}
    inSnapshot.add(s.company_id)
    rows.push({
      id: s.company_id, name: c.name ?? '(unknown)', domain: c.domain ?? null, firms: s.firm_ids, cuts: s.cuts,
      inDenominator: true, lookup: s.lookup_status, hasWorkspace: s.has_workspace, workspaces: s.workspace_count,
      everPaid: s.ever_paid, payingNow: s.paying_now, redemption: s.redemption_status, eligibleToDate: !!s.eligible_to_date,
      stage: st.funding_stage ?? null, lastRoundAt: st.last_round_at ?? null,
    })
  }
}
// Roster companies outside the denominator (in review, or found only by matching our workspaces), for the
// "Not in denominator" filter. Companies in the denominator but newer than the snapshot wait for next week.
const outside = new Map()
for (const r of roster) {
  if (r.in_denominator || inSnapshot.has(r.company_id) || !['verified', 'review'].includes(r.verification_status)) continue
  const c = coById.get(r.company_id) ?? {}
  const o = outside.get(r.company_id) ?? {
    id: r.company_id, name: c.name ?? '(unknown)', domain: c.domain ?? null, firms: [], cuts: [], inDenominator: false,
    notCountedReason: r.verification_status === 'review' ? 'in_review' : (r.qualifying_sources?.length ? 'not_verified' : 'workspace_match_only'),
    lookup: null, hasWorkspace: null, workspaces: null, everPaid: null, payingNow: null, redemption: 'not_connected', eligibleToDate: false,
    stage: null, lastRoundAt: null,
  }
  o.firms.push(r.firm_id); const cut = firmCut.get(r.firm_id); if (cut && !o.cuts.includes(cut)) o.cuts.push(cut)
  outside.set(r.company_id, o)
}
rows.push(...outside.values())
rows.sort((a, b) => a.name.localeCompare(b.name))

const CHUNK = 600   // artifact db documents are capped at 256 KB
const chunks = []
for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK))

const meta = {
  version: 1,
  syncedAt: new Date().toISOString(),
  latest: latest ? { snapshot_date: latest.snapshot_date, completed_at: latest.completed_at } : null,
  previous,
  snapshots: complete.map(s => ({ snapshot_date: s.snapshot_date, completed_at: s.completed_at })),
  totals: totals.filter(t => keep.has(t.snapshot_date)).map(t => ({ snapshot_date: t.snapshot_date, cut: t.cut, ...counts(t) })),
  firmRows: firmPen.filter(t => keep.has(t.snapshot_date)).map(t => ({ snapshot_date: t.snapshot_date, firm_id: t.firm_id, partnership_cut: t.partnership_cut, ...counts(t) })),
  firms: firms.map(f => ({ firm_id: f.firm_id, name: f.name, firm_type: f.firm_type, partnership_cut: f.partnership_cut,
    on_proven_tab: !!f.on_proven_tab, stage_focus: f.stage_focus, region: f.region, roster_refreshed_at: f.roster_refreshed_at })),
  // Discovery writes the week's rounds with funding_fit 'unknown'; eligibility is connected only once the
  // eligibility workflow has assessed companies for that week.
  eligibilityConnected: latest ? status.some(s => s.snapshot_date === latest.snapshot_date && s.funding_fit && s.funding_fit !== 'unknown') : false,
  companyChunks: chunks.length,
  openWeek: (() => { const o = snapshots.find(x => x.status === 'open' && !x.is_staging); return o ? { snapshot_date: o.snapshot_date, lookups: num(o.lookups) } : null })(),
  // How each firm's list is built: verified companies per source (and found only by it), and each source's latest run.
  sources: coverage.map(r => ({ firm_id: r.firm_id, source: r.source, companies: num(r.companies), only: num(r.only_this_source) })),
  // Unique verified companies per firm across all sources (sources overlap, so their columns add up to more).
  sourceTotals: Object.fromEntries([...roster.filter(r => r.verification_status === 'verified').reduce((m, r) => {
    const set = m.get(r.firm_id) ?? new Set(); set.add(r.company_id); return m.set(r.firm_id, set)
  }, new Map()).entries()].map(([f, set]) => [f, set.size])),
  sourceRuns: [...sourceRuns.reduce((m, r) => {
    const k = `${r.firm_id}|${r.source}`; const cur = m.get(k)
    if (!cur || r.recorded_at > cur.recorded_at) m.set(k, r)
    return m
  }, new Map()).values()].map(r => ({ firm_id: r.firm_id, source: r.source, status: r.status, companies: num(r.companies),
    cap_hit: !!r.cap_hit, error: r.error || null, recorded_at: r.recorded_at })),
}
const docs = [{ path: 'portfolio/meta', data: meta }, ...chunks.map((c, i) => ({ path: `portfolio/companies-${i}`, data: { rows: c } }))]
writeFileSync(out, JSON.stringify({ docs }))
console.log(`latest complete snapshot: ${latest?.snapshot_date ?? 'none'} · firms ${firms.length} · companies ${rows.length} (${rows.filter(r => r.inDenominator).length} in denominator) · ${docs.length} docs → ${out}`)
