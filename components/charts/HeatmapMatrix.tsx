'use client'

interface HeatmapCell {
  competitor: string
  platform: string
  visibility_score: number
}

interface HeatmapMatrixProps {
  data: HeatmapCell[]
}

function getColor(score: number): string {
  // 0 = oat/white, mid = teal (#3DB8CC), high = lime (#C8F040)
  if (score <= 0) return 'rgba(237, 232, 220, 0.4)' // near-oat for zero
  const t = Math.min(score / 80, 1)
  if (t < 0.5) {
    // teal to white blend for low-mid
    const a = t * 2
    const r = Math.round(61 + (255 - 61) * (1 - a))
    const g = Math.round(184 + (255 - 184) * (1 - a))
    const b = Math.round(204 + (255 - 204) * (1 - a))
    return `rgb(${r},${g},${b})`
  } else {
    // teal to lime blend for mid-high
    const a = (t - 0.5) * 2
    const r = Math.round(61 + (200 - 61) * a)
    const g = Math.round(184 + (240 - 184) * a)
    const b = Math.round(204 + (64 - 204) * a)
    return `rgb(${r},${g},${b})`
  }
}

export default function HeatmapMatrix({ data }: HeatmapMatrixProps) {
  const platforms = [...new Set(data.map(d => d.platform))]
  const competitors = [...new Set(data.map(d => d.competitor))]
  const sorted = competitors.sort((a, b) => {
    const aScore = data.filter(d => d.competitor === a).reduce((s, r) => s + r.visibility_score, 0)
    const bScore = data.filter(d => d.competitor === b).reduce((s, r) => s + r.visibility_score, 0)
    return bScore - aScore
  })

  if (!data.length) {
    return <p className="text-sm text-gray-400 py-8 text-center">No competitor data</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full min-w-[400px]">
        <thead>
          <tr>
            <th className="text-left p-2 text-gray-500 font-medium w-32">Competitor</th>
            {platforms.map(p => (
              <th key={p} className="text-center p-2 text-gray-500 font-medium">{p}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(comp => {
            const isClay = comp.toLowerCase() === 'clay'
            return (
              <tr key={comp} className={isClay ? 'ring-2 ring-inset ring-[#C8F040]' : ''}>
                <td className={`p-2 font-medium`} style={{ color: isClay ? 'var(--clay-black)' : '#4B5563' }}>
                  {comp}
                  {isClay && <span className="ml-1 text-[9px] px-1 rounded" style={{ background: '#C8F040', color: 'var(--clay-black)' }}>Clay</span>}
                </td>
                {platforms.map(p => {
                  const cell = data.find(d => d.competitor === comp && d.platform === p)
                  const score = cell?.visibility_score ?? 0
                  return (
                    <td
                      key={p}
                      className="p-2 text-center font-medium"
                      style={{ backgroundColor: getColor(score) }}
                      title={`${comp} on ${p}: ${score.toFixed(1)}%`}
                    >
                      {score > 0 ? `${score.toFixed(0)}%` : '—'}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
