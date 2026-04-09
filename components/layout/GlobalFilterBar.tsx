'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useGlobalFilters } from '@/context/GlobalFilters'
import { supabase } from '@/lib/supabase/client'
import { getDistinctTags, getDistinctPromptTypes, getLastRunDate, getDistinctBrandedValues } from '@/lib/queries/visibility'
import { formatDate } from '@/lib/utils/formatters'

const PLATFORMS = ['all', 'ChatGPT', 'Claude']
const PLATFORM_LABELS: Record<string, string> = { all: 'All Platforms', ChatGPT: 'ChatGPT', Claude: 'Claude' }

function toInputDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

interface FilterSelectProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}

function FilterSelect({ label, value, options, onChange }: FilterSelectProps) {
  return (
    <div className="relative inline-flex items-center">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-7 py-1.5 text-[12px] font-semibold cursor-pointer focus:outline-none"
        style={{
          background: '#FFFFFF',
          border: '1px solid var(--clay-border-dashed)',
          borderRadius: '8px',
          color: 'var(--clay-black)',
          minWidth: '120px',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.value === value ? `${label}: ${o.label}` : o.label}</option>
        ))}
      </select>
      <ChevronDown size={12} className="absolute right-2 pointer-events-none" style={{ color: 'rgba(26,25,21,0.4)' }} />
    </div>
  )
}

export default function GlobalFilterBar() {
  const { filters, setFilters, clearAll } = useGlobalFilters()
  const [tags, setTags] = useState<string[]>([])
  const [promptTypes, setPromptTypes] = useState<string[]>([])
  const [lastRunDate, setLastRunDate] = useState<string | null>(null)
  const [brandedValues, setBrandedValues] = useState<string[]>([])

  const startISO = filters.dateRange.start.toISOString()
  const endISO = filters.dateRange.end.toISOString()

  useEffect(() => {
    Promise.all([
      getDistinctTags(supabase, startISO, endISO),
      getDistinctPromptTypes(supabase),
      getLastRunDate(supabase),
      getDistinctBrandedValues(supabase),
    ]).then(([tg, pt, lr, bv]) => {
      setTags(tg)
      setPromptTypes(pt)
      setLastRunDate(lr)
      setBrandedValues(bv)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startISO, endISO])

  const isStale = lastRunDate ? Date.now() - new Date(lastRunDate).getTime() > 24 * 60 * 60 * 1000 : false

  // Synthetic keyword type value that also encodes the brandedFilter state
  const keywordTypeValue = filters.brandedFilter === 'branded'
    ? '__branded__'
    : filters.brandedFilter === 'non-branded'
      ? '__non-branded__'
      : filters.promptType

  const handleKeywordTypeChange = (v: string) => {
    if (v === '__branded__') {
      setFilters({ promptType: 'all', brandedFilter: 'branded' })
    } else if (v === '__non-branded__') {
      setFilters({ promptType: 'all', brandedFilter: 'non-branded' })
    } else {
      setFilters({ promptType: v as 'benchmark' | 'campaign' | 'all', brandedFilter: 'all' })
    }
  }

  // Exclude any DB-returned prompt types that clash with our synthetic branded options
  const filteredPromptTypes = promptTypes.filter(t => t !== 'branded' && t !== 'non-branded')

  // Normalize for comparison — DB has 'Branded' and 'Non Branded' (space, not hyphen)
  const norm = (s: string) => s.toLowerCase().replace(/[-\s]/g, '')
  const hasBranded = brandedValues.some(v => norm(v) === 'branded')
  const hasNonBranded = brandedValues.some(v => norm(v) === 'nonbranded')
  const keywordOptions = [
    { value: 'all', label: 'All' },
    ...filteredPromptTypes.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
    ...(hasNonBranded ? [{ value: '__non-branded__', label: 'Non-Branded' }] : []),
  ]

  const tagOptions = [
    { value: 'all', label: 'All Tags' },
    ...tags.map(t => ({ value: t, label: t })),
  ]

  const platformOptions = PLATFORMS.map(p => ({ value: p, label: PLATFORM_LABELS[p] }))

  return (
    <div className="px-3 py-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--clay-border)', background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 min-w-max">

        {/* Keyword Type */}
        <FilterSelect
          label="Keyword Type"
          value={keywordTypeValue}
          options={keywordOptions}
          onChange={handleKeywordTypeChange}
        />

        {/* Divider */}
        <div className="w-px h-5 mx-1" style={{ background: 'var(--clay-border-dashed)' }} />

        {/* Date Range */}
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.45)' }}>From</span>
          <input
            type="date"
            value={toInputDate(filters.dateRange.start)}
            onChange={e => {
              const start = new Date(e.target.value + 'T00:00:00')
              if (!isNaN(start.getTime())) setFilters({ dateRange: { start, end: filters.dateRange.end } })
            }}
            className="text-[12px] font-semibold px-2 py-1.5 focus:outline-none"
            style={{ border: '1px solid var(--clay-border-dashed)', borderRadius: '8px', background: '#fff', color: 'var(--clay-black)' }}
          />
          <span className="text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.45)' }}>to</span>
          <input
            type="date"
            value={toInputDate(filters.dateRange.end)}
            onChange={e => {
              const end = new Date(e.target.value + 'T23:59:59')
              if (!isNaN(end.getTime())) setFilters({ dateRange: { start: filters.dateRange.start, end } })
            }}
            className="text-[12px] font-semibold px-2 py-1.5 focus:outline-none"
            style={{ border: '1px solid var(--clay-border-dashed)', borderRadius: '8px', background: '#fff', color: 'var(--clay-black)' }}
          />
        </div>

        {/* Divider */}
        <div className="w-px h-5 mx-1" style={{ background: 'var(--clay-border-dashed)' }} />

        {/* Compare Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.6)' }}>Compare period</span>
          <div
            onClick={() => setFilters({ compareEnabled: !filters.compareEnabled })}
            className="relative"
            style={{ width: '36px', height: '20px', borderRadius: '99px', background: filters.compareEnabled ? 'var(--clay-black)' : '#D1D5DB', transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0 }}
          >
            <div style={{
              position: 'absolute', top: '2px',
              left: filters.compareEnabled ? '18px' : '2px',
              width: '16px', height: '16px', borderRadius: '50%',
              background: filters.compareEnabled ? 'var(--clay-slushie)' : '#fff',
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </label>

        {/* Divider */}
        <div className="w-px h-5 mx-1" style={{ background: 'var(--clay-border-dashed)' }} />

        {/* Platform */}
        <FilterSelect
          label="Platform"
          value={filters.platform}
          options={platformOptions}
          onChange={v => setFilters({ platform: v })}
        />

        {/* Tags */}
        {tags.length > 0 && (
          <FilterSelect
            label="Tags"
            value={filters.tags}
            options={tagOptions}
            onChange={v => setFilters({ tags: v })}
          />
        )}

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={clearAll}
            className="text-[11px] font-semibold hover:opacity-60 transition-opacity"
            style={{ color: 'rgba(26,25,21,0.45)' }}
          >
            Reset
          </button>
          <div className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'rgba(26,25,21,0.4)' }}>
            {isStale && <AlertTriangle size={11} style={{ color: 'var(--clay-tangerine)' }} />}
            <span>Updated: {lastRunDate ? formatDate(lastRunDate) : '—'}</span>
          </div>
        </div>
      </div>

      {/* Compare period label */}
      {filters.compareEnabled && (
        <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)' }}>
          Comparing {toInputDate(filters.comparisonRange.start)} → {toInputDate(filters.comparisonRange.end)}
        </div>
      )}
    </div>
  )
}
