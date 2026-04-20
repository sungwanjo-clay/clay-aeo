'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { PromptRow, ResponseRow } from '@/lib/queries/prompts'
import { getPlatformColor, getSentimentColor } from '@/lib/utils/colors'
import { supabase } from '@/lib/supabase/client'

function FullResponseToggle({ responseId }: { responseId: string }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && text === null && !loading) {
      setLoading(true)
      const { data } = await supabase.from('responses').select('response_text').eq('id', responseId).single()
      setText(data?.response_text ?? '')
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="text-[10px] text-gray-400 font-medium hover:text-gray-600 transition-colors"
      >
        {open ? 'Hide full response ↑' : 'Full response ↓'}
      </button>
      {open && (
        loading
          ? <div className="mt-1 h-8 rounded animate-pulse bg-gray-100" />
          : <p className="text-xs text-gray-600 mt-1 leading-relaxed max-h-40 overflow-y-auto">{text}</p>
      )}
    </div>
  )
}

interface PromptDrilldownProps {
  prompt: PromptRow
  onClose: () => void
}

export default function PromptDrilldown({ prompt, onClose }: PromptDrilldownProps) {
  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-2xl bg-white shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Prompt Detail</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* Prompt text */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Prompt</p>
            <p className="text-sm text-gray-900 leading-relaxed bg-gray-50 rounded-lg px-3 py-2.5">
              {prompt.prompt_text}
            </p>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Topic', prompt.topic],
              ['Intent', prompt.intent],
              ['PMM Use Case', prompt.pmm_use_case],
              ['PMM Classification', prompt.pmm_classification],
              ['Prompt Type', prompt.prompt_type],
              ['Tags', prompt.tags],
              ['Branded / Non-Branded', prompt.branded_or_non_branded],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
                <p className="text-sm text-gray-700">{value}</p>
              </div>
            ))}
          </div>

          {/* Per-platform responses */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Responses</p>
            <div className="space-y-4">
              {prompt.responses.map(r => (
                <div key={r.id} className="border border-gray-200 rounded-xl overflow-hidden">
                  {/* Response header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50">
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded text-white"
                      style={{ backgroundColor: getPlatformColor(r.platform) }}
                    >
                      {r.platform}
                    </span>
                    <span className="text-xs text-gray-500">{r.run_date?.split('T')[0]}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${r.clay_mentioned === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        Clay: {r.clay_mentioned ?? '—'}
                      </span>
                      {r.brand_sentiment && (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: getSentimentColor(r.brand_sentiment) }}
                        >
                          {r.brand_sentiment}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-3 space-y-3">
                    {/* Mention snippet */}
                    {r.clay_mention_snippet && (
                      <div>
                        <p className="text-[10px] text-gray-400 font-medium mb-0.5">Clay mention</p>
                        <p className="text-xs text-gray-700 italic border-l-2 border-indigo-200 pl-2">&ldquo;{r.clay_mention_snippet}&rdquo;</p>
                      </div>
                    )}

                    {/* Response text — lazy loaded on demand */}
                    <FullResponseToggle responseId={r.id} />

                    {/* Pills row */}
                    <div className="flex flex-wrap gap-2">
                      {/* Competitors */}
                      {r.competitors_mentioned?.length ? (
                        <div>
                          <p className="text-[10px] text-gray-400 font-medium mb-0.5">Competitors</p>
                          <div className="flex flex-wrap gap-1">
                            {r.competitors_mentioned.map(c => (
                              <span key={c} className="text-[10px] bg-red-50 text-red-700 px-1.5 py-0.5 rounded">{c}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Cited domains */}
                      {r.cited_domains?.length ? (
                        <div>
                          <p className="text-[10px] text-gray-400 font-medium mb-0.5">Cited Domains</p>
                          <div className="flex flex-wrap gap-1">
                            {r.cited_domains.slice(0, 5).map(d => (
                              <span key={d} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{d}</span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {/* Themes */}
                    {r.themes?.length ? (
                      <div>
                        <p className="text-[10px] text-gray-400 font-medium mb-0.5">Themes</p>
                        <div className="flex flex-wrap gap-1">
                          {r.themes.map((t, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-1.5 py-0.5 rounded text-white"
                              style={{ backgroundColor: getSentimentColor(t.sentiment) }}
                            >
                              {t.theme}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* Use case + positioning */}
                    {r.primary_use_case_attributed && (
                      <p className="text-[10px] text-gray-600"><span className="font-medium">Use case:</span> {r.primary_use_case_attributed}</p>
                    )}
                    {r.positioning_vs_competitors && (
                      <p className="text-[10px] text-gray-600"><span className="font-medium">Positioning:</span> {r.positioning_vs_competitors}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
