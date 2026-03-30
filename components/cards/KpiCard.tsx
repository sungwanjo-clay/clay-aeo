import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import MetricTooltip, { TOOLTIP_DEFINITIONS } from '@/components/shared/MetricTooltip'
import { cn } from '@/lib/utils/cn'

interface KpiCardProps {
  label: string
  value: string
  delta?: number | null
  deltaLabel?: string
  className?: string
  invertDelta?: boolean
  deltaIsCount?: boolean  // show delta as integer count, not %
}

export default function KpiCard({
  label,
  value,
  delta,
  deltaLabel = 'vs prev period',
  className,
  invertDelta = false,
  deltaIsCount = false,
}: KpiCardProps) {
  const tooltip = TOOLTIP_DEFINITIONS[label]
  const isUp = delta != null ? delta > 0 : null
  const isGood = isUp != null ? (invertDelta ? !isUp : isUp) : null

  return (
    <div
      className={cn('p-5 flex flex-col gap-2', className)}
      style={{
        background: '#FFFFFF',
        border: '1px solid var(--clay-border)',
        borderRadius: '8px',
      }}
    >
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.45)' }}>
        {label}
        {tooltip && <MetricTooltip text={tooltip} />}
      </div>

      <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
        {value}
      </div>

      {delta != null && (
        <div className={cn('flex items-center gap-1 text-[11px] font-bold')}>
          <span
            className="flex items-center gap-1 px-1.5 py-0.5"
            style={{
              borderRadius: '4px',
              background: isGood === true ? 'rgba(61,184,204,0.15)' : isGood === false ? '#FFE0DD' : '#F0F0EE',
              color: isGood === true ? 'var(--clay-slushie)' : isGood === false ? 'var(--clay-pomegranate)' : 'rgba(26,25,21,0.5)',
            }}
          >
            {isUp === true && <TrendingUp size={11} />}
            {isUp === false && <TrendingDown size={11} />}
            {isUp === null && <Minus size={11} />}
            {isUp === true ? '+' : ''}{deltaIsCount ? Math.round(delta).toLocaleString() : `${delta.toFixed(1)}%`}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.35)' }}>{deltaLabel}</span>
        </div>
      )}

      {delta == null && (
        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'rgba(26,25,21,0.35)' }}>{deltaLabel}</div>
      )}
    </div>
  )
}
