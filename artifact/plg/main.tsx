/**
 * claude.ai artifact entry for the PLG Workspaces dashboard.
 *
 * Data: the VIEWER's "Clay Sigma" connector (Snowflake via Sigma), one query
 * for the latest complete day + one aggregated query per filter state. Results
 * are cached by the platform (watchTool) so reopening is instant and refreshes
 * in the background.
 * Store (`db`): restatement log (weeks/<monday>) and optional goal overrides
 * (config/goals → { rows: GoalRow[] }).
 *
 * Build: node scripts/build-plg-artifact.mjs → dist/plg-artifact.html
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import DashboardView, { paramsFor, type DashboardTab } from '@/components/plg/DashboardView'
import SocialView, { ChannelPills, ModeToggle, type SocialChannel } from '@/components/plg/social/SocialView'
import { buildSocial, channelFallbacks, parseSocialRows, taggedVideos, type SocialMode, type YtChannelDoc } from '@/lib/plg/social/compute'
import { CHANNELS } from '@/lib/plg/social/config'
import { socialSql } from '@/lib/plg/social/sql'
import StartupView from '@/components/plg/startup/StartupView'
import { buildStartup, parseStartupRows } from '@/lib/plg/startup/compute'
import { startupSql } from '@/lib/plg/startup/sql'
import type { FilterState } from '@/components/plg/FilterCard'
import { T } from '@/components/plg/ui'
import { resolveQuarters, type GoalRow, type Meta } from '@/lib/plg/compute'
import { DEFAULT_QUARTERS, GUARDRAILS } from '@/lib/plg/config'
import { addDays, mondayOf, todayUTC, type ISODate } from '@/lib/plg/dates'
import { assembleDashboard, planDashboard } from '@/lib/plg/plan'
import { SIGMA, dashboardSql, latestDaySql, parseDashboardRows } from '@/lib/plg/sigma'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Mcp = any
type Db = any
declare global { interface Window { claude?: { use(name: string): Promise<any> } } }

const CACHE = { staleTime: 6 * 3600_000, gcTime: 7 * 24 * 3600_000 }
const STORAGE_KEY = 'plg-filters'

type Problem = { code: string; message: string } | null

function problemCopy(p: NonNullable<Problem>): { title: string; body: string; canAllow?: boolean } {
  switch (p.code) {
    case 'no_runtime':
      return { title: 'Open this page in claude.ai', body: 'The dashboard reads Snowflake through your Clay Sigma connector, which is only available when the page is open in claude.ai while signed in.' }
    case 'server_not_connected':
    case 'server_not_found':
    case 'selection_required':
      return { title: 'Connect Clay Sigma', body: 'Add the Clay Sigma connector in claude.ai Settings → Connectors (or pick which one to use if you have several), then reload this page.' }
    case 'needs_reauth':
      return { title: 'Reconnect Clay Sigma', body: 'Your Sigma sign-in expired. Reconnect Clay Sigma in claude.ai Settings → Connectors, then reload.' }
    case 'not_in_manifest':
    case 'approval_required':
    case 'consent_required':
      return { title: 'Allow Clay Sigma for this page', body: 'This page needs your permission to run read-only Sigma queries with your account.', canAllow: true }
    case 'blocked_by_policy':
      return { title: 'Sigma is blocked for your account', body: 'Your organization’s policy blocks this connector tool. Ask a claude.ai admin.' }
    case 'tool_error':
      return { title: 'Sigma rejected the query', body: `${p.message} Check that your Sigma account can read DBT.PROD.FCT_PLG_WORKSPACE_BLENDED_ATTRIBUTION, DBT.PROD.CUSTOMERS and FIVETRAN.SALESFORCE.ACCOUNT.` }
    case 'server_unavailable':
      return { title: 'Sigma is not responding', body: 'Sigma or Snowflake did not answer in time. The page will show the last loaded numbers; try again in a minute.' }
    default:
      return { title: 'Could not load PLG metrics', body: p.message }
  }
}

function readSavedQs(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? '' } catch { return '' }
}
function saveQs(qs: string) {
  try { localStorage.setItem(STORAGE_KEY, qs) } catch { /* storage unavailable */ }
}

