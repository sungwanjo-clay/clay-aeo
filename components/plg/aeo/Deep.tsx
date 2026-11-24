'use client'

import { useEffect, useMemo, useState } from 'react'
import { domainUrls, narratives, type AeoData, type NarrRow, type Range, type Ranked, type Sentiment, type Snippet } from '@/lib/plg/aeo/data'
import { Card, Def, H2, InfoTip, Segmented, T, deltaColor, fmtInt, fmtPct, fmtPp } from '../ui'

const mono = { fontFamily: T.mono } as const
const th = 'px-3 py-2.5 text-[12px] font-medium uppercase whitespace-nowrap'
const head = { color: T.muted, letterSpacing: '0.12em', fontFamily: T.mono, borderBottom: `1px solid ${T.border}` } as const
const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : undefined)
const pathOf = (u: string) => { try { const x = new URL(u); return x.host + x.pathname } catch { return u } }

/** Minimal db shape the notes need (the artifact `db` capability). */
export type NotesDb = { doc(path: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void> }
  collection(path: string): { get(): Promise<{ docs: { id: string; data(): Record<string, unknown> | undefined }[] }> } } | null

function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
    className="rounded-full px-4 py-2 text-[14px] w-full sm:w-[260px] focus:outline-none focus:ring-2" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }} />
}

function PP({ c, p }: { c: number | null; p: number | null }) {
  if (c == null || p == null) return <span style={{ color: T.faint }}>–</span>
  const d = (c - p) * 100, z = Math.abs(d) < 0.05 ? 0 : d
  return <span style={{ ...mono, color: deltaColor(z) }}>{fmtPp(z)}</span>
}

// ─── Top cited domains ────────────────────────────────────────────────────────

const CHIP: Record<string, { label: string; bg: string; ink: string }> = {
  owned: { label: 'Owned', bg: '#E3F4E8', ink: '#1E6B3A' },
  Competition: { label: 'Competition', bg: '#FBE7E1', ink: '#9A3412' },
  Institution: { label: 'Institution', bg: '#E6EEFF', ink: '#1E3A8A' },
}
function DomainChip({ r }: { r: Ranked }) {
  const c = r.isClay ? CHIP.owned : r.type ? CHIP[r.type] : undefined
  if (c) return <span className="rounded-full px-2 py-0.5 text-[11px] uppercase shrink-0" style={{ background: c.bg, color: c.ink, letterSpacing: '0.08em', ...mono }}>{c.label}</span>
  if (r.type && r.type !== 'Other') return <span className="text-[12px] shrink-0" style={{ color: T.faint }}>{r.type}</span>
  return null
}
function Tile({ name, clay }: { name: string; clay?: boolean }) {
  return <span aria-hidden="true" className="inline-flex w-5 h-5 items-center justify-center rounded-md text-[11px] font-semibold uppercase shrink-0"
    style={{ background: clay ? T.ink : '#ECEAE4', color: clay ? '#fff' : T.muted }}>{name.replace(/^www\./, '')[0]}</span>
}

