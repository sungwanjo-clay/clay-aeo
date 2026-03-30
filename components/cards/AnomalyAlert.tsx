'use client'

import { X, AlertTriangle, AlertCircle, Info, CheckCircle } from 'lucide-react'
import type { AnomalyRow } from '@/lib/queries/types'
import { cn } from '@/lib/utils/cn'
import { supabase } from '@/lib/supabase/client'
import { dismissAnomaly } from '@/lib/queries/home'

interface AnomalyAlertProps {
  anomalies: AnomalyRow[]
  onDismiss: (id: string) => void
}

const SEVERITY_CONFIG = {
  critical: { icon: AlertCircle, color: 'bg-red-50 border-red-200 text-red-800', badge: 'bg-red-100 text-red-700' },
  high: { icon: AlertCircle, color: 'bg-red-50 border-red-200 text-red-800', badge: 'bg-red-100 text-red-700' },
  warning: { icon: AlertTriangle, color: 'bg-orange-50 border-orange-200 text-orange-800', badge: 'bg-orange-100 text-orange-700' },
  medium: { icon: AlertTriangle, color: 'bg-orange-50 border-orange-200 text-orange-800', badge: 'bg-orange-100 text-orange-700' },
  info: { icon: Info, color: 'bg-yellow-50 border-yellow-200 text-yellow-800', badge: 'bg-yellow-100 text-yellow-700' },
  low: { icon: Info, color: 'bg-yellow-50 border-yellow-200 text-yellow-800', badge: 'bg-yellow-100 text-yellow-700' },
}

export default function AnomalyAlert({ anomalies, onDismiss }: AnomalyAlertProps) {
  async function handleDismiss(id: string) {
    await dismissAnomaly(supabase, id)
    onDismiss(id)
  }

  if (!anomalies.length) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl p-4">
        <CheckCircle size={16} className="text-green-500 shrink-0" />
        All metrics normal — no anomalies detected in the last 7 days.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {anomalies.map(a => {
        const cfg = SEVERITY_CONFIG[a.severity as keyof typeof SEVERITY_CONFIG] ?? SEVERITY_CONFIG.low
        const Icon = cfg.icon
        return (
          <div key={a.id} className={cn('flex items-start gap-3 rounded-xl border p-3', cfg.color)}>
            <Icon size={16} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded', cfg.badge)}>
                  {a.severity}
                </span>
                <span className="text-xs font-semibold">{a.metric}</span>
                {a.platform && <span className="text-xs opacity-70">{a.platform}</span>}
              </div>
              <p className="text-xs mt-0.5 leading-relaxed">{a.message}</p>
            </div>
            <button
              onClick={() => handleDismiss(a.id)}
              className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
