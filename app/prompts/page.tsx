'use client'

import { useEffect, useState } from 'react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import { getPromptsWithResponses, getPromptStats } from '@/lib/queries/prompts'
import type { PromptRow } from '@/lib/queries/prompts'
import PromptsTable from '@/components/tables/PromptsTable'
import { SkeletonTable } from '@/components/shared/Skeleton'

interface Stats { total: number; benchmark: number; campaign: number; inactive: number }

export default function PromptsPage() {
  const { toQueryParams, initialized } = useGlobalFilters()
  const f = toQueryParams()

  const [loading, setLoading] = useState(true)
  const [prompts, setPrompts] = useState<PromptRow[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  useEffect(() => {
    if (!initialized) return
    setLoading(true)
    Promise.all([
      getPromptsWithResponses(supabase, f, showInactive),
      getPromptStats(supabase),
    ]).then(([ps, st]) => {
      setPrompts(ps)
      setStats(st)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.endDate, f.promptType, f.platforms.join(), f.topics.join(), f.brandedFilter, showInactive, initialized])

  function getAvgVisibility() {
    if (!prompts.length) return null
    const vals = prompts.flatMap(p => {
      if (!p.responses.length) return []
      const yes = p.responses.filter(r => r.clay_mentioned === 'Yes').length
      return [(yes / p.responses.length) * 100]
    })
    if (!vals.length) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
  }

  const avgVis = getAvgVisibility()

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Prompts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Browse every prompt and result</p>
        </div>
        {/* Inactive toggle */}
        {stats && stats.inactive > 0 && (
          <button
            onClick={() => setShowInactive(v => !v)}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
              showInactive
                ? 'bg-gray-200 text-gray-700 border-gray-300'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {showInactive ? 'Hiding inactive prompts' : `Show inactive (${stats.inactive})`}
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap gap-4 bg-white rounded-xl border border-gray-200 p-4">
        <div>
          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Active Prompts</p>
          <p className="text-2xl font-bold text-gray-900">{stats?.total ?? '—'}</p>
        </div>
        <div className="w-px bg-gray-100" />
        <div>
          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Benchmark</p>
          <p className="text-2xl font-bold text-indigo-700">{stats?.benchmark ?? '—'}</p>
        </div>
        <div className="w-px bg-gray-100" />
        <div>
          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Campaign</p>
          <p className="text-2xl font-bold text-orange-600">{stats?.campaign ?? '—'}</p>
        </div>
        <div className="w-px bg-gray-100" />
        <div>
          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Avg Visibility</p>
          <p className="text-2xl font-bold text-gray-900">{avgVis != null ? `${avgVis.toFixed(1)}%` : '—'}</p>
        </div>
        {stats && stats.inactive > 0 && (
          <>
            <div className="w-px bg-gray-100" />
            <div>
              <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wide">Removed from Clay</p>
              <p className="text-2xl font-bold text-gray-400">{stats.inactive}</p>
            </div>
          </>
        )}
        <div className="ml-auto text-xs text-gray-400 self-end">
          {prompts.length} prompts in selected period
        </div>
      </div>

      {/* Inactive banner */}
      {showInactive && (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />
          Showing inactive prompts — rows marked with &ldquo;Removed from Clay&rdquo; have not been seen in 7+ days and are excluded from all KPI calculations.
        </div>
      )}

      {/* Prompts table */}
      {loading ? <SkeletonTable /> : <PromptsTable data={prompts} />}
    </div>
  )
}