export function DomainsTable({ data, slice, rows, cur, show = 15 }: { data: AeoData; slice: string; rows: Ranked[]; cur: Range; show?: number }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [all, setAll] = useState(false)
  const [moreUrls, setMoreUrls] = useState<Set<string>>(new Set())
  const hasUrls = !!data.urls?.[slice]
  const urlsOf = useMemo(() => Object.fromEntries(rows.map(r => [r.name, hasUrls ? domainUrls(data, slice, r.name, cur) : []])), [rows, data, slice, cur, hasUrls])
  const needle = q.trim().toLowerCase()
  const matchUrl = (u: { url: string; title: string }) => !!needle && (u.title.toLowerCase().includes(needle) || u.url.toLowerCase().includes(needle))
  const filtered = needle ? rows.filter(r => r.name.includes(needle) || urlsOf[r.name].some(matchUrl)) : rows
  const visible = needle || all ? filtered : [...filtered.slice(0, show), ...filtered.slice(show).filter(r => r.isClay)]
  const toggle = (set: Set<string>, k: string, f: (s: Set<string>) => void) => { const s = new Set(set); if (s.has(k)) s.delete(k); else s.add(k); f(s) }

  return (
    <Card className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2"><H2>Top cited domains</H2>
            <InfoTip label="About cited domains"><Def d="Of answers that cite any source, the share citing each domain. Open a domain to see which of its pages get cited." note="An answer can cite several domains, so shares add up to more than 100%. Clay-owned domains are always listed." /></InfoTip></div>
          <p className="text-[15px]" style={{ color: T.muted }}>Click a domain for its most-cited pages</p>
        </div>
        <Search value={q} onChange={setQ} placeholder="Search domain or page…" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[14px]" style={{ color: T.ink }}>
          <thead><tr style={head}>
            <th className={`${th} text-left w-10`}>#</th><th className={`${th} text-left`}>Domain</th>
            <th className={`${th} text-right`}>Answers</th><th className={`${th} text-right`}>Cited in</th><th className={`${th} text-right`}>Change</th><th className="w-8" />
          </tr></thead>
          <tbody>{visible.map(r => {
            const isOpen = open.has(r.name) || (!!needle && urlsOf[r.name].some(matchUrl))
            const urls = urlsOf[r.name], cap = moreUrls.has(r.name) ? urls.length : 8
            return [
              <tr key={r.name} onClick={() => hasUrls && toggle(open, r.name, setOpen)} aria-expanded={hasUrls ? isOpen : undefined}
                className={hasUrls ? 'cursor-pointer hover:bg-[#FAF9F6]' : undefined}
                style={{ borderBottom: isOpen ? 'none' : `1px solid ${T.border}`, background: r.isClay ? '#F6F5F1' : undefined }}>
                <td className="px-3 py-2.5" style={{ ...mono, color: T.muted }}>{rows.indexOf(r) + 1}</td>
                <td className="px-3 py-2.5 max-w-0 w-full">
                  <div className="flex items-center gap-2 min-w-0" style={{ fontWeight: r.isClay ? 600 : 400 }}>
                    <Tile name={r.name} clay={r.isClay} /><span className="truncate min-w-0">{r.name}</span><DomainChip r={r} />
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap" style={{ ...mono, color: T.muted }}>{fmtInt(r.n)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap" style={mono}>{fmtPct(r.value)}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap"><PP c={r.value} p={r.prev} /></td>
                <td className="px-2 py-2.5 text-center" style={{ color: T.muted }}>{hasUrls ? (isOpen ? '▾' : '▸') : ''}</td>
              </tr>,
              isOpen && <tr key={`${r.name}-urls`} style={{ borderBottom: `1px solid ${T.border}`, background: '#FAF9F6' }}>
                <td />
                <td colSpan={5} className="px-3 pb-3 pt-1">
                  {urls.length === 0 ? <p className="text-[13px] py-1" style={{ color: T.faint }}>No page-level citations in this period.</p> : (
                    <ul className="flex flex-col">
                      {urls.slice(0, cap).map(u => (
                        <li key={u.url} className="flex items-start justify-between gap-4 py-1.5" style={{ borderTop: `1px dashed ${T.border}` }}>
                          <a href={safeHref(u.url)} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="min-w-0 group">
                            <span className="flex items-baseline gap-1.5"><span aria-hidden="true" style={{ color: T.faint }}>↗</span>
                              <span className="font-medium group-hover:underline underline-offset-2 break-words" style={{ color: matchUrl(u) ? T.pos : T.ink }}>{u.title || pathOf(u.url)}</span>
                              {u.type && u.type !== 'Other' && <span className="text-[12px] shrink-0" style={{ color: T.faint }}>{u.type}</span>}</span>
                            <span className="block text-[12px] truncate pl-4" style={{ ...mono, color: T.muted }}>{pathOf(u.url)}</span>
                          </a>
                          <span className="text-[13px] shrink-0 pt-0.5" style={{ ...mono, color: T.muted }}>{fmtInt(u.n)}</span>
                        </li>
                      ))}
                      {urls.length > 8 && <li><button onClick={e => { e.stopPropagation(); toggle(moreUrls, r.name, setMoreUrls) }} className="text-[13px] underline underline-offset-4 pt-1.5" style={{ color: T.muted }}>
                        {moreUrls.has(r.name) ? 'Show fewer pages' : `+ ${urls.length - 8} more pages`}</button></li>}
                    </ul>
                  )}
                </td>
              </tr>,
            ]
          })}</tbody>
        </table>
        {visible.length === 0 && <p className="text-[14px] py-6 text-center" style={{ color: T.faint }}>No domain or page matches “{q}”.</p>}
      </div>
      {!needle && filtered.length > show && <button onClick={() => setAll(!all)} className="self-start text-[14px] underline underline-offset-4" style={{ color: T.muted }}>
        {all ? 'Show fewer' : `Show all ${filtered.length}`}</button>}
      {hasUrls && <p className="text-[13px]" style={{ color: T.muted }}>Page counts are answers citing that page. The 15 most-cited pages of each domain are kept.</p>}
    </Card>
  )
}

