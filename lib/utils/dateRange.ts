/**
 * Generate every calendar date between startDate and endDate (inclusive).
 * Both params should be 'YYYY-MM-DD' strings.
 */
export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const cursor = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  while (cursor <= end) {
    dates.push(cursor.toISOString().split('T')[0])
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

/**
 * Generate every Monday-start ISO-week bucket between startDate and endDate.
 * Returns the week-start date (Monday) for each week that overlaps the range.
 * Mirrors Postgres date_trunc('week', ...) so bucket labels line up with what
 * the timeseries RPCs return when p_granularity = 'weekly'.
 */
export function generateWeekRange(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const toMonday = (d: Date): Date => {
    const dow = d.getDay() // 0=Sun..6=Sat
    const diff = dow === 0 ? -6 : 1 - dow
    const m = new Date(d)
    m.setDate(m.getDate() + diff)
    m.setHours(0, 0, 0, 0)
    return m
  }
  const cursor = toMonday(new Date(startDate + 'T00:00:00'))
  const end = new Date(endDate + 'T00:00:00')
  while (cursor <= end) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 7)
  }
  return out
}

export function generateBucketRange(startDate: string, endDate: string, granularity: 'daily' | 'weekly'): string[] {
  return granularity === 'weekly'
    ? generateWeekRange(startDate, endDate)
    : generateDateRange(startDate, endDate)
}
