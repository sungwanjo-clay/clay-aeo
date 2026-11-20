'use client'

import { Component, type ReactNode } from 'react'
import { T } from './ui'

/**
 * Error boundary for one dashboard section: a render error shows here, with the section's name and the message, instead
 * of blanking the whole page. Reset when `resetKey` changes (a new filter state or data).
 */
export default class Boundary extends Component<{ name: string; resetKey?: unknown; children: ReactNode }, { error: Error | null; key: unknown }> {
  state: { error: Error | null; key: unknown } = { error: null, key: this.props.resetKey }
  static getDerivedStateFromError(error: Error) { return { error } }
  static getDerivedStateFromProps(p: { resetKey?: unknown }, s: { error: Error | null; key: unknown }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null
  }
  componentDidCatch(error: Error) { console.error(`[dashboard] ${this.props.name} failed to render:`, error) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" data-section-error={this.props.name} className="rounded-2xl px-5 py-4 text-[15px]" style={{ background: '#FDECEC', color: '#7A1F12' }}>
        <b>{this.props.name} couldn’t be shown.</b> {this.state.error.message || String(this.state.error)}
      </div>
    )
  }
}
