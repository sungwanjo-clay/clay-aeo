'use client'

import { usePathname } from 'next/navigation'

/** Renders children except on the given path prefixes (e.g. AEO-only chrome on /plg). */
export default function HideOnPaths({ prefixes, children }: { prefixes: string[]; children: React.ReactNode }) {
  const pathname = usePathname()
  if (prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))) return null
  return <>{children}</>
}
