'use client'

import { useState } from 'react'
import { Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import type { InsightRow } from '@/lib/queries/types'
import { formatDate } from '@/lib/utils/formatters'

interface InsightCardProps {
  insight: InsightRow | null
}

export default function InsightCard({ insight }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false)

  const supportingData = insight?.supporting_data as {
    explanation?: string
    implication?: string
  } | null

  const hasDetail = !!(supportingData?.explanation || supportingData?.implication)

  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 flex gap-3">
      <div className="shrink-0 mt-0.5">
        <Lightbulb size={18} className="text-yellow-500" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-yellow-700 uppercase tracking-wide">Insight of the Day</span>
          {insight?.run_date && (
            <span className="text-xs text-yellow-600">{formatDate(insight.run_date)}</span>
          )}
        </div>
        <p className="text-sm text-yellow-900 leading-relaxed">
          {insight?.insight_text ?? 'No insight generated yet for today.'}
        </p>

        {expanded && hasDetail && (
          <div className="mt-3 space-y-2">
            {supportingData?.explanation && (
              <p className="text-xs text-yellow-800 leading-relaxed">{supportingData.explanation}</p>
            )}
            {supportingData?.implication && (
              <p className="text-xs text-yellow-700 italic leading-relaxed">
                {supportingData.implication}
              </p>
            )}
          </div>
        )}

        {hasDetail && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2 flex items-center gap-1 text-xs text-yellow-600 hover:text-yellow-800 transition-colors"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  )
}
