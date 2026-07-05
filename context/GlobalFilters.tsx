'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import type { FilterParams } from '@/lib/queries/types'
import { supabase } from '@/lib/supabase/client'
import { getMaxCachedDate, getLastRunDate } from '@/lib/queries/visibility'

export interface GlobalFilters {
  promptType: string  // 'all' or any prompt_type value from DB (e.g. 'benchmark', 'branded')
  tags: string        // 'all' or specific tag value
  dateRange: { start: Date; end: Date }
  comparisonRange: { start: Date; end: Date }
  compareEnabled: boolean
  platform: string    // 'all' | 'Claude' | 'ChatGPT'
  topics: string[]
  brandedFilter: 'all' | 'branded' | 'non-branded'
}

interface GlobalFiltersContextValue {
  filters: GlobalFilters
  setFilters: (f: Partial<GlobalFilters>) => void
  toQueryParams: () => FilterParams
  clearAll: () => void
  maxCachedDate: string | null  // YYYY-MM-DD of the most recent cached day
  lastRunDate: string | null    // YYYY-MM-DD of the most recent raw data row (from responses table)
  initialized: boolean          // true once maxCachedDate has loaded and the date window has been snapped
}

function computeComparisonRange(start: Date, end: Date): { start: Date; end: Date } {
  const diffMs = end.getTime() - start.getTime()
  const prevEnd = new Date(start.getTime() - 86400000)
  const prevStart = new Date(prevEnd.getTime() - diffMs)
  return { start: prevStart, end: prevEnd }
}

/** Format a Date as a local-timezone date string (YYYY-MM-DD).
 *  Avoids the toISOString() UTC-conversion bug: e.g. at 5pm PDT (UTC-7),
 *  toISOString() returns the next day in UTC, causing April 10 to appear
 *  as the end date when today is still April 9 locally.
 */
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const CACHE_DATE_KEY = 'aeo_max_cached_date'

/** Read the last-known maxCachedDate from localStorage (sync, safe for SSR). */
function readStoredCacheDate(): string | null {
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(CACHE_DATE_KEY) } catch { return null }
}

/** Persist maxCachedDate to localStorage so the next load can skip the DB wait. */
function writeStoredCacheDate(d: string) {
  try { localStorage.setItem(CACHE_DATE_KEY, d) } catch { /* ignore */ }
}

/**
 * Build the initial filter state.
 * If we have a stored cacheDate from a previous visit, snap the date window to it
 * synchronously so pages can start fetching on the very first render.
 */
function defaultFilters(storedCacheDate: string | null = null): GlobalFilters {
  const today = new Date()
  today.setHours(23, 59, 59, 999)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setHours(0, 0, 0, 0)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6)

  let end = today
  let start = sevenDaysAgo

  if (storedCacheDate) {
    const todayStr = localDateStr(today)
    if (storedCacheDate < todayStr) {
      // Snap end to stored cache date, preserve 7-day window
      end = new Date(storedCacheDate + 'T23:59:59')
      start = new Date(storedCacheDate + 'T00:00:00')
      start.setDate(start.getDate() - 6)
    }
  }

  return {
    promptType: 'benchmark',
    tags: 'all',
    dateRange: { start, end },
    comparisonRange: computeComparisonRange(start, end),
    compareEnabled: false,
    platform: 'all',
    topics: [],
    brandedFilter: 'all',
  }
}

const GlobalFiltersContext = createContext<GlobalFiltersContextValue | null>(null)

