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
