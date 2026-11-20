/**
 * Weekly niche scan, step 1 of 2: pull what the GTM / cold email / AI lead-gen niche is watching from the YouTube Data
 * API (public data). Step 2 (scripts/niche-analyze.mjs) scores it and writes the dashboard's youtube/scan document.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/niche-scan.mjs <outDir> [--creators dist/creators/creators.json] [--prev-scan <scan.json>] [--discover] [--resume]
 *
 * --prev-scan is last week's youtube/scan document: its `tracked` list is this week's channel list.
 *
 * --resume reuses the searches and channel list already in <outDir>/raw.json (after a stopped or partial run) and only
 * pulls uploads again.
 *
 * Channels: discovery searches (the config's terms, last `discoverMonths`; run with --discover, or automatically when
 * there is no previous scan) keep channels that appear in at least `minSeedHits` results, up to `maxChannels`; our
 * program creators' channels are always tracked. Every week, fresh searches (last `freshDays`) add up to
 * `maxNewChannelsPerWeek` channels that weren't tracked yet. For each tracked channel the newest `uploadsPerChannel`
 * uploads are pulled with views, length, publish date and description signals (chapters, links).
 *
 * Writes <outDir>/raw.json. Quota: a search costs 100 units, a page of uploads or video stats 1; a discovery run is about
 * 7,000 units, a weekly run about 4,000 (the default project quota is 10,000 a day). On a quota error the run stops and
 * writes what it has, marked partial.
 * YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN (any read-only token can read public data).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const outDir = args[0]
if (!outDir) { console.error('usage: node scripts/niche-scan.mjs <outDir> [--creators <creators.json>] [--prev <raw.json>] [--discover]'); process.exit(2) }
const opt = k => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null }
const cfg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../lib/plg/creators/scan.config.json'), 'utf8'))
const prevFile = opt('--prev-scan') ?? opt('--prev')
const prevDoc = prevFile && existsSync(prevFile) ? JSON.parse(readFileSync(prevFile, 'utf8')) : null
// Last week's channel list: a scan document's `tracked`, or (older runs) a raw pull's channels.
const prev = prevDoc ? { channels: Object.fromEntries((prevDoc.tracked ?? Object.keys(prevDoc.channels ?? {})).map(id => [id, 1])) } : null
const creators = opt('--creators') && existsSync(opt('--creators')) ? JSON.parse(readFileSync(opt('--creators'), 'utf8')) : null
const resume = args.includes('--resume') && existsSync(resolve(outDir, 'raw.json')) ? JSON.parse(readFileSync(resolve(outDir, 'raw.json'), 'utf8')) : null
const discover = !resume && (args.includes('--discover') || !prev)
mkdirSync(outDir, { recursive: true })

const tr = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID ?? '', client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '', refresh_token: process.env.YOUTUBE_REFRESH_TOKEN ?? '', grant_type: 'refresh_token' }),
})
if (!tr.ok) { console.error(`YouTube token refresh failed (${tr.status})`); process.exit(1) }
const at = (await tr.json()).access_token
let units = 0, quotaHit = false
class Quota extends Error {}
async function get(path, cost = 1) {
  if (quotaHit) throw new Quota('quota')
  const r = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, { headers: { authorization: `Bearer ${at}` } })
  units += cost
  if (r.status === 403) { const t = await r.text(); if (/quota/i.test(t)) { quotaHit = true; throw new Quota('quota') } throw new Error(`${path.split('?')[0]} 403: ${t.slice(0, 160)}`) }
  if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return r.json()
}
const secs = iso => { const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso ?? '') ?? []; return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) }
const ago = days => new Date(Date.now() - days * 864e5).toISOString()
/** Description signals: chapter lines, the first line with a Clay link, link count. */
function desc(d) {
  const lines = (d ?? '').split('\n')
  const ch = lines.filter(l => /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s/.test(l)).length
  const cl = lines.findIndex(l => /clay\.com|clay\.run|via=/i.test(l))
  return { chapters: ch, cl: cl < 0 ? null : cl + 1, ln: (d?.match(/https?:\/\//g) ?? []).length }
}

const out = { fetchedAt: new Date().toISOString(), partial: false, discover, units: 0, channels: {}, videos: [], searches: {}, fresh: {}, newChannels: [] }
const save = () => { out.units = units; writeFileSync(resolve(outDir, 'raw.json'), JSON.stringify(out)); }

try {
 if (resume) {
  Object.assign(out, { discover: resume.discover, searches: resume.searches, fresh: resume.fresh, newChannels: resume.newChannels, channels: resume.channels })
 } else {
  // 1. Channels to track.
  const hits = new Map()
  if (discover) {
    for (const term of cfg.terms) {
      const j = await get(`search?part=snippet&type=video&maxResults=50&relevanceLanguage=en&publishedAfter=${ago(cfg.discoverMonths * 30)}&q=${encodeURIComponent(term)}`, 100)
      out.searches[term] = (j.items ?? []).map(i => i.id.videoId)
      for (const i of j.items ?? []) hits.set(i.snippet.channelId, (hits.get(i.snippet.channelId) ?? 0) + 1)
    }
  }
  let tracked = discover
    ? [...hits.entries()].filter(([, c]) => c >= cfg.minSeedHits).sort((a, b) => b[1] - a[1]).slice(0, cfg.maxChannels).map(([id]) => id)
    : Object.keys(prev.channels)
  const program = creators ? [...new Set(Object.values(creators.videos ?? {}).map(v => v.channelId))] : []
  tracked = [...new Set([...tracked, ...program])]

  // 2. Fresh searches: this week's videos, and channels we don't track yet.
  const freshHits = new Map()
  for (const term of cfg.terms) {
    const j = await get(`search?part=snippet&type=video&maxResults=50&relevanceLanguage=en&order=date&publishedAfter=${ago(cfg.freshDays)}&q=${encodeURIComponent(term)}`, 100)
    out.fresh[term] = (j.items ?? []).map(i => i.id.videoId)
    for (const i of j.items ?? []) if (!tracked.includes(i.snippet.channelId)) freshHits.set(i.snippet.channelId, (freshHits.get(i.snippet.channelId) ?? 0) + 1)
  }
  out.newChannels = [...freshHits.entries()].filter(([, c]) => c >= cfg.minSeedHits).sort((a, b) => b[1] - a[1]).slice(0, cfg.maxNewChannelsPerWeek).map(([id]) => id)
  tracked = [...new Set([...tracked, ...out.newChannels])]

  // 3. Channel details.
  for (let i = 0; i < tracked.length; i += 50) {
    const j = await get(`channels?part=snippet,statistics,contentDetails&id=${tracked.slice(i, i + 50).join(',')}`)
    for (const c of j.items ?? []) out.channels[c.id] = {
      t: c.snippet.title, h: c.snippet.customUrl ?? null, subs: +c.statistics.subscriberCount || null, n: +c.statistics.videoCount || null,
      up: c.contentDetails.relatedPlaylists.uploads, program: program.includes(c.id), seedHits: hits.get(c.id) ?? null, isNew: out.newChannels.includes(c.id),
    }
  }
 }

  // 4. Uploads per channel.
  let done = 0
  for (const [cid, c] of Object.entries(out.channels)) {
    const ids = []
    let page = ''
    while (ids.length < cfg.uploadsPerChannel) {
      const j = await get(`playlistItems?part=contentDetails&maxResults=50&playlistId=${c.up}${page ? `&pageToken=${page}` : ''}`).catch(e => { if (e instanceof Quota) throw e; return null })
      if (!j) break
      ids.push(...(j.items ?? []).map(x => x.contentDetails.videoId))
      if (!j.nextPageToken) break
      page = j.nextPageToken
    }
    for (let i = 0; i < ids.length; i += 50) {
      const j = await get(`videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(',')}`)
      for (const v of j.items ?? []) out.videos.push({
        id: v.id, ch: cid, t: v.snippet.title, p: v.snippet.publishedAt.slice(0, 10), s: secs(v.contentDetails.duration),
        v: +v.statistics.viewCount || 0, l: +v.statistics.likeCount || 0, c: +v.statistics.commentCount || 0, live: v.snippet.liveBroadcastContent !== 'none' ? 1 : 0,
        ...desc(v.snippet.description),
      })
    }
    if (++done % 10 === 0) { save(); console.log(`${done}/${Object.keys(out.channels).length} channels, ${out.videos.length} videos, ${units} units`) }
  }
} catch (e) {
  if (!(e instanceof Quota)) throw e
  out.partial = true
  console.warn(`YouTube quota reached after ${units} units: writing a partial scan`)
}
save()
console.log(`${out.partial ? 'PARTIAL ' : ''}${Object.keys(out.channels).length} channels (${out.newChannels.length} new), ${out.videos.length} videos, ${units} quota units → ${resolve(outDir, 'raw.json')}`)
