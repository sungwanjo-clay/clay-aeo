/**
 * Builds the Content insights tab's creator documents from the program's placement list (scripts/creators-from-sheet.py)
 * plus public YouTube Data API metadata, and writes them for this page's db:
 *
 *   dist/creators/creators.json         → youtube/creators         placements, video + channel metadata, daily snapshots
 *   dist/creators/creators-thumbs-<i>.json → youtube/creators-thumbs-<i>  320×180 thumbnails as data: URIs, ~240 KB parts
 *                                        (the count is in creators.json → thumbParts)
 *
 *   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN (any read-only token can read public videos)
 *   NODE_USE_ENV_PROXY=1 node scripts/sync-creators.mjs <export.json> [preview.json]
 *
 * Per video: title, channel, publish date, length, views / likes / comments, description signals (chapters, where the
 * first Clay link sits, how many links), and the channel's median views over its recent long-form uploads (3 min+,
 * newest 5 excluded, the same baseline as Eric's demand map) so a sponsored video can be read as a multiple of its
 * channel's normal. preview.json (optional) carries the demand-map preview shown on the tab until the weekly
 * look-alike scan exists; it is copied through as is.
 * Quota: about 3 units per channel and 1 per 50 videos.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [exportFile, previewFile] = process.argv.slice(2)
if (!exportFile) { console.error('usage: node scripts/sync-creators.mjs <export.json> [preview.json]'); process.exit(2) }
const src = JSON.parse(readFileSync(exportFile, 'utf8'))
const outDir = resolve(import.meta.dirname, '../dist/creators')
mkdirSync(outDir, { recursive: true })

const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID ?? '', client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '', refresh_token: process.env.YOUTUBE_REFRESH_TOKEN ?? '', grant_type: 'refresh_token' }),
})
if (!tr.ok) { console.error(`YouTube token refresh failed (${tr.status})`); process.exit(1) }
const at = (await tr.json()).access_token
async function get(path) {
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { authorization: `Bearer ${at}` } })
  if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}
const secs = iso => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '') ?? []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) }
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }

/** What the description does: chapters, where the first Clay link sits (line number), how many links. */
function describe(desc) {
  const lines = (desc ?? '').split('\n')
  const chapters = lines.filter(l => /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s/.test(l)).length
  const clayLine = lines.findIndex(l => /clay\.com|via=/i.test(l))
  const links = (desc?.match(/https?:\/\//g) ?? []).length
  return { chapters, clayLine: clayLine < 0 ? null : clayLine + 1, links, chars: (desc ?? '').length }
}

const vids = [...new Set(src.placements.filter(p => p.platform === 'YouTube' && p.vid).map(p => p.vid))]
const videos = {}
for (let i = 0; i < vids.length; i += 50) {
  const j = await get(`videos?part=snippet,contentDetails,statistics&id=${vids.slice(i, i + 50).join(',')}`)
  for (const v of j.items ?? []) {
    videos[v.id] = {
      title: v.snippet.title, channelId: v.snippet.channelId, channel: v.snippet.channelTitle, published: v.snippet.publishedAt.slice(0, 10),
      secs: secs(v.contentDetails.duration), views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0,
      ...describe(v.snippet.description),
    }
  }
}
const missing = vids.filter(v => !videos[v])
if (missing.length) console.warn(`${missing.length} videos not returned (private or deleted): ${missing.join(', ')}`)

// Channel baselines: subscribers, and median views of recent long-form uploads (3 min+, newest 5 excluded).
const channels = {}
for (const id of [...new Set(Object.values(videos).map(v => v.channelId))]) {
  try {
    const c = (await get(`channels?part=snippet,statistics,contentDetails&id=${id}`)).items?.[0]
    if (!c) continue
    const ups = await get(`playlistItems?part=contentDetails&maxResults=50&playlistId=${c.contentDetails.relatedPlaylists.uploads}`)
    const ids = (ups.items ?? []).map(x => x.contentDetails.videoId)
    const st = ids.length ? (await get(`videos?part=contentDetails,statistics,snippet&id=${ids.join(',')}`)).items ?? [] : []
    const longform = st.filter(v => secs(v.contentDetails.duration) >= 180).sort((a, b) => b.snippet.publishedAt.localeCompare(a.snippet.publishedAt))
    const base = longform.slice(5).map(v => +v.statistics.viewCount || 0)
    channels[id] = { title: c.snippet.title, subs: +c.statistics.subscriberCount || null, videos: +c.statistics.videoCount || null, median: base.length >= 10 ? median(base) : null, sample: base.length }
  } catch (e) { console.warn(`channel ${id}: ${e.message}`) }
}

const thumbs = {}
for (const id of vids) {
  try {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`)
    if (r.ok) thumbs[id] = `data:${r.headers.get('content-type') ?? 'image/jpeg'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`
  } catch { /* host not allowed */ }
}

const fetchedAt = new Date().toISOString()
// Thumbnails in parts of at most ~240 KB each: youtube/creators-thumbs-<i>.
const parts = [{}]
let size = 0
for (const [id, uri] of Object.entries(thumbs)) {
  if (size + uri.length > 240_000 && Object.keys(parts.at(-1)).length) { parts.push({}); size = 0 }
  parts.at(-1)[id] = uri; size += uri.length
}
const preview = previewFile && existsSync(previewFile) ? JSON.parse(readFileSync(previewFile, 'utf8')) : null
const doc = { fetchedAt, sheetAsOf: src.asOf ?? null, placements: src.placements, daily: src.daily, videos, channels, preview, thumbParts: parts.length }
const body = JSON.stringify(doc)
if (body.length > 900_000) { console.error(`creators document is ${(body.length / 1024).toFixed(0)} KB, over the cap`); process.exit(1) }
writeFileSync(resolve(outDir, 'creators.json'), body)
parts.forEach((p, i) => writeFileSync(resolve(outDir, `creators-thumbs-${i}.json`), JSON.stringify({ fetchedAt, part: i, parts: parts.length, thumbs: p })))
console.log(`${src.placements.length} placements, ${Object.keys(videos).length} videos, ${Object.keys(channels).length} channels (${Object.values(channels).filter(c => c.median).length} with a median), ${Object.keys(thumbs).length} thumbnails in ${parts.length} parts → dist/creators (${(body.length / 1024).toFixed(0)} KB)`)
