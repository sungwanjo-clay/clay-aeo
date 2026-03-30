'use client'

import { useState } from 'react'

/** Derive a best-guess domain from a competitor display name.
 *  "Apollo.io" → "apollo.io", "HubSpot" → "hubspot.com", "Clay" → "clay.com" */
function competitorDomain(name: string): string {
  const lower = name.toLowerCase().trim()
  if (/\.(com|io|ai|co|net|org|app)$/.test(lower)) return lower
  return lower.replace(/[^a-z0-9]/g, '') + '.com'
}

function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360}, 50%, 42%)`
}

interface CompetitorIconProps {
  name: string
  size?: number
}

export default function CompetitorIcon({ name, size = 18 }: CompetitorIconProps) {
  const [err, setErr] = useState(false)
  const domain = competitorDomain(name)

  if (err) {
    return (
      <div
        className="shrink-0 rounded flex items-center justify-center font-bold text-white"
        style={{
          width: size, height: size,
          fontSize: Math.max(8, size * 0.5),
          background: avatarColor(name),
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>
    )
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      width={size}
      height={size}
      className="rounded-sm shrink-0"
      onError={() => setErr(true)}
    />
  )
}
