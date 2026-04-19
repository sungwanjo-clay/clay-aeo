'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import type { FilterParams } from '@/lib/queries/types'

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

function defaultFilters(): GlobalFilters {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 6)  // 7 days inclusive: today and the 6 days before
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
  const [filters, setFiltersState] = useState<GlobalFilters>(defaultFilters)

  const setFilters = (partial: Partial<GlobalFilters>) => {
    setFiltersState(prev => {
      const next = { ...prev, ...partial }
      if (partial.dateRange) {
        next.comparisonRange = computeComparisonRange(partial.dateRange.start, partial.dateRange.end)
      }
      return next
    })
  }

  const toQueryParams = (): FilterParams => ({
    promptType: filters.promptType,
    tags: filters.tags,
    // Use local date strings (not toISOString) to avoid UTC offset shifting
    // the date into the next/previous day for users in non-UTC timezones.
    startDate: localDateStr(filters.dateRange.start) + 'T00:00:00',
    endDate:   localDateStr(filters.dateRange.end)   + 'T23:59:59',
    prevStartDate: localDateStr(filters.comparisonRange.start) + 'T00:00:00',
    prevEndDate:   localDateStr(filters.comparisonRange.end)   + 'T23:59:59',
    platforms: filters.platform === 'all' ? [] : [filters.platform],
    topics: filters.topics,
    brandedFilter: filters.brandedFilter,
  })

  const clearAll = () => setFiltersState(defaultFilters())

  return (
    <GlobalFiltersContext.Provider value={{ filters, setFilters, toQueryParams, clearAll }}>
      {children}
    </GlobalFiltersContext.Provider>
  )
}

export function useGlobalFilters() {
  const ctx = useContext(GlobalFiltersContext)
  if (!ctx) throw new Error('useGlobalFilters must be used within GlobalFiltersProvider')
  return ctx
}
