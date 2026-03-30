'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, LayoutDashboard, MessageSquare, Link as LinkIcon, BarChart2, List, Sliders, Bot } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { href: '/',            label: 'Home',            icon: LayoutDashboard },
  { href: '/citations',   label: 'Citations',        icon: LinkIcon },
  { href: '/competitive', label: 'Competitive',      icon: BarChart2 },
  { href: '/sentiment',   label: 'Sentiment',        icon: MessageSquare },
  { href: '/mcp',         label: 'MCP & Claygent',   icon: Bot },
  { href: '/prompts',     label: 'Prompts',          icon: List },
  { href: '/explorer',    label: 'Metric Explorer',  icon: Sliders },
]

function LogoMark() {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="https://www.google.com/s2/favicons?domain=clay.com&sz=64"
        alt="Clay"
        width={24}
        height={24}
        style={{ borderRadius: '6px', flexShrink: 0 }}
      />
      <div>
        <p className="text-[13px] font-extrabold leading-tight" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
          AI Visibility
        </p>
        <p className="text-[9px] font-bold uppercase tracking-widest leading-none" style={{ color: 'rgba(26,25,21,0.35)' }}>
          clay.com
        </p>
      </div>
    </div>
  )
}

export default function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      {/* Top bar — only on mobile */}
      <div
        className="lg:hidden flex items-center justify-between px-4 h-12 shrink-0"
        style={{ background: '#FFFFFF', borderBottom: '1px solid var(--clay-border)' }}
      >
        <LogoMark />
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-lg"
          style={{ color: 'var(--clay-black)' }}
          aria-label="Open navigation"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Slide-over overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(26,25,21,0.4)' }}
            onClick={() => setOpen(false)}
          />

          {/* Drawer */}
          <div
            className="relative flex flex-col w-64 h-full"
            style={{ background: '#FFFFFF', borderRight: '1px solid var(--clay-border)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 h-14" style={{ borderBottom: '1px solid var(--clay-border)' }}>
              <LogoMark />
              <button onClick={() => setOpen(false)} className="p-1" aria-label="Close navigation">
                <X size={18} style={{ color: 'var(--clay-black)' }} />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto py-3">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-semibold mx-2 transition-all',
                      active ? '' : 'hover:bg-[rgba(26,25,21,0.04)]'
                    )}
                    style={{
                      borderRadius: '7px',
                      color: active ? 'var(--clay-black)' : 'rgba(26,25,21,0.6)',
                      background: active ? 'var(--clay-lime)' : 'transparent',
                    }}
                  >
                    <Icon size={15} style={{ color: active ? 'var(--clay-black)' : 'rgba(26,25,21,0.4)', flexShrink: 0 }} />
                    {label}
                  </Link>
                )
              })}
            </nav>

            <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: '1px solid var(--clay-border)' }}>
              <img src="https://www.google.com/s2/favicons?domain=clay.com&sz=32" alt="" width={14} height={14} style={{ borderRadius: '3px', opacity: 0.5 }} />
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(26,25,21,0.35)' }}>
                PMM · AEO Dashboard
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
