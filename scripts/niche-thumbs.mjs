/**
 * Weekly niche scan, thumbnails: download small thumbnails for the videos the Content insights tab shows with a picture
 * (this week's first 30 new videos, rising-term examples, and the sources of every idea the tab could rank), as data: URIs in
 * ~230 KB documents youtube/scan-thumbs-<i>. Sets `thumbParts` on the scan document so the page knows how many to read.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/niche-thumbs.mjs <scan.json> <outDir>
 *
 * Needs i.ytimg.com reachable (public thumbnails, no key). 176×99 JPEG, about 4 KB each. A video whose thumbnail fails
 * is skipped (the page shows a blank tile).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { build } from 'esbuild'

const [scanFile, outDir] = process.argv.slice(2)
if (!scanFile || !outDir) { console.error('usage: node scripts/niche-thumbs.mjs <scan.json> <outDir>'); process.exit(2) }
const root = new URL('..', import.meta.url).pathname
const bundle = join(process.env.TMPDIR || '/tmp', `plg-thumbs-${process.pid}.mjs`)
await build({ entryPoints: [join(root, 'lib/plg/creators/compute.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'error' })
const { ideaVideoIds } = await import(bundle)
const scan = JSON.parse(readFileSync(scanFile, 'utf8'))
// The tab's pictures: the first 30 new videos (the "Breaking out early" grid), rising-term examples, and what any idea can show.
const ids = new Set([...scan.pulse.newVideos.slice(0, 30), ...scan.pulse.terms.flatMap(t => t.vids), ...ideaVideoIds(scan)])
const known = new Set(scan.videos.map(v => v.id))
const want = [...ids].filter(i => known.has(i))
mkdirSync(outDir, { recursive: true })

const thumbs = {}
let failed = 0
const one = async id => {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`)
    if (!res.ok) throw new Error(String(res.status))
    const img = await sharp(Buffer.from(await res.arrayBuffer())).resize(176, 99, { fit: 'cover' }).jpeg({ quality: 55 }).toBuffer()
    thumbs[id] = `data:image/jpeg;base64,${img.toString('base64')}`
  } catch { failed++ }
}
for (let i = 0; i < want.length; i += 8) await Promise.all(want.slice(i, i + 8).map(one))

// Split into documents under the db's per-document cap.
const parts = [[]]
let size = 0
for (const [id, uri] of Object.entries(thumbs)) {
  if (size + uri.length > 230_000) { parts.push([]); size = 0 }
  parts.at(-1).push([id, uri]); size += uri.length + id.length + 8
}
const n = Object.keys(thumbs).length ? parts.length : 0
for (let i = 0; i < n; i++) writeFileSync(join(outDir, `scan-thumbs-${i}.json`), JSON.stringify({ fetchedAt: scan.fetchedAt, thumbs: Object.fromEntries(parts[i]) }))
scan.thumbParts = n
writeFileSync(scanFile, JSON.stringify(scan))
console.log(`${Object.keys(thumbs).length} of ${want.length} thumbnails (${failed} failed) → ${n} documents in ${outDir}; scan.thumbParts = ${n}`)