export function GlobalFiltersProvider({ children }: { children: ReactNode }) {
  // All state initializes to safe server-side defaults.
  // localStorage is applied inside the useEffect (client-only) before the DB call fires.
  const [filters, setFiltersState] = useState<GlobalFilters>(defaultFilters)
  const [maxCachedDate, setMaxCachedDate] = useState<string | null>(null)
  const [lastRunDate, setLastRunDate] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    // ── Phase 1: instant client-side init from localStorage ──────────────────
    // localStorage is browser-only — can't run during SSR. Reading it inside
    // useEffect (which only runs on the client) and calling setState here batches
    // into a single synchronous re-render that fires before the DB call resolves.
    // On return visits this effectively eliminates the initialization latency.
    const stored = readStoredCacheDate()
    if (stored) {
      setMaxCachedDate(stored)
      setFiltersState(defaultFilters(stored))
      setInitialized(true)  // unblocks all page data fetches before DB responds
    }

    // ── Phase 2: DB call to verify/update the stored value ───────────────────
    // Runs in the background. On return visits the page is already fetching data
    // (from Phase 1). On first-ever visit (no localStorage) this is the only path.
    Promise.all([
      getMaxCachedDate(supabase),
      getLastRunDate(supabase),
    ]).then(([cacheDate, runDate]) => {
      if (runDate) setLastRunDate(runDate)

      const d = cacheDate ?? runDate
      if (!d) {
        if (!stored) setInitialized(true)  // unblock even if cache is empty
        return
      }

      writeStoredCacheDate(d)
      setMaxCachedDate(d)

      // ── Snap filter window to cache date ─────────────────────────────────────
      // When end is clamped, also slide start to preserve the 7-day window.
      // Calendar-day arithmetic avoids the off-by-one from millisecond subtraction.
      setFiltersState(prev => {
        const prevEnd = localDateStr(prev.dateRange.end)
        if (d >= prevEnd) return prev  // cache is current, no change needed

        const snappedEnd = new Date(d + 'T23:59:59')
        const origDays = Math.round(
          (prev.dateRange.end.getTime() - prev.dateRange.start.getTime()) / 86400000
        )
        const snappedStart = new Date(d + 'T00:00:00')
        snappedStart.setDate(snappedStart.getDate() - (origDays - 1))

        return {
          ...prev,
          dateRange: { start: snappedStart, end: snappedEnd },
          comparisonRange: computeComparisonRange(snappedStart, snappedEnd),
        }
      })

      // On first-ever visit Phase 1 didn't run, so mark initialized here instead
      if (!stored) setInitialized(true)

      // NOTE: Cache self-healing is handled server-side by the pg_cron
      // 'refresh-dashboard-cache' job, NOT on page load. A browser-triggered
      // refresh would fire a heavy DB rebuild per viewer and risk lock
      // contention / timeouts when multiple users load a stale dashboard.
    }).catch(() => {
      if (!stored) setInitialized(true)  // unblock pages even if cache lookup fails
    })
  }, [])

  const setFilters = (partial: Partial<GlobalFilters>) => {
    setFiltersState(prev => {
      const next = { ...prev, ...partial }
      if (partial.dateRange) {
        next.comparisonRange = computeComparisonRange(partial.dateRange.start, partial.dateRange.end)
      }
      return next
    })
  }

  const toQueryParams = (): FilterParams => {
    // Clamp endDate to the last cached day so cache-backed queries stay consistent
    // with raw-table queries. If cache hasn't loaded yet, use the filter date as-is.
    const rawEnd = localDateStr(filters.dateRange.end)
    const clampedEnd = maxCachedDate && maxCachedDate < rawEnd ? maxCachedDate : rawEnd

    return {
      promptType: filters.promptType,
      tags: filters.tags,
      startDate: localDateStr(filters.dateRange.start) + 'T00:00:00',
      endDate:   clampedEnd + 'T23:59:59',
      prevStartDate: localDateStr(filters.comparisonRange.start) + 'T00:00:00',
      prevEndDate:   localDateStr(filters.comparisonRange.end)   + 'T23:59:59',
      platforms: filters.platform === 'all' ? [] : [filters.platform],
      topics: filters.topics,
      brandedFilter: filters.brandedFilter,
    }
  }

  // Reset to the default window, snapped to the last cached day (not "today"),
  // so Reset doesn't reintroduce trailing empty days in the charts.
  const clearAll = () => setFiltersState(defaultFilters(maxCachedDate))

  return (
    <GlobalFiltersContext.Provider value={{ filters, setFilters, toQueryParams, clearAll, maxCachedDate, lastRunDate, initialized }}>
      {children}
    </GlobalFiltersContext.Provider>
  )
}

export function useGlobalFilters() {
  const ctx = useContext(GlobalFiltersContext)
  if (!ctx) throw new Error('useGlobalFilters must be used within GlobalFiltersProvider')
  return ctx
}
