import { plgDb } from './db'
import { withSnowflake, FACTS_SQL, METRICS_TOTALS_SQL, DOMAIN_SEGMENT_SQL, type Row } from './snowflake'
import { addDays, mondayOf, todayUTC, type ISODate } from './dates'
import { GUARDRAILS } from './config'

export interface EtlResult {
  ok: boolean
  window: { start: ISODate; end: ISODate }
  factRows: number
  restatements: { week_start: ISODate; old: number; new: number }[]
  reconMismatchDays: ISODate[]
  error?: string
}

/**
 * Nightly refresh. Re-pulls a trailing window (default 6 full weeks + the
 * current partial week, ending yesterday UTC) and atomically replaces it, so
 * late restatements (the ~4–5% spam/internal filtering that lands 1–2 weeks
 * after a week closes) flow in automatically. Closed weeks that move more than
 * GUARDRAILS.restatementPct are written to plg_restatement_log.
 *
 * Pass `from` to backfill further back (e.g. first deploy: from=2025-10-01).
 */
export async function runPlgEtl(opts: { from?: ISODate; weeks?: number } = {}): Promise<EtlResult> {
  const end = addDays(todayUTC(), -1)                     // never include today (incomplete)
  const start = opts.from ?? mondayOf(addDays(end, -7 * (opts.weeks ?? 6)))
  const db = plgDb()

  const { data: run } = await db.from('plg_etl_runs')
    .insert({ window_start: start, window_end: end })
    .select('id').single()

  const finish = async (patch: Record<string, unknown>) => {
    if (run?.id) await db.from('plg_etl_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', run.id)
  }

  try {
    const { facts, metrics, domain } = await withSnowflake(async q => ({
      facts: await q(FACTS_SQL, [start, end]),
      metrics: await q(METRICS_TOTALS_SQL, [start, end]),
      domain: await q(DOMAIN_SEGMENT_SQL, [start, end]),
    }))

    // ── Restatement detection (closed weeks only) ────────────────────────────
    const { data: oldWeeks, error: wErr } = await db.rpc('plg_week_totals', { p_start: start, p_end: end })
    if (wErr) throw new Error(`plg_week_totals: ${wErr.message}`)
    const newWeeks = new Map<ISODate, number>()
    for (const r of facts) {
      const wk = mondayOf(String(r.day))
      newWeeks.set(wk, (newWeeks.get(wk) ?? 0) + Number(r.n))
    }
    const restatements: EtlResult['restatements'] = []
    for (const w of (oldWeeks ?? []) as { week_start: string; total: number }[]) {
      const wk = w.week_start.slice(0, 10)
      const old = Number(w.total)
      const closed = addDays(wk, 6) < todayUTC() && wk >= start
      const now = newWeeks.get(wk) ?? 0
      if (closed && old > 0 && Math.abs(now - old) / old > GUARDRAILS.restatementPct) {
        restatements.push({ week_start: wk, old, new: now })
      }
    }
    if (restatements.length) {
      await db.from('plg_restatement_log').insert(
        restatements.map(r => ({ week_start: r.week_start, old_total: r.old, new_total: r.new })))
    }

    // ── Replace, one week per call to keep payloads small ────────────────────
    let factRows = 0
    for (let ws = start; ws <= end; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6) < end ? addDays(ws, 6) : end
      const inWin = (r: Row) => String(r.day) >= ws && String(r.day) <= we
      const { data, error } = await db.rpc('plg_replace_window', {
        p_start: ws,
        p_end: we,
        p_facts: facts.filter(inWin).map(r => ({ ...r, n: Number(r.n) })),
        p_domain: domain.filter(inWin).map(r => ({ ...r, n: Number(r.n) })),
        p_metrics: metrics.filter(inWin).map(r => ({ day: r.day, n: Number(r.n) })),
      })
      if (error) throw new Error(`plg_replace_window ${ws}: ${error.message}`)
      factRows += (data as { fact_rows: number }).fact_rows
    }

    // ── Reconciliation vs canonical metrics table ────────────────────────────
    const factsByDay = new Map<string, number>()
    for (const r of facts) factsByDay.set(String(r.day), (factsByDay.get(String(r.day)) ?? 0) + Number(r.n))
    const reconMismatchDays = metrics
      .filter(m => factsByDay.get(String(m.day)) !== Number(m.n))
      .map(m => String(m.day))

    const message = [
      restatements.length ? `${restatements.length} week(s) restated` : null,
      reconMismatchDays.length ? `facts ≠ metrics table on ${reconMismatchDays.join(', ')}` : null,
    ].filter(Boolean).join('; ') || null

    await finish({ status: 'ok', fact_rows: factRows, message })
    return { ok: true, window: { start, end }, factRows, restatements, reconMismatchDays }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await finish({ status: 'error', message: msg })
    return { ok: false, window: { start, end }, factRows: 0, restatements: [], reconMismatchDays: [], error: msg }
  }
}