const emptyMeta = (dataEnd: ISODate, goals: GoalRow[], restatements: Meta['restatements']): Meta => ({
  min_day: null, max_day: dataEnd, last_ok_at: null, last_run: null,
  restatements, recon_mismatches: [], goals,
})

/** Compare closed-week totals with the stored log; record and return recent restatements. */
async function syncRestatements(db: Db, dataEnd: ISODate, recent: { d: ISODate; n: number }[]): Promise<Meta['restatements']> {
  const byWeek = new Map<ISODate, { n: number; days: number }>()
  for (const p of recent) {
    const wk = mondayOf(p.d)
    const w = byWeek.get(wk) ?? { n: 0, days: 0 }
    w.n += p.n; w.days += 1
    byWeek.set(wk, w)
  }
  const now = new Date().toISOString()
  const out: Meta['restatements'] = []
  for (const [wk, w] of byWeek) {
    if (w.days !== 7 || addDays(wk, 6) > dataEnd) continue // closed, fully covered weeks only
    const ref = db.doc(`weeks/${wk}`)
    try {
      const snap = await ref.get()
      const prev = snap.exists ? (snap.data() as { total: number; previous?: number; restatedAt?: string }) : null
      if (!prev) {
        await ref.set({ total: w.n, firstSeenAt: now, updatedAt: now })
      } else if (prev.total > 0 && Math.abs(w.n - prev.total) / prev.total > GUARDRAILS.restatementPct) {
        await ref.set({ total: w.n, previous: prev.total, restatedAt: now, updatedAt: now })
        out.push({ week_start: wk, old: prev.total, new: w.n, at: now })
      } else if (prev.restatedAt && prev.previous != null && Date.now() - Date.parse(prev.restatedAt) < 14 * 86_400_000) {
        out.push({ week_start: wk, old: prev.previous, new: prev.total, at: prev.restatedAt })
      }
    } catch {
      // Read-only viewers cannot write the log; skip silently.
    }
  }
  return out
}

