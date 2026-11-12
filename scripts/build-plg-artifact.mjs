/**
 * Bundles the PLG Workspaces dashboard into ONE self-contained HTML file for a
 * claude.ai artifact (no external scripts; fonts from Google Fonts).
 *
 *   node scripts/build-plg-artifact.mjs   → dist/plg-artifact.html
 */
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'dist/plg-artifact.html')

const js = await build({
  entryPoints: [resolve(root, 'artifact/plg/main.tsx')],
  bundle: true, minify: true, format: 'iife', platform: 'browser', target: 'es2020',
  jsx: 'automatic', write: false, legalComments: 'none',
  tsconfig: resolve(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
})
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')

const cssIn = `@import "tailwindcss" source(none);
@source "${resolve(root, 'components/plg')}";
@source "${resolve(root, 'artifact/plg')}";
:root { color-scheme: light; }
html, body { background: #FBFAF7; color: #1A1915; }
body { font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #2F5BEA; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }`
const css = (await postcss([tailwind({ base: root, optimize: { minify: true } })]).process(cssIn, { from: resolve(root, 'artifact/plg/in.css') })).css

const html = `<title>PLG Weekly Metrics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${css}</style>
<div id="root"></div>
<script>${script}</script>
`
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`)
