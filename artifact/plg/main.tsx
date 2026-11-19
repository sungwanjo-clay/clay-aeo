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
import PortfolioView from '@/components/plg/portfolio/PortfolioView'
import type { CompanyRow, PortfolioData, PortfolioMeta } from '@/lib/plg/portfolio/data'
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
const fmtDay = (d: ISODate) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

type Problem = { code: string; message: string } | null

/*
 * Saved default view. Viewers without a working Clay Sigma connection see the default "Last 7 days" view from a copy
 * kept in this page's db (collection `cache`, readable by everyone who can open the page, written by editors). It is
 * refreshed whenever someone with Sigma and edit access loads the default view. Any other range needs Sigma.
 */
type Cached = { key: string; payload: unknown; storedAt: number; dataEnd: ISODate }
const CACHE_PART = 200_000   // characters per db document (db documents are capped at 256 KB)
const NO_SIGMA = new Set(['no_runtime', 'server_not_connected', 'needs_reauth', 'not_granted', 'blocked_by_policy', 'approval_required', 'not_in_manifest'])
async function readCached(db: Db, name: string): Promise<Cached | null> {
  try {
    const h = await db.doc(`cache/${name}`).get()
    if (!h?.exists) return null
    const head = h.data() as { parts: number; key: string; storedAt: number; dataEnd: ISODate }
    const parts = await Promise.all(Array.from({ length: head.parts }, (_, i) => db.doc(`cache/${name}-${i}`).get()))
    if (parts.some((x: any) => !x?.exists)) return null
    const payload = JSON.parse(parts.map((x: any) => x.data().s as string).join(''))
    return { key: head.key, payload, storedAt: head.storedAt, dataEnd: head.dataEnd }
  } catch { return null }
}
async function writeCached(db: Db, name: string, c: Cached): Promise<boolean> {
  try {
    const json = JSON.stringify(c.payload)
    const n = Math.max(1, Math.ceil(json.length / CACHE_PART))
    for (let i = 0; i < n; i++) await db.doc(`cache/${name}-${i}`).set({ s: json.slice(i * CACHE_PART, (i + 1) * CACHE_PART) })
    await db.doc(`cache/${name}`).set({ parts: n, key: c.key, storedAt: c.storedAt, dataEnd: c.dataEnd })   // header last: readers never see a half-written copy
    return true
  } catch { return false }   // viewers who can't edit the page can't write the copy
}

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
  // Saved default view (undefined = not read yet, null = none).
  const [saved, setSaved] = useState<Record<'main' | 'social' | 'startup', Cached | null> | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  // Social tab: routed on the hash (#social, #social-peter) so links can point at it.
  const readHash = (): { tab: DashboardTab; channel: SocialChannel } => {
    const h = typeof location !== 'undefined' ? location.hash.slice(1) : ''
    return h === 'social-peter' ? { tab: 'social', channel: 'peter' } : h === 'social-payton' ? { tab: 'social', channel: 'payton' } : h === 'social-eric' ? { tab: 'social', channel: 'eric' }
      : h === 'social' ? { tab: 'social', channel: 'all' } : h === 'startup' ? { tab: 'startup', channel: 'all' } : h === 'portfolio' ? { tab: 'portfolio', channel: 'all' } : { tab: 'workspaces', channel: 'all' }
  }
  const [route, setRoute] = useState(readHash)
  const [yt, setYt] = useState<YtChannelDoc[] | null>(null)
  // Portfolio tab: synced from the Supabase reporting views into db `portfolio/*` (undefined = loading, null = not synced).
  const [portfolio, setPortfolio] = useState<PortfolioData | null | undefined>(undefined)
  const [downloads, setDownloads] = useState<any>(null)
  const [socialResult, setSocialResult] = useState<{ key: string; payload: unknown } | null>(null)
  const [socialProblem, setSocialProblem] = useState<Problem>(null)
  // Peter defaults to per-video cohorts, All channels to calendar dates; each can switch.
  const [modes, setModes] = useState<Record<SocialChannel, SocialMode>>({ all: 'calendar', peter: 'cohort', payton: 'cohort', eric: 'calendar' })

  // Capabilities
  useEffect(() => {
    if (!window.claude?.use) { queueMicrotask(() => setMcp(null)); return }
    window.claude.use('mcp').then(m => setMcp(m ?? null)).catch(() => setMcp(null))
    window.claude.use('downloads').then(x => setDownloads(x ?? null)).catch(() => setDownloads(null))
    window.claude.use('db').then(async d => {
      if (!d) { setPortfolio(null); setSaved({ main: null, social: null, startup: null }); return }
      d.doc('portfolio/meta').get().then(async (snap: any) => {
        if (!snap?.exists) { setPortfolio(null); return }
        const meta = snap.data() as PortfolioMeta
        const parts = await Promise.all(Array.from({ length: meta.companyChunks ?? 0 }, (_, i) =>
          d.doc(`portfolio/companies-${i}`).get().then((x: any) => (x?.exists ? (x.data()?.rows as CompanyRow[]) : [])).catch(() => [])))
        setPortfolio({ meta, companies: parts.flat() })
      }).catch(() => setPortfolio(null))
      setDb(d)
      Promise.all((['main', 'social', 'startup'] as const).map(n => readCached(d, n)))
        .then(([main, social, startup]) => setSaved({ main, social, startup })).catch(() => setSaved({ main: null, social: null, startup: null }))
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
  // No Sigma for this viewer (no connector, not allowed, signed out of Sigma…): fall back to the saved default view.
  const sigmaDown = mcp === null || (!!problem && NO_SIGMA.has(problem.code) && !result)
  const offline = sigmaDown && !!saved?.main
  const effEnd = offline ? saved!.main!.dataEnd : dataEnd
  const plan = useMemo(() => (effEnd ? planDashboard(new URLSearchParams(offline ? '' : qs), effEnd, quarters) : null), [effEnd, qs, quarters, offline])
  const sql = useMemo(() => (plan ? dashboardSql(plan) : null), [plan])
  const defaultSql = useMemo(() => (dataEnd ? dashboardSql(planDashboard(new URLSearchParams(''), dataEnd, quarters)) : null), [dataEnd, quarters])

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
  const shownResult = offline ? { key: sql ?? '', payload: saved!.main!.payload, storedAt: saved!.main!.storedAt } : result
  const parsed = useMemo(() => {
    if (!plan || !shownResult) return null
    try { return { data: parseDashboardRows(shownResult.payload, plan), stale: !offline && shownResult.key !== sql } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, shownResult?.payload, shownResult?.key, sql, offline])

  const view = useMemo(() => {
    if (!parsed || !plan || !effEnd) return null
    if ('error' in parsed) return { error: parsed.error }
    return { v: assembleDashboard(plan, emptyMeta(effEnd, goals, restatements), parsed.data!, 'sigma'), stale: parsed.stale }
  }, [parsed, plan, effEnd, goals, restatements])

  // Keep the saved default view current: when this viewer loads the default view live, store it (editors only;
  // other viewers' writes are refused and ignored).
  useEffect(() => {
    if (!db || !result || !dataEnd || offline || result.key !== defaultSql) return
    const at = result.storedAt ?? Date.now()
    if (saved?.main && saved.main.storedAt >= at) return
    const c: Cached = { key: result.key, payload: result.payload, storedAt: at, dataEnd }
    writeCached(db, 'main', c).then(ok => { if (ok) setSaved(s => ({ ...(s ?? { social: null, startup: null }), main: c })) })
  }, [db, result, dataEnd, defaultSql, offline, saved?.main])

  // Restatement log (only when fresh data for the current state arrives).
  const recent = parsed && 'data' in parsed && !parsed.stale ? parsed.data!.dailies.recent : null
  useEffect(() => {
    if (!db || !recent || !dataEnd) return
    let live = true
    syncRestatements(db, dataEnd, recent).then(r => { if (live) setRestatements(r) })
    return () => { live = false }
  }, [db, recent, dataEnd])

  const onChange = useCallback((patch: Partial<FilterState>) => {
    if (offline) { setNotice('Other dates, comparisons and grains need a Clay Sigma connection. Connect Clay Sigma in claude.ai Settings → Connectors, then reload.'); return }
    if (!view || !('v' in view) || !view.v) return
    const next = paramsFor(view.v, patch).toString()
    saveQs(next)
    setQs(next)
  }, [view, offline])

  const allow = useCallback(async () => {
    if (!mcp) return
    try {
      await mcp.callTool(SIGMA.server, 'query', { query: { type: 'connection', connectionId: SIGMA.connectionId, sql: latestDaySql(todayUTC()) } })
      setProblem(null)
      setAttempt(a => a + 1)
    } catch (e) { handleError(e) }
  }, [mcp, handleError])

  // ── Media properties tab ───────────────────────────────────────────────────────
  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((tab: DashboardTab, channel: SocialChannel) => {
    const hash = tab === 'social' ? (channel === 'all' ? '#social' : `#social-${channel}`) : tab === 'startup' ? '#startup' : tab === 'portfolio' ? '#portfolio' : ''
    try { history.replaceState(null, '', hash || location.pathname + location.search) } catch { /* sandboxed */ }
    setRoute({ tab, channel })
  }, [])
  const socialRanges = plan ? { cur: plan.summaries.cur, prev: plan.summaries.prev } : null
  // One query serves both sub-tabs; it waits for the YouTube documents (video → campaign lookup).
  const socialSqlText = useMemo(() => {
    if (!socialRanges || !dataEnd || route.tab !== 'social' || yt == null || offline) return null
    return socialSql({ cur: socialRanges.cur, prev: socialRanges.prev, tagged: taggedVideos(yt, dataEnd), fallbacks: channelFallbacks(yt, dataEnd) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialRanges?.cur[0], socialRanges?.cur[1], socialRanges?.prev[0], socialRanges?.prev[1], route.tab, yt, dataEnd, offline])
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
  const socialShown = offline ? (saved?.social ? { key: '', payload: saved.social.payload } : null) : socialResult
  const socialView = useMemo(() => {
    if (!socialShown || !socialRanges || !effEnd) return null
    try {
      return {
        s: buildSocial({ scope: route.channel, mode: modes[route.channel], cur: socialRanges.cur, prev: socialRanges.prev, dataEnd: effEnd,
          rows: parseSocialRows(socialShown.payload), yt: yt ?? [] }),
        stale: !offline && socialShown.key !== socialSqlText,
      }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialShown?.payload, yt, route.channel, modes, socialSqlText, effEnd, offline])

  // ── Startup program tab ──────────────────────────────────────────────────
  const startupSqlText = useMemo(() => (socialRanges && route.tab === 'startup' && !offline ? startupSql(socialRanges) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [socialRanges?.cur[0], socialRanges?.cur[1], socialRanges?.prev[0], socialRanges?.prev[1], route.tab, offline])
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
  const startupShown = offline ? (saved?.startup ? { key: '', payload: saved.startup.payload } : null) : startupResult
  const startupView = useMemo(() => {
    if (!startupShown || !socialRanges || !effEnd) return null
    try {
      return { s: buildStartup({ cur: socialRanges.cur, prev: socialRanges.prev, dataEnd: effEnd, rows: parseStartupRows(startupShown.payload) }), stale: !offline && startupShown.key !== startupSqlText }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startupShown?.payload, startupSqlText, effEnd, offline])

  // Saved copies of the Media properties and Startup default views: written when this viewer loads them live in the
  // default range, and warmed in the background (at most every 12 h) once this viewer has shown it can write the copy.
  const isDefault = !offline && !!sql && sql === defaultSql
  const [canWrite, setCanWrite] = useState(false)
  useEffect(() => {
    if (!db || !dataEnd || !isDefault) return
    for (const [name, r] of [['social', socialResult], ['startup', startupResult]] as const) {
      if (!r || (name === 'social' ? r.key !== socialSqlText : r.key !== startupSqlText)) continue
      const prev = saved?.[name]
      if (prev && prev.key === r.key) continue
      const c: Cached = { key: r.key, payload: r.payload, storedAt: Date.now(), dataEnd }
      writeCached(db, name, c).then(ok => { if (ok) { setCanWrite(true); setSaved(s => ({ ...(s ?? { main: null, social: null, startup: null }), [name]: c })) } })
    }
  }, [db, dataEnd, isDefault, socialResult, startupResult, socialSqlText, startupSqlText, saved])
  useEffect(() => {
    if (!db || !mcp || !dataEnd || !isDefault || !socialRanges || yt == null || saved === undefined) return
    let live = true
    ;(async () => {
      // Probe once: only editors can write the copy, so other viewers never spend Sigma queries warming it.
      const ok = canWrite || await db.doc('cache/probe').set({ at: Date.now() }).then(() => true).catch(() => false)
      if (!ok || !live) return
      setCanWrite(true)
      const due = (c: Cached | null) => !c || c.dataEnd !== dataEnd || Date.now() - c.storedAt > 12 * 3600_000
      const jobs: ['social' | 'startup', string][] = []
      if (due(saved.social ?? null) && route.tab !== 'social')
        jobs.push(['social', socialSql({ cur: socialRanges.cur, prev: socialRanges.prev, tagged: taggedVideos(yt, dataEnd), fallbacks: channelFallbacks(yt, dataEnd) })])
      if (due(saved.startup ?? null) && route.tab !== 'startup') jobs.push(['startup', startupSql(socialRanges)])
      for (const [name, text] of jobs) {
        try {
          const res = await mcp.callTool(SIGMA.server, 'query', { query: { type: 'connection', connectionId: SIGMA.connectionId, sql: text } })
          const c: Cached = { key: text, payload: res?.payload, storedAt: Date.now(), dataEnd }
          if (live && await writeCached(db, name, c)) setSaved(s => ({ ...(s ?? { main: null, social: null, startup: null }), [name]: c }))
        } catch { /* warming is best effort */ }
      }
    })()
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, mcp, dataEnd, isDefault, yt, saved === undefined])

  const v = view && 'v' in view ? view.v : null
  if (!v) {
    // Still reading the saved copy: don't flash the "connect Sigma" error at viewers who will get the saved view.
    if (sigmaDown && saved === undefined) return <div className="px-4 py-10 sm:px-12" style={{ background: T.page, minHeight: '100vh' }}><p className="text-[16px]" style={{ color: T.muted }}>Loading…</p></div>
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
    : !socialView ? <p className="text-[15px]" style={{ color: T.muted }}>{offline ? 'No saved copy of this tab yet. It needs a Clay Sigma connection.' : 'Querying Sigma for YouTube traffic… first load takes 10–30 seconds.'}</p>
    : 'error' in socialView ? <p className="text-[15px]" style={{ color: T.neg }}>Unexpected data from Sigma: {socialView.error}</p>
    : <SocialView s={socialView.s} loading={socialView.stale} />
  const startupPane = route.tab !== 'startup' ? null
    : startupProblem && !startupView ? <p className="text-[15px]" style={{ color: T.neg }}>{problemCopy(startupProblem).title}: {problemCopy(startupProblem).body}</p>
    : !startupView ? <p className="text-[15px]" style={{ color: T.muted }}>{offline ? 'No saved copy of this tab yet. It needs a Clay Sigma connection.' : 'Querying Sigma for startup program traffic… first load takes 10–30 seconds.'}</p>
    : 'error' in startupView ? <p className="text-[15px]" style={{ color: T.neg }}>Unexpected data from Sigma: {startupView.error}</p>
    : <StartupView s={startupView.s} loading={startupView.stale} />
  return (
    <DashboardView
      tab={route.tab}
      startup={startupPane}
      portfolio={route.tab === 'portfolio' ? <PortfolioView data={portfolio}
        onExport={downloads ? async (filename, csv) => { await downloads.save({ filename, data: new Blob([csv], { type: 'text/csv' }) }) } : undefined} /> : null}
      onTab={t => go(t, route.channel)}
      socialSubtitle={route.channel === 'peter' ? 'Peter Kang’s YouTube channel (@peterfromclay)'
        : route.channel === 'payton' ? 'Payton’s YouTube channel, Not My Business (@itsnotmybusiness)'
        : route.channel === 'eric' ? 'Eric Nowoslawski’s YouTube channel (@ericnowoslawski) · matched on his affiliate code, by channel'
        : 'YouTube channels · Peter Kang, Payton and Eric Nowoslawski, plus untagged YouTube traffic'}
      social={<div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ChannelPills value={route.channel} onChange={c => go('social', c)} />
          {route.channel === 'all' && <ModeToggle value={modes.all} onChange={m => setModes(prev => ({ ...prev, all: m }))} />}
        </div>
        {socialPane}
      </div>}
      v={v}
      loading={stale}
      error={offline ? null : problem && problem.code !== 'no_runtime' ? problemCopy(problem).title : null}
      notice={offline ? <span className="flex flex-wrap items-center gap-3">
        <span>{notice ?? `Showing the saved Last 7 days view (data through ${fmtDay(saved!.main!.dataEnd)}). Other dates, comparisons and grains need a Clay Sigma connection: add Clay Sigma in claude.ai Settings → Connectors, then reload.`}</span>
        {problem && problemCopy(problem).canAllow && <button onClick={allow} className="rounded-full px-4 py-1.5 text-[14px] font-medium" style={{ background: T.ink, color: '#fff' }}>Allow Clay Sigma</button>}
      </span> : null}
      onChange={onChange}
      refreshedAt={offline ? saved!.main!.storedAt : result?.storedAt ?? null}
      sourceNote={offline ? 'Saved copy of the default view, refreshed when someone with Sigma opens the dashboard.' : 'Live from Snowflake through your Clay Sigma connector. Cached up to 6 hours.'}
    />
  )
}

createRoot(document.getElementById('root')!).render(<App />)
