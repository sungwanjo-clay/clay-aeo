'use client'

import { createContext, useContext, useState, ReactNode } from 'react'
import type { FilterParams } from '@/lib/queries/types'

export interface GlobalFilters {
  promptType: 'benchmark' | 'campaign' | 'all'
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

function defaultFilters(): GlobalFilters {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 7)
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
    startDate: filters.dateRange.start.toISOString(),
    endDate: filters.dateRange.end.toISOString(),
    prevStartDate: filters.comparisonRange.start.toISOString(),
    prevEndDate: filters.comparisonRange.end.toISOString(),
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
