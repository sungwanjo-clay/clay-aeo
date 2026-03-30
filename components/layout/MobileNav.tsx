'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, LayoutDashboard, TrendingUp, MessageSquare, Link as LinkIcon, BarChart2, List, Sliders, Bot } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { href: '/',            label: 'Home',           icon: LayoutDashboard },
  { href: '/visibility',  label: 'Visibility',      icon: TrendingUp },
  { href: '/sentiment',   label: 'Sentiment',       icon: MessageSquare },
  { href: '/citations',   label: 'Citations',       icon: LinkIcon },
  { href: '/competitive', label: 'Competitive',     icon: BarChart2 },
  { href: '/prompts',     label: 'Prompts',         icon: List },
  { href: '/explorer',    label: 'Metric Explorer', icon: Sliders },
  { href: '/mcp',         label: 'MCP & Claygent',  icon: Bot },
]

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
        <div className="flex items-center gap-2">
          <span className="text-sm font-extrabold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
            AI Visibility
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-widest"
            style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '4px' }}
          >
            Clay
          </span>
        </div>
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
            <div className="flex items-center justify-between px-5 h-14" style={{ borderBottom: '1px solid var(--clay-border)' }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
                  AI Visibility
                </span>
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-widest"
                  style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '4px' }}
                >
                  Clay
                </span>
              </div>
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
                    className={cn('flex items-center gap-3 px-4 py-2.5 text-[13px] font-semibold mx-2 transition-all', active ? '' : 'hover:opacity-60')}
                    style={{
                      borderRadius: '6px',
                      color: active ? '#FFFFFF' : 'var(--clay-black)',
                      background: active ? 'var(--clay-black)' : 'transparent',
                    }}
                  >
                    <Icon size={15} style={{ color: active ? 'var(--clay-lime)' : 'var(--clay-black)', opacity: active ? 1 : 0.5 }} />
                    {label}
                  </Link>
                )
              })}
            </nav>

            <div className="px-4 py-3" style={{ borderTop: '1px solid var(--clay-border)' }}>
              <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(26,25,21,0.4)' }}>
                Clay PMM · AI Visibility
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
