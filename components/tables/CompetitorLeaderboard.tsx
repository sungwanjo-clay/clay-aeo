'use client'

import { useState } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import type { CompetitorRow } from '@/lib/queries/types'
import CompetitorIcon from '@/components/shared/CompetitorIcon'

interface CompetitorLeaderboardProps {
  data: CompetitorRow[]
  compareEnabled?: boolean
}

export default function CompetitorLeaderboard({ data, compareEnabled = false }: CompetitorLeaderboardProps) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? data : data.slice(0, 5)

  if (!data.length) {
    return (
      <div className="py-8 text-center text-[12px] font-semibold" style={{ color: 'rgba(26,25,21,0.35)' }}>
        No competitor data for this period
      </div>
    )
  }

  return (
    <div>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--clay-border-dashed)' }}>
            <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)', width: '32px' }}>#</th>
            <th className="pb-2 text-left text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)' }}>Competitor</th>
            <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)' }}>Visibility Score</th>
            {compareEnabled && (
              <th className="pb-2 text-right text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.4)' }}>vs Prev</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isUp = row.delta != null ? row.delta > 0 : null
            const score = row.visibility_score ?? row.sov_pct
            return (
              <tr
                key={row.competitor_name}
                style={{
                  borderBottom: '1px solid rgba(26,25,21,0.05)',
                  background: row.isOwned ? 'rgba(200,240,64,0.1)' : 'transparent',
                }}
              >
                <td className="py-3 text-[12px] font-bold" style={{ color: 'rgba(26,25,21,0.35)' }}>
                  {idx + 1}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <CompetitorIcon name={row.competitor_name} size={18} />
                    <span className="text-[13px] font-semibold" style={{ color: 'var(--clay-black)' }}>
                      {row.competitor_name}
                    </span>
                    {row.isOwned && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5"
                        style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '4px' }}
                      >
                        Owned
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-3 text-right text-[14px] font-bold tabular-nums" style={{ color: 'var(--clay-black)' }}>
                  {score.toFixed(1)}%
                </td>
                {compareEnabled && (
                  <td className="py-3 text-right">
                    {row.delta != null ? (
                      <span
                        className="inline-flex items-center gap-0.5 text-[11px] font-bold px-1.5 py-0.5"
                        style={{
                          borderRadius: '4px',
                          background: isUp ? 'var(--clay-lime)' : '#FFE0DD',
                          color: isUp ? 'var(--clay-black)' : 'var(--clay-pomegranate)',
                        }}
                      >
                        {isUp ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {isUp ? '+' : ''}{row.delta!.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-[11px]" style={{ color: 'rgba(26,25,21,0.3)' }}>—</span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {data.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 w-full py-2 text-[11px] font-bold uppercase tracking-wider hover:opacity-70 transition-opacity"
          style={{ border: '1px solid var(--clay-border-dashed)', borderRadius: '6px', color: 'rgba(26,25,21,0.5)' }}
        >
          {expanded ? 'Show less ↑' : `Expand — show all ${data.length}`}
        </button>
      )}
    </div>
  )
}