function App() {
  const [qs, setQs] = useState(readSavedQs)
  const [mcp, setMcp] = useState<Mcp | null | undefined>(undefined)
  const [db, setDb] = useState<Db | null>(null)
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [dataEnd, setDataEnd] = useState<ISODate | null>(null)
  const [result, setResult] = useState<{ key: string; payload: unknown; storedAt: number | null } | null>(null)
  const [problem, setProblem] = useState<Problem>(null)
  const [restatements, setRestatements] = useState<Meta['restatements']>([])
  const [attempt, setAttempt] = useState(0)
  // Social tab: routed on the hash (#social, #social-peter) so links can point at it.
  const readHash = (): { tab: DashboardTab; channel: SocialChannel } => {
    const h = typeof location !== 'undefined' ? location.hash.slice(1) : ''
    return h === 'social-peter' ? { tab: 'social', channel: 'peter' } : h === 'social-payton' ? { tab: 'social', channel: 'payton' }
      : h === 'social' ? { tab: 'social', channel: 'all' } : h === 'startup' ? { tab: 'startup', channel: 'all' } : { tab: 'workspaces', channel: 'all' }
  }
  const [route, setRoute] = useState(readHash)
  const [yt, setYt] = useState<YtChannelDoc[] | null>(null)
  const [socialResult, setSocialResult] = useState<{ key: string; payload: unknown } | null>(null)
  const [socialProblem, setSocialProblem] = useState<Problem>(null)
  // Peter defaults to per-video cohorts, All channels to calendar dates; each can switch.
  const [modes, setModes] = useState<Record<SocialChannel, SocialMode>>({ all: 'calendar', peter: 'cohort', payton: 'cohort' })

  // Capabilities
  useEffect(() => {
    if (!window.claude?.use) { queueMicrotask(() => setMcp(null)); return }
    window.claude.use('mcp').then(m => setMcp(m ?? null)).catch(() => setMcp(null))
    window.claude.use('db').then(async d => {
      if (!d) return
      setDb(d)
      Promise.all(CHANNELS.filter(c => c.youtubeId).map(c => d.doc(`youtube/${c.youtubeId}`).get().catch(() => null)))
        .then(snaps => setYt(snaps.filter(x => x?.exists).map(x => x.data() as YtChannelDoc)))
        .catch(() => setYt([]))
      try {
        const snap = await d.doc('config/goals').get()
        const rows = snap.exists ? (snap.data()?.rows as GoalRow[] | undefined) : undefined
        if (Array.isArray(rows)) setGoals(rows)
      } catch { /* no overrides */ }
    }).catch(() => {})
  }, [])

  const handleError = useCallback((e: any) => {
    const code = e?.code ?? 'upstream_error'
    setProblem({ code, message: e?.message ?? String(e) })
    // Authz denials retract data; transient errors keep last-good numbers.
    if (['needs_reauth', 'server_not_connected', 'blocked_by_policy', 'approval_required', 'not_in_manifest'].includes(code)) setResult(null)
  }, [])

  // Latest complete day (re-keys daily via today's date in the SQL).
  useEffect(() => {
    if (!mcp) return
    const input = { query: { type: 'connection', connectionId: SIGMA.connectionId, sql: latestDaySql(todayUTC()) } }
    const unsub = mcp.watchTool(SIGMA.server, 'query', input, (ev: any) => {
      if (ev.type === 'error') return handleError(ev.error)
      const row = (ev.result?.payload as { rows?: unknown[][] })?.rows?.[0]
      const day = row ? String(row[0] ?? '').slice(0, 10) : ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) setDataEnd(day)
      else setProblem({ code: 'no_data', message: 'Sigma returned no complete day of data in the last 14 days.' })
    }, { cache: CACHE })
    return unsub
  }, [mcp, handleError, attempt])

  const quarters = useMemo(() => resolveQuarters(DEFAULT_QUARTERS, goals), [goals])
  const plan = useMemo(() => (dataEnd ? planDashboard(new URLSearchParams(qs), dataEnd, quarters) : null), [dataEnd, qs, quarters])
  const sql = useMemo(() => (plan ? dashboardSql(plan) : null), [plan])

  // Main query for the current filter state.
  useEffect(() => {
    if (!mcp || !sql) return
    const key = sql
    const input = { query: { type: 'connection', connectionId: SIGMA.connectionId, sql } }
    let retried = false
    const unsub = mcp.watchTool(SIGMA.server, 'query', input, (ev: any) => {
      if (ev.type === 'error') {
        if (ev.error?.retryable && !retried) {
          retried = true
          setTimeout(() => setAttempt(a => a + 1), (ev.error.retryAfterMs ?? 2000) + Math.random() * 1000)
        }
        return handleError(ev.error)
      }
      setProblem(null)
      setResult({ key, payload: ev.result?.payload, storedAt: ev.result?.cache?.storedAt ?? Date.now() })
    }, { cache: CACHE })
    return unsub
  }, [mcp, sql, handleError, attempt])

  // Parse once per result; assemble separately so restatement updates don't re-parse.
  const parsed = useMemo(() => {
    if (!plan || !result) return null
    try { return { data: parseDashboardRows(result.payload, plan), stale: result.key !== sql } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }, [plan, result, sql])

  const view = useMemo(() => {
    if (!parsed || !plan || !dataEnd) return null
    if ('error' in parsed) return { error: parsed.error }
    return { v: assembleDashboard(plan, emptyMeta(dataEnd, goals, restatements), parsed.data!, 'sigma'), stale: parsed.stale }
  }, [parsed, plan, dataEnd, goals, restatements])

  // Restatement log (only when fresh data for the current state arrives).
  const recent = parsed && 'data' in parsed && !parsed.stale ? parsed.data!.dailies.recent : null
  useEffect(() => {
    if (!db || !recent || !dataEnd) return
    let live = true
    syncRestatements(db, dataEnd, recent).then(r => { if (live) setRestatements(r) })
    return () => { live = false }
  }, [db, recent, dataEnd])

  const onChange = useCallback((patch: Partial<FilterState>) => {
    if (!view || !('v' in view) || !view.v) return
    const next = paramsFor(view.v, patch).toString()
    saveQs(next)
    setQs(next)
  }, [view])

  const allow = useCallback(async () => {
    if (!mcp) return
    try {
      await mcp.callTool(SIGMA.server, 'query', { query: { type: 'connection', connectionId: SIGMA.connectionId, sql: latestDaySql(todayUTC()) } })
      setProblem(null)
      setAttempt(a => a + 1)
    } catch (e) { handleError(e) }
  }, [mcp, handleError])

  // ── Social video tab ───────────────────────────────────────────────────────
  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((tab: DashboardTab, channel: SocialChannel) => {
    const hash = tab === 'social' ? (channel === 'all' ? '#social' : `#social-${channel}`) : tab === 'startup' ? '#startup' : ''
    try { history.replaceState(null, '', hash || location.pathname + location.search) } catch { /* sandboxed */ }
    setRoute({ tab, channel })
  }, [])
  const socialRanges = plan ? { cur: plan.summaries.cur, prev: plan.summaries.prev } : null
  // One query serves both sub-tabs; it waits for the YouTube documents (video → campaign lookup).
  const socialSqlText = useMemo(() => {
    if (!socialRanges || !dataEnd || route.tab !== 'social' || yt == null) return null
    return socialSql({ cur: socialRanges.cur, prev: socialRanges.prev, tagged: taggedVideos(yt, dataEnd), fallbacks: channelFallbacks(yt, dataEnd) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialRanges?.cur[0], socialRanges?.cur[1], socialRanges?.prev[0], socialRanges?.prev[1], route.tab, yt, dataEnd])
  useEffect(() => {
    if (!mcp || !socialSqlText) return
    const key = socialSqlText
    const input = { query: { type: 'connection', connectionId: SIGMA.connectionId, sql: socialSqlText } }
    const unsub = mcp.watchTool(SIGMA.server, 'query', input, (ev: any) => {
      if (ev.type === 'error') { setSocialProblem({ code: ev.error?.code ?? 'upstream_error', message: ev.error?.message ?? '' }); return }
      setSocialProblem(null)
      setSocialResult({ key, payload: ev.result?.payload })
    }, { cache: CACHE })
    return unsub
  }, [mcp, socialSqlText])
  const socialView = useMemo(() => {
    if (!socialResult || !socialRanges || !dataEnd) return null
    try {
      return {
        s: buildSocial({ scope: route.channel, mode: modes[route.channel], cur: socialRanges.cur, prev: socialRanges.prev, dataEnd,
          rows: parseSocialRows(socialResult.payload), yt: yt ?? [] }),
        stale: socialResult.key !== socialSqlText,
      }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialResult, yt, route.channel, modes, socialSqlText, dataEnd])

  // ── Startup program tab ──────────────────────────────────────────────────
  const startupSqlText = useMemo(() => (socialRanges && route.tab === 'startup' ? startupSql(socialRanges) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socialRanges?.cur[0], socialRanges?.cur[1], socialRanges?.prev[0], socialRanges?.prev[1], route.tab])
  const [startupResult, setStartupResult] = useState<{ key: string; payload: unknown } | null>(null)
  const [startupProblem, setStartupProblem] = useState<Problem>(null)
  useEffect(() => {
    if (!mcp || !startupSqlText) return
    const key = startupSqlText
    const input = { query: { type: 'connection', connectionId: SIGMA.connectionId, sql: startupSqlText } }
    const unsub = mcp.watchTool(SIGMA.server, 'query', input, (ev: any) => {
      if (ev.type === 'error') { setStartupProblem({ code: ev.error?.code ?? 'upstream_error', message: ev.error?.message ?? '' }); return }
      setStartupProblem(null)
      setStartupResult({ key, payload: ev.result?.payload })
    }, { cache: CACHE })
    return unsub
  }, [mcp, startupSqlText])
  const startupView = useMemo(() => {
    if (!startupResult || !socialRanges || !dataEnd) return null
    try {
      return { s: buildStartup({ cur: socialRanges.cur, prev: socialRanges.prev, dataEnd, rows: parseStartupRows(startupResult.payload) }), stale: startupResult.key !== startupSqlText }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupResult, startupSqlText, dataEnd])

  const v = view && 'v' in view ? view.v : null
  if (!v) {
    const shown: Problem = mcp === null ? { code: 'no_runtime', message: '' } : problem
    const copy = shown ? problemCopy(shown) : null
    const parseErr = view && 'error' in view ? view.error : null
    return (
      <div className="px-4 py-10 sm:px-12" style={{ background: T.page, minHeight: '100vh' }}>
        <p className="text-[13px] uppercase mb-3" style={{ letterSpacing: '0.14em', color: T.muted, fontFamily: T.mono }}>PLG weekly metrics · Workspaces</p>
        <h1 className="text-[36px] sm:text-[52px] font-bold mb-6" style={{ color: T.ink, letterSpacing: '-0.04em' }}>New workspaces &amp; pacing</h1>
        {copy || parseErr ? (
          <div className="max-w-[640px] rounded-2xl p-6 flex flex-col gap-3" style={{ background: T.tile, color: T.ink }}>
            <p className="text-[18px] font-bold">{copy?.title ?? 'Unexpected data from Sigma'}</p>
            <p className="text-[15px] leading-relaxed">{copy?.body ?? parseErr}</p>
            {copy?.canAllow && (
              <button onClick={allow} className="self-start rounded-full px-5 py-2.5 text-[15px] font-medium focus:outline-none focus:ring-2"
                style={{ background: T.ink, color: '#fff' }}>Allow and load</button>
            )}
          </div>
        ) : (
          <p className="text-[16px]" style={{ color: T.muted }}>Querying Snowflake through Sigma… The first load takes 10–30 seconds; later visits open from cache.</p>
        )}
      </div>
    )
  }

  const stale = !!(view && 'stale' in view && view.stale)
  const socialPane = route.tab !== 'social' ? null
    : yt != null && yt.length === 0 ? <p className="text-[15px]" style={{ color: T.neg }}>No YouTube data synced yet. Run scripts/sync-youtube.mjs and store its output in this page’s youtube collection.</p>
    : socialProblem && !socialView ? <p className="text-[15px]" style={{ color: T.neg }}>{problemCopy(socialProblem).title}: {problemCopy(socialProblem).body}</p>
    : !socialView ? <p className="text-[15px]" style={{ color: T.muted }}>Querying Sigma for YouTube traffic… first load takes 10–30 seconds.</p>
    : 'error' in socialView ? <p className="text-[15px]" style={{ color: T.neg }}>Unexpected data from Sigma: {socialView.error}</p>
    : <SocialView s={socialView.s} loading={socialView.stale} />
  const startupPane = route.tab !== 'startup' ? null
    : startupProblem && !startupView ? <p className="text-[15px]" style={{ color: T.neg }}>{problemCopy(startupProblem).title}: {problemCopy(startupProblem).body}</p>
    : !startupView ? <p className="text-[15px]" style={{ color: T.muted }}>Querying Sigma for startup program traffic… first load takes 10–30 seconds.</p>
    : 'error' in startupView ? <p className="text-[15px]" style={{ color: T.neg }}>Unexpected data from Sigma: {startupView.error}</p>
    : <StartupView s={startupView.s} loading={startupView.stale} />
  return (
    <DashboardView
      tab={route.tab}
      startup={startupPane}
      onTab={t => go(t, route.channel)}
      socialSubtitle={route.channel === 'peter' ? 'Peter Kang’s YouTube channel (@peterfromclay)'
        : route.channel === 'payton' ? 'Payton’s YouTube channel, Not My Business (@itsnotmybusiness)'
        : 'YouTube channels · Peter Kang and Payton, plus untagged YouTube traffic'}
      social={<div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ChannelPills value={route.channel} onChange={c => go('social', c)} />
          {route.channel === 'all' && <ModeToggle value={modes.all} onChange={m => setModes(prev => ({ ...prev, all: m }))} />}
        </div>
        {socialPane}
      </div>}
      v={v}
      loading={stale}
      error={problem && problem.code !== 'no_runtime' ? problemCopy(problem).title : null}
      onChange={onChange}
      refreshedAt={result?.storedAt ?? null}
      sourceNote="Live from Snowflake through your Clay Sigma connector. Cached up to 6 hours."
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