// ─── Narrative intelligence ──────────────────────────────────────────────────

const SENT: Record<Sentiment, { dot: string; ink: string }> = {
  Negative: { dot: T.neg, ink: T.neg }, Neutral: { dot: '#9A968E', ink: T.muted }, Positive: { dot: '#1F8A4C', ink: '#1F6B3A' },
}
const PLATFORM: Record<string, { bg: string; ink: string }> = {
  ChatGPT: { bg: '#E2F4EE', ink: '#0B6B53' }, Claude: { bg: '#FBE6F0', ink: '#9D2462' }, Gemini: { bg: '#E6EEFF', ink: '#1E3A8A' }, Perplexity: { bg: '#EFE9FB', ink: '#5B21B6' },
}
const STATUS = [{ id: 'open', label: 'Not started' }, { id: 'working', label: 'Working on it' }, { id: 'done', label: 'Addressed' }] as const
type Status = (typeof STATUS)[number]['id']
type Note = { status: Status; note: string; updatedAt?: string }
const noteId = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'theme'

function Chips({ s }: { s: Snippet }) {
  const p = PLATFORM[s.p] ?? { bg: '#EFEEEA', ink: T.muted }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="rounded-full px-2 py-0.5" style={{ background: p.bg, color: p.ink }}>{s.p}</span>
      {s.tp && <span className="rounded-full px-2 py-0.5" style={{ background: '#EFEEEA', color: T.muted }}>{s.tp}</span>}
      <span style={{ ...mono, color: T.faint }}>{fmtDay(s.d)}</span>
    </div>
  )
}
/** Answers are written in markdown; quotes show the words without the markup. */
const plain = (t: string) => t.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
function Quote({ s, hi }: { s: Snippet; hi?: string }) {
  const t = plain(s.t)
  const i = hi ? t.toLowerCase().indexOf(hi) : -1
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[14px] leading-relaxed italic" style={{ color: T.ink }}>“{i >= 0 && hi ? <>{t.slice(0, i)}<mark style={{ background: '#FDF0B8', color: T.ink }}>{t.slice(i, i + hi.length)}</mark>{t.slice(i + hi.length)}</> : t}”</p>
      <Chips s={s} />
    </div>
  )
}

