'use client'

import { useState } from 'react'
import { toSnowflake, type TabSources } from '@/lib/plg/sources'
import { Segmented, T } from './ui'

const mono = { fontFamily: T.mono } as const

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle')
  return (
    <button type="button" className="rounded-full px-3 py-1 text-[13px]" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }}
      onClick={e => {
        const pre = (e.currentTarget.closest('[data-q]') as HTMLElement | null)?.querySelector('pre')
        navigator.clipboard?.writeText(text).then(() => setState('copied'), () => {
          if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r) }
          setState('select')
        })
      }}>
      {state === 'copied' ? 'Copied' : state === 'select' ? 'Selected: press ⌘C' : 'Copy'}
    </button>
  )
}

/** Collapsed "Sources and SQL" at the bottom of each tab: tables, definitions and the exact query for the current filters. */
export default function SourcesPanel({ src }: { src: TabSources }) {
  const [dialect, setDialect] = useState<'snowflake' | 'sigma'>('snowflake')
  const hasSigma = src.queries.some(q => q.sql.includes('"connection"."'))
  return (
    <details className="rounded-2xl px-5 py-4 sm:px-6" style={{ background: T.tile, color: T.ink }}>
      <summary className="cursor-pointer text-[15px] font-semibold select-none">Sources and SQL</summary>
      <div className="flex flex-col gap-5 pt-4 min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead><tr style={{ color: T.muted, ...mono, fontSize: 12, letterSpacing: '0.1em' }}>
              <th className="text-left px-2 py-2 uppercase font-medium">Data</th><th className="text-left px-2 py-2 uppercase font-medium">Source</th><th className="text-left px-2 py-2 uppercase font-medium">Notes</th>
            </tr></thead>
            <tbody>{src.sources.map(s => (
              <tr key={s.name} style={{ borderTop: `1px solid ${T.border}` }}>
                <td className="px-2 py-2 align-top">{s.name}</td>
                <td className="px-2 py-2 align-top break-words" style={mono}>{s.where}</td>
                <td className="px-2 py-2 align-top" style={{ color: T.muted }}>{s.what}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {src.notes?.map(n => <p key={n} className="text-[13px]" style={{ color: T.muted }}>{n}</p>)}
        {hasSigma && (
          <div className="flex flex-wrap items-center gap-3 text-[13px]" style={{ color: T.muted }}>
            <Segmented ariaLabel="SQL dialect" value={dialect} onChange={setDialect}
              options={[{ id: 'snowflake', label: 'Snowflake' }, { id: 'sigma', label: 'Sigma' }]} />
            {dialect === 'snowflake' ? 'Paste into a Snowflake worksheet; table paths are filled in.' : 'Paste into a Sigma custom SQL query on the Snowflake connection.'}
          </div>
        )}
        {src.queries.map(q => {
          const text = dialect === 'snowflake' ? toSnowflake(q.sql) : q.sql
          return (
            <div key={q.label} data-q className="flex flex-col gap-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-semibold">{q.label}</p>
                <CopyButton text={text} />
              </div>
              {q.note && <p className="text-[13px]" style={{ color: T.muted }}>{q.note}</p>}
              <pre className="rounded-xl p-3 text-[12px] leading-relaxed overflow-auto max-h-[360px]" style={{ background: '#fff', border: `1px solid ${T.border}`, ...mono, whiteSpace: 'pre' }}>{text}</pre>
            </div>
          )
        })}
      </div>
    </details>
  )
}
