/**
 * Weekly niche scan, step 2 of 2: score a raw pull and write the dashboard's youtube/scan document.
 *
 *   node scripts/niche-analyze.mjs <raw.json> <out scan.json> [--prev <previous scan.json>] [--recs <recs.json>]
 *
 * The analysis is lib/plg/creators/scan.ts. --prev is last week's scan document (new videos, terms and the previous
 * recommendations are measured against it). --recs is this week's written recommendations ([{theme, title, angle,
 * thumbnail, structure, offer, notes}]): every theme must exist in the scan with copies that worked, or the run fails.
 * An idea names its topic `subject` (lib/plg/creators/themes.ts SUBJECTS), the title `format` to sell it with, and can carry useCase, landing, cta, copy, placement and a
 * `why` per decision (lib/plg/creators/scan.ts ScanRec).
 * The document must stay under 240 KB (the db's per-document cap is 256 KiB).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const [rawFile, outFile, ...rest] = process.argv.slice(2)
if (!rawFile || !outFile) { console.error('usage: node scripts/niche-analyze.mjs <raw.json> <out scan.json> [--prev <scan.json>] [--recs <recs.json>]'); process.exit(2) }
const opt = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null }
const root = new URL('..', import.meta.url).pathname
const bundle = join(process.env.TMPDIR || '/tmp', `plg-scan-${process.pid}.mjs`)
await build({ entryPoints: [join(root, 'lib/plg/creators/scan.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' })
const { analyze } = await import(bundle)

const raw = JSON.parse(readFileSync(rawFile, 'utf8'))
const prev = opt('--prev') && existsSync(opt('--prev')) ? JSON.parse(readFileSync(opt('--prev'), 'utf8')) : null
const doc = analyze(raw, prev)
if (opt('--recs')) {
  const recs = JSON.parse(readFileSync(opt('--recs'), 'utf8'))
  // Every idea must exist in this scan: its theme with copies that worked, its subject as one of the theme's topics.
  const bad = recs.filter(r => { const t = doc.themes.find(x => x.id === r.theme); return !t || t.worked === 0 || (r.subject && r.subject !== 'general' && !(t.topics ?? []).some(a => a.s === r.subject)) })
  if (bad.length) { console.error(`recommendations with no evidence in this scan: ${bad.map(r => `${r.theme}:${r.subject ?? 'general'}`).join(', ')}`); process.exit(3) }
  const dup = recs.map(r => `${r.theme}:${r.subject ?? 'general'}`).filter((k, i, a) => a.indexOf(k) !== i)
  if (dup.length) { console.error(`duplicate recommendations: ${dup.join(', ')}`); process.exit(3) }
  doc.recs = recs
}
let body = JSON.stringify(doc)
// Over the cap: drop the oldest ids from the seen list first (it only marks what's new).
while (body.length > 240_000 && doc.seen.length > 1000) { doc.seen = doc.seen.slice(Math.floor(doc.seen.length / 4)); body = JSON.stringify(doc) }
if (body.length > 240_000) { console.error(`scan document is ${(body.length / 1024).toFixed(0)} KB, over the 240 KB cap`); process.exit(1) }
writeFileSync(outFile, body)
const p = doc.pool
console.log(`${raw.partial ? 'PARTIAL ' : ''}${p.channels} channels, ${p.videos} videos, ${p.scored} scored, ${p.outliers} outliers (${(p.baseRate * 100).toFixed(1)}%), ${doc.pulse.newVideos.length} new videos, ${doc.pulse.terms.length} rising terms, ${doc.videos.length} kept → ${outFile} (${(body.length / 1024).toFixed(0)} KB)`)