function Drawer({ row, share, note, onClose, onSave, canWrite }: {
  row: NarrRow; share: number | null; note: Note | undefined; onClose: () => void; onSave: (n: Note) => Promise<void>; canWrite: boolean
}) {
  const [status, setStatus] = useState<Status>(note?.status ?? 'open')
  const [text, setText] = useState(note?.note ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const dirty = status !== (note?.status ?? 'open') || text !== (note?.note ?? '')
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`Fix narrative: ${row.name}`}>
      <button aria-label="Close" className="absolute inset-0 cursor-default" style={{ background: 'rgba(26,25,21,0.28)' }} onClick={onClose} />
      <div className="relative h-full w-full sm:w-[520px] overflow-y-auto p-6 flex flex-col gap-5" style={{ background: T.page, boxShadow: '-8px 0 24px rgba(0,0,0,0.08)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[12px] uppercase" style={{ ...mono, letterSpacing: '0.12em', color: SENT[row.s].ink }}>● {row.s} theme</span>
            <h3 className="text-[24px] font-bold leading-tight" style={{ color: T.ink, letterSpacing: '-0.02em' }}>{row.name}</h3>
          </div>
          <button onClick={onClose} className="rounded-full px-3 py-1.5 text-[14px]" style={{ border: `1px solid ${T.border}`, background: '#fff' }}>Close</button>
        </div>
        <p className="text-[15px]" style={{ color: T.ink }}>
          In <b>{fmtInt(row.n)}</b> answers in this period{share != null && <> · <b>{fmtPct(share)}</b> of answers that mention Clay</>}
          {row.prev != null && <> · {fmtInt(row.prev)} in the period before</>}.
        </p>
        <div className="flex flex-col gap-3">
          <p className="text-[12px] uppercase" style={{ ...mono, letterSpacing: '0.12em', color: T.muted }}>Newest examples</p>
          {row.snip.map((s, i) => <div key={i} className="rounded-xl p-3" style={{ background: '#fff', border: `1px solid ${T.border}` }}><Quote s={s} /></div>)}
        </div>
        <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: T.tile }}>
          <p className="text-[12px] uppercase" style={{ ...mono, letterSpacing: '0.12em', color: T.muted }}>Suggested next steps</p>
          <Segmented ariaLabel="Status" value={status} onChange={v => { setStatus(v); setState('idle') }} options={STATUS.map(s => ({ id: s.id, label: s.label, disabled: !canWrite }))} />
          <textarea value={text} onChange={e => { setText(e.target.value); setState('idle') }} rows={5} disabled={!canWrite}
            placeholder="What would change this narrative? The page or source to fix, the content to publish, who owns it…"
            className="rounded-xl p-3 text-[14px] focus:outline-none focus:ring-2" style={{ border: `1px solid ${T.border}`, background: '#fff', color: T.ink }} />
          <div className="flex items-center gap-3">
            <button disabled={!canWrite || !dirty || state === 'saving'} onClick={async () => { setState('saving'); try { await onSave({ status, note: text.trim() }); setState('saved') } catch { setState('error') } }}
              className="rounded-full px-5 py-2 text-[14px] font-medium disabled:opacity-40" style={{ background: T.ink, color: '#fff' }}>{state === 'saving' ? 'Saving…' : 'Save'}</button>
            <span className="text-[13px]" style={{ color: state === 'error' ? T.neg : T.muted }}>
              {!canWrite ? 'You can view notes but not edit them here.' : state === 'saved' ? 'Saved for everyone who opens this dashboard.' : state === 'error' ? 'Couldn’t save. Try again.' : note?.updatedAt ? `Last updated ${new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Narratives({ data, slice, cur, prev, mentioned, db }: { data: AeoData; slice: string; cur: Range; prev: Range | null; mentioned: number; db: NotesDb }) {
  const [tab, setTab] = useState<'all' | Sentiment>('all')
  const [q, setQ] = useState('')
  const [n, setN] = useState(25)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<NarrRow | null>(null)
  const [notes, setNotes] = useState<Record<string, Note>>({})
  const [canWrite, setCanWrite] = useState(!!db)
  useEffect(() => {
    if (!db) return
    let live = true
    // Notes are optional: a viewer without the collection (or an older runtime) just sees no statuses.
    try {
      if (typeof db.collection !== 'function') return
      db.collection('aeonotes').get().then(s => { if (live) setNotes(Object.fromEntries(s.docs.map(d => [d.id, d.data() as Note]))) }).catch(() => {})
    } catch { /* malformed path or no collection support */ }
    return () => { live = false }
  }, [db])
  const rows = useMemo(() => narratives(data, slice, cur, prev), [data, slice, cur, prev])
  if (!data.narr?.[slice]) return null
  const count = (s?: Sentiment) => rows.filter(r => !s || r.s === s).reduce((x, r) => x + r.n, 0)
  const needle = q.trim().toLowerCase()
  const hit = (r: NarrRow) => !needle || r.name.toLowerCase().includes(needle) || r.snip.some(s => s.t.toLowerCase().includes(needle))
  const list = rows.filter(r => (tab === 'all' || r.s === tab) && hit(r))
  const save = async (row: NarrRow, nt: Note) => {
    if (!db) throw new Error('no db')
    const doc = { ...nt, theme: row.name, sentiment: row.s, updatedAt: new Date().toISOString() }
    try { await db.doc(`aeonotes/${noteId(row.key)}`).set(doc) } catch (e) { setCanWrite(false); throw e }
    setNotes(m => ({ ...m, [noteId(row.key)]: doc }))
  }
  const tabs = [{ id: 'all', label: `All (${fmtInt(count())})` }, ...(['Negative', 'Neutral', 'Positive'] as Sentiment[]).map(s => ({ id: s, label: `${s} (${fmtInt(count(s))})` }))] as { id: 'all' | Sentiment; label: string }[]

  return (
    <Card className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2"><H2>Narrative intelligence</H2>
            <InfoTip label="About narrative themes"><Def d="The themes AI answers attach to Clay, with the sentiment of each. Counted as answers that carry the theme, one run of every prompt per week." note="Negative themes come first: fix the narrative or the source it comes from." /></InfoTip></div>
          <p className="text-[15px]" style={{ color: T.muted }}>Every theme AI answers attach to Clay. Negative ones need attention: fix the narrative or the source.</p>
        </div>
        <Search value={q} onChange={v => { setQ(v); setN(25) }} placeholder="Search theme or quote…" />
      </div>
      <Segmented ariaLabel="Sentiment" value={tab} onChange={v => { setTab(v); setN(25) }} options={tabs} />
      <ul className="flex flex-col">
        {list.slice(0, n).map(r => {
          const id = noteId(r.key), nt = notes[id], isOpen = open.has(r.key) || (!!needle && r.snip.slice(1).some(s => s.t.toLowerCase().includes(needle)))
          const shown = isOpen ? r.snip : r.snip.slice(0, 1), more = Math.max(0, r.n - r.snip.length)
          return (
            <li key={r.key} className="py-4 flex flex-col gap-2.5" style={{ borderTop: `1px solid ${T.border}` }}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="text-[11px] uppercase flex items-center gap-1.5" style={{ ...mono, letterSpacing: '0.12em', color: SENT[r.s].ink }}>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: SENT[r.s].dot }} />{r.s}</span>
                <span className="text-[16px] font-semibold" style={{ color: T.ink }}>{r.name}</span>
                {r.s === 'Negative' && <button onClick={() => setDrawer(r)} className="rounded-full px-2.5 py-1 text-[11px] uppercase font-medium"
                  style={{ background: T.amberBg, color: T.amberInk, letterSpacing: '0.08em', ...mono }}>⚠ Fix narrative</button>}
                {nt && nt.status !== 'open' && <span className="rounded-full px-2 py-0.5 text-[11px]" style={{ background: nt.status === 'done' ? '#E3F4E8' : '#E6EEFF', color: nt.status === 'done' ? '#1E6B3A' : '#1E3A8A' }}>
                  {STATUS.find(s => s.id === nt.status)?.label}</span>}
                <span className="ml-auto text-[13px] whitespace-nowrap" style={{ ...mono, color: T.muted }}>
                  {fmtInt(r.n)} answers{mentioned > 0 && <> · {fmtPct(r.n / mentioned)}</>}
                  {r.prev != null && r.prev > 0 && <span style={{ color: deltaColor(r.s === 'Negative' ? r.prev - r.n : r.n - r.prev) }}> {r.n >= r.prev ? '▲' : '▼'}{fmtInt(Math.abs(r.n - r.prev))}</span>}
                </span>
              </div>
              {shown.map((s, i) => <Quote key={i} s={s} hi={needle || undefined} />)}
              {(r.snip.length > 1 || more > 0) && (
                <div className="flex items-center gap-4 text-[13px]">
                  {r.snip.length > 1 && <button onClick={() => { const s = new Set(open); if (s.has(r.key)) s.delete(r.key); else s.add(r.key); setOpen(s) }}
                    className="underline underline-offset-4" style={{ color: T.muted }} aria-expanded={isOpen}>{isOpen ? '▾ Hide' : `▸ ${r.snip.length - 1} more examples`}</button>}
                  {isOpen && more > 0 && <span style={{ color: T.faint }}>+ {fmtInt(more)} more answers not shown</span>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {list.length === 0 && <p className="text-[14px] py-6 text-center" style={{ color: T.faint }}>{needle ? `No theme or quote matches “${q}”.` : 'No themes for this filter.'}</p>}
      {list.length > n && <button onClick={() => setN(n + 25)} className="self-start text-[14px] underline underline-offset-4" style={{ color: T.muted }}>Show 25 more of {fmtInt(list.length)}</button>}
      <p className="text-[13px]" style={{ color: T.muted }}>Counts are answers carrying the theme (one run of every prompt per week); % is of answers that mention Clay. The 40 most frequent themes per sentiment are kept, with the 6 newest examples each.</p>
      {drawer && <Drawer row={drawer} share={mentioned > 0 ? drawer.n / mentioned : null} note={notes[noteId(drawer.key)]} canWrite={canWrite && !!db}
        onClose={() => setDrawer(null)} onSave={nt => save(drawer, nt)} />}
    </Card>
  )
}
