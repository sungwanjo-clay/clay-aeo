import type { Metadata } from 'next'
import { Suspense } from 'react'
import PlgDashboard from '@/components/plg/PlgDashboard'

export const metadata: Metadata = {
  title: 'PLG Weekly Metrics — Clay',
  description: 'New workspaces & pacing: blended attribution by channel and tier',
}

export default function PlgPage() {
  return (
    <Suspense>
      <PlgDashboard />
    </Suspense>
  )
}
