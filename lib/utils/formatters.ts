export function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatRawPct(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return `${value.toFixed(decimals)}%`
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

export function formatScore(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—'
  return value.toFixed(decimals)
}

/** Parse a date string without timezone offset. Plain "YYYY-MM-DD" strings are treated
 *  as local-time (not UTC) so they don't shift by a day in US timezones. */
function parseDateLocal(date: string | Date): Date {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return typeof date === 'string' ? new Date(date) : date
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = parseDateLocal(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatShortDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = parseDateLocal(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDelta(delta: number | null | undefined): { text: string; positive: boolean } {
  if (delta == null) return { text: '—', positive: true }
  const sign = delta >= 0 ? '↑' : '↓'
  return {
    text: `${sign} ${Math.abs(delta).toFixed(1)}%`,
    positive: delta >= 0,
  }
}

export function formatPosition(pos: number | null | undefined): string {
  if (pos == null) return '—'
  return `#${pos}`
}

export function truncate(text: string | null | undefined, maxLen = 80): string {
  if (!text) return ''
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}
