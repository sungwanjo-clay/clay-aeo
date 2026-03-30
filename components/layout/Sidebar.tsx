'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  TrendingUp,
  MessageSquare,
  Link as LinkIcon,
  BarChart2,
  List,
  Sliders,
  Bot,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { href: '/',            label: 'Home',            icon: LayoutDashboard },
  { href: '/visibility',  label: 'Visibility',       icon: TrendingUp },
  { href: '/sentiment',   label: 'Sentiment',        icon: MessageSquare },
  { href: '/citations',   label: 'Citations',        icon: LinkIcon },
  { href: '/competitive', label: 'Competitive',      icon: BarChart2 },
  { href: '/prompts',     label: 'Prompts',          icon: List },
  { href: '/explorer',    label: 'Metric Explorer',  icon: Sliders },
  { href: '/mcp',         label: 'MCP & Claygent',   icon: Bot },
]

export default function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 flex flex-col" style={{ background: '#FFFFFF', borderRight: '1px solid var(--clay-border)' }}>
      {/* Logo */}
      <div className="h-14 flex items-center px-5" style={{ borderBottom: '1px solid var(--clay-border)' }}>
        <span className="text-sm font-extrabold" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
          AI Visibility
        </span>
        <span
          className="ml-2 text-[9px] font-bold px-1.5 py-0.5 uppercase tracking-widest"
          style={{ background: 'var(--clay-lime)', color: 'var(--clay-black)', borderRadius: '4px' }}
        >
          Clay
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-4 py-2 text-[13px] font-semibold mx-2 transition-all',
                active ? '' : 'hover:opacity-60'
              )}
              style={{
                borderRadius: '6px',
                color: active ? '#FFFFFF' : 'var(--clay-black)',
                background: active ? 'var(--clay-black)' : 'transparent',
              }}
            >
              <Icon size={14} style={{ color: active ? 'var(--clay-lime)' : 'var(--clay-black)', opacity: active ? 1 : 0.5 }} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid var(--clay-border)' }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(26,25,21,0.4)' }}>
          Clay PMM · AI Visibility
        </p>
      </div>
    </aside>
  )
}
