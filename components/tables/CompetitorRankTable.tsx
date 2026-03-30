'use client'

import { useState } from 'react'
import type { CompetitorRow } from '@/lib/queries/types'
import { cn } from '@/lib/utils/cn'
import DownloadButton, { downloadCSV } from '@/components/shared/DownloadButton'
import CompetitorIcon from '@/components/shared/CompetitorIcon'

interface CompetitorRankTableProps {
  data: CompetitorRow[]
}

type SortKey = 'competitor_name' | 'mention_count' | 'sov_pct' | 'avg_position'

export default function CompetitorRankTable({ data }: CompetitorRankTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('mention_count')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 25

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey] ?? 0
    const bv = b[sortKey] ?? 0
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function SortHeader({ col, label }: { col: SortKey; label: string }) {
    return (
      <th
        className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none"
        onClick={() => toggleSort(col)}
      >
        {label} {sortKey === col ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Competitor Ranking</h3>
        <DownloadButton
          onClick={() => downloadCSV('competitor_rank.csv', sorted.map((r, i) => ({ rank: i + 1, ...r })))}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">Rank</th>
              <SortHeader col="competitor_name" label="Competitor" />
              <SortHeader col="mention_count" label="Mentions" />
              <SortHeader col="sov_pct" label="SOV %" />
              <SortHeader col="avg_position" label="Avg Position" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((row, i) => {
              const isClay = row.competitor_name.toLowerCase() === 'clay'
              return (
                <tr
                  key={row.competitor_name}
                  className={cn(
                    'border-b border-gray-50 text-sm',
                    isClay ? 'bg-indigo-50' : i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white',
                    'hover:bg-gray-50'
                  )}
                >
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{page * PAGE_SIZE + i + 1}</td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">
                    <div className="flex items-center gap-2">
                      <CompetitorIcon name={row.competitor_name} size={16} />
                      {row.competitor_name}
                      {isClay && <span className="ml-0.5 text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">Clay</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700 tabular-nums">{row.mention_count.toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-gray-700 tabular-nums">{row.sov_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-gray-700 tabular-nums">{row.avg_position != null ? `#${row.avg_position.toFixed(1)}` : '—'}</td>
                </tr>
              )
            })}
            {!paginated.length && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-400">No competitor data</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs text-gray-500">
          <span>{sorted.length} total</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">← Prev</button>
            <span>Page {page + 1} of {Math.ceil(sorted.length / PAGE_SIZE)}</span>
            <button disabled={(page + 1) * PAGE_SIZE >= sorted.length} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}
