'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  MessageSquare,
  Link as LinkIcon,
  BarChart2,
  List,
  Bot,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const NAV_ITEMS = [
  { href: '/',            label: 'Home',            icon: LayoutDashboard },
  { href: '/citations',   label: 'Citations',        icon: LinkIcon },
  { href: '/competitive', label: 'Competitive',      icon: BarChart2 },
  { href: '/sentiment',   label: 'Sentiment',        icon: MessageSquare },
  { href: '/mcp',         label: 'MCP & Claygent',   icon: Bot },
  { href: '/prompts',     label: 'Prompts',          icon: List },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  return (
    <aside className="w-56 shrink-0 flex flex-col" style={{ background: '#FFFFFF', borderRight: '1px solid var(--clay-border)' }}>

      {/* Logo */}
      <div className="h-14 flex items-center gap-3 px-4" style={{ borderBottom: '1px solid var(--clay-border)' }}>
        <img
          src="https://www.google.com/s2/favicons?domain=clay.com&sz=64"
          alt="Clay"
          width={28}
          height={28}
          style={{ borderRadius: '7px', flexShrink: 0 }}
        />
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold leading-tight truncate" style={{ color: 'var(--clay-black)', letterSpacing: '-0.02em' }}>
            AI Visibility
          </p>
          <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'rgba(26,25,21,0.35)' }}>
            clay.com
          </p>
        </div>
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
                'flex items-center gap-2.5 px-3 py-2 text-[13px] font-semibold mx-2 transition-all',
                active ? '' : 'hover:bg-[rgba(26,25,21,0.04)]'
              )}
              style={{
                borderRadius: '7px',
                color: active ? '#FFFFFF' : 'rgba(26,25,21,0.6)',
                background: active ? 'var(--clay-slushie)' : 'transparent',
              }}
            >
              <Icon
                size={14}
                style={{ color: active ? '#FFFFFF' : 'rgba(26,25,21,0.4)', flexShrink: 0 }}
              />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--clay-border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <img
            src="https://www.google.com/s2/favicons?domain=clay.com&sz=32"
            alt=""
            width={14}
            height={14}
            style={{ borderRadius: '3px', opacity: 0.5, flexShrink: 0 }}
          />
          <p className="text-[10px] font-semibold uppercase tracking-widest truncate" style={{ color: 'rgba(26,25,21,0.35)' }}>
            PMM · AEO
          </p>
        </div>
        <button
          onClick={signOut}
          title="Sign out"
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-[rgba(26,25,21,0.06)] transition-colors shrink-0"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <LogOut size={12} style={{ color: 'rgba(26,25,21,0.35)' }} />
        </button>
      </div>
    </aside>
  )
}
