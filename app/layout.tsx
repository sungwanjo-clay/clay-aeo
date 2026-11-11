import type { Metadata } from 'next'
import './globals.css'
import { GlobalFiltersProvider } from '@/context/GlobalFilters'
import Sidebar from '@/components/layout/Sidebar'
import MobileNav from '@/components/layout/MobileNav'
import GlobalFilterBar from '@/components/layout/GlobalFilterBar'
import BenchmarkBanner from '@/components/layout/BenchmarkBanner'
import HideOnPaths from '@/components/layout/HideOnPaths'

export const metadata: Metadata = {
  title: 'AI Visibility Dashboard — Clay',
  description: 'Track how Clay is mentioned, cited, and described across AI platforms',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="h-full flex flex-col lg:flex-row" style={{ background: 'var(--clay-oat)' }}>
        <GlobalFiltersProvider>
          {/* Desktop sidebar — hidden on mobile */}
          <div className="hidden lg:flex">
            <Sidebar />
          </div>

          {/* Main content column */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {/* Mobile top bar + slide-over nav */}
            <MobileNav />

            {/* AEO filter bar + campaign banner (not used by the PLG tab) */}
            <HideOnPaths prefixes={['/plg']}>
              <GlobalFilterBar />
              <BenchmarkBanner />
            </HideOnPaths>

            {/* Page content */}
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </GlobalFiltersProvider>
      </body>
    </html>
  )
}
