'use client'

import { useState } from 'react'

function avatarColor(domain: string): string {
  let h = 0
  for (let i = 0; i < domain.length; i++) h = domain.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360}, 55%, 45%)`
}

interface DomainIconProps {
  domain: string
  size?: number
}

export default function DomainIcon({ domain, size = 18 }: DomainIconProps) {
  const [err, setErr] = useState(false)

  if (err) {
    return (
      <div
        className="shrink-0 rounded flex items-center justify-center font-bold text-white"
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.5), background: avatarColor(domain) }}
      >
        {domain.charAt(0).toUpperCase()}
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
