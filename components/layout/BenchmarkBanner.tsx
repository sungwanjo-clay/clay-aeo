'use client'

import { useGlobalFilters } from '@/context/GlobalFilters'

export default function BenchmarkBanner() {
  const { filters } = useGlobalFilters()
  const tag = filters.promptType !== 'benchmark' && filters.promptType !== 'all'
    ? filters.promptType
    : null

  if (!tag) return null

  return (
    <div
      className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider flex items-center gap-2"
      style={{ background: 'rgba(61,184,204,0.12)', borderBottom: '1px solid rgba(61,184,204,0.25)', color: 'var(--clay-slushie)' }}
    >
      <span>Viewing:</span>
      <span>{tag}</span>
      <span style={{ opacity: 0.6 }}>— benchmark metrics are not affected</span>
    </div>
  )
}
