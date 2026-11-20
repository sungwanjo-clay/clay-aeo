/**
 * Weekly niche scan, review step: print the five themes the Content insights tab will recommend, with the evidence to
 * write their titles and packages from (docs/niche-scan.md, step 4). Prints no credentials and no warehouse rows, only
 * per-theme summaries.
 *
 *   node scripts/niche-review.mjs <scan.json> <creators.json> <cache dir with creators.json + creators-<i>.json>
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'

const [scanFile, creatorsFile, cacheDir] = process.argv.slice(2)
if (!scanFile || !creatorsFile || !cacheDir) { console.error('usage: node scripts/niche-review.mjs <scan.json> <creators.json> <cache dir>'); process.exit(2) }
const root = new URL('..', import.meta.url).pathname
const bundle = join(process.env.TMPDIR || '/tmp', `plg-review-${process.pid}.mjs`)
await build({ entryPoints: [join(root, 'lib/plg/creators/compute.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' })
const { buildCreators } = await import(bundle)
const un = j => (j && typeof j === 'object' && 'data' in j && Object.keys(j).length <= 3 ? j.data : j)
const read = f => un(JSON.parse(readFileSync(f, 'utf8')))
const scan = read(scanFile), creators = read(creatorsFile)
const h = read(join(cacheDir, 'creators.json'))
const payload = JSON.parse(Array.from({ length: h.parts }, (_, i) => read(join(cacheDir, `creators-${i}.json`)).s).join(''))
const d = buildCreators(creators, payload, h.dataEnd, scan)
const ch = v => scan.channels[v?.c]?.t ?? '?'
console.log(`Scan ${scan.fetchedAt.slice(0, 10)} (previous ${scan.prevFetchedAt?.slice(0, 10) ?? 'none'}): ${scan.pool.scored} scored, base rate ${(scan.pool.baseRate * 100).toFixed(1)}%`)
console.log(`Rising terms: ${scan.pulse.terms.map(t => `${t.term} (${t.now} vs ${t.base})`).join(', ')}`)
console.log(`Off the list since last week: ${d.dropped.join(', ') || 'none'}`)
for (const r of d.recs) {
  const s = r.stat
  console.log(`\n#${r.rank} ${r.theme} (${r.status}) score ${r.score.toFixed(2)} · signups ${r.themeRow?.signup ?? 'untested'} · copies ${s.worked} worked / ${s.failed} failed on ${s.winChannels} channels · recent ${s.recentHits}/${s.recentN} vs prior ${s.priorHits}/${s.priorN} · best format ${s.bestFormat}`)
  if (r.original) console.log(`  original: “${r.original.t}” [${ch(r.original)}] ${r.original.x}×`)
  for (const v of r.winners) console.log(`  worked  ${v.x}×  ${v.m}m  ch${v.ch}  “${v.t}” [${ch(v)}]`)
  for (const v of r.losers) console.log(`  failed  ${v.x}×  ${v.m}m  ch${v.ch}  “${v.t}” [${ch(v)}]`)
  for (const x of r.seps) console.log(`  trait   ${x.label}: worked ${x.w}/${x.wn}, failed ${x.f}/${x.fn}`)
  console.log(`  words   worked: ${s.words.w.join(', ') || '–'} · failed: ${s.words.f.join(', ') || '–'}`)
  const t = r.themeRow
  if (t) console.log(`  ours    ${t.worked} worked / ${t.failed} failed of ${t.judged} judged, ${t.ws} workspaces${t.best ? `; best “${t.best.title}” ${t.best.perK?.toFixed(2)} per 1K` : ''}`)
}
