/**
 * Pulls YouTube channel + per-video daily stats for the Social video tab and
 * writes one JSON document per channel to dist/youtube/<channelId>.json, which
 * is then stored in the artifact's db at youtube/<channelId>.
 *
 *   YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN  (read-only scopes)
 *   node scripts/sync-youtube.mjs [since=2026-07-01]
 *
 * The OAuth user is not the channel owner, so every call names the channel id
 * explicitly (channel==MINE would return the user's own empty channel).
 * Impressions / thumbnail CTR are NOT available from the Analytics API.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CHANNELS = [
  { id: 'UC1C7lmXOfNHlS2cORnPbgaA', key: 'peter' },
  { id: 'UCHLTdPgm0KivyFFvKEWEQmQ', key: 'clay' },
]
const since = process.argv[2] ?? '2026-07-01'
const today = new Date().toISOString().slice(0, 10)
const outDir = resolve(import.meta.dirname, '../dist/youtube')

async function token() {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET,
    refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })
  const j = await r.json()
  if (!j.access_token) throw new Error(`token refresh failed: ${j.error ?? r.status}`)
  return j.access_token
}

const at = await token()
async function get(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${at}` } })
  const j = await r.json()
  if (j.error) throw new Error(`${url.split('?')[0]}: ${j.error.message}`)
  return j
}
const analytics = (ch, params) =>
  get(`https://youtubeanalytics.googleapis.com/v2/reports?${new URLSearchParams({ ids: `channel==${ch}`, startDate: since, endDate: today, ...params })}`)

/** Classify the Clay link a video description sends viewers to. */
function clayLink(description) {
  const urls = description.match(/https?:\/\/[^\s)]+/g) ?? []
  const pick = (re) => urls.find(u => re.test(u))
  const tagged = pick(/utm_campaign=/i)
  if (tagged) return { kind: 'tagged', url: tagged.split('?')[0], campaign: new URL(tagged).searchParams.get('utm_campaign')?.toLowerCase() ?? null }
  const offer = pick(/clay\.link\/pkytcohorts|cohorts\.clay\.com/i)
  if (offer) return { kind: 'offer', url: offer, campaign: null }
  const short = pick(/dub\.sh\/|clay\.link\//i)
  if (short) return { kind: 'short', url: short, campaign: null }
  const clay = pick(/clay\.com/i)
  if (clay) return { kind: 'untagged', url: clay, campaign: null }
  return { kind: 'none', url: null, campaign: null }
}
const isoDur = (d) => { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(d ?? '') ?? []; return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) }

mkdirSync(outDir, { recursive: true })
for (const ch of CHANNELS) {
  const info = (await get(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${ch.id}`)).items[0]
  const uploads = info.contentDetails.relatedPlaylists.uploads
  const ids = []
  let page = ''
  do {
    const p = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${page ? `&pageToken=${page}` : ''}`)
    ids.push(...p.items.map(i => i.contentDetails.videoId))
    page = p.nextPageToken ?? ''
  } while (page)
  const vids = []
  for (let i = 0; i < ids.length; i += 50) {
    const v = await get(`https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(',')}`)
    vids.push(...v.items)
  }
  const daily = (await analytics(ch.id, { metrics: 'views,estimatedMinutesWatched,subscribersGained,subscribersLost', dimensions: 'day', sort: 'day' })).rows ?? []
  const videos = []
  for (const v of vids) {
    const published = v.snippet.publishedAt.slice(0, 10)
    const rows = published > today ? [] : ((await analytics(ch.id, { metrics: 'views,estimatedMinutesWatched', dimensions: 'day', sort: 'day', filters: `video==${v.id}` })).rows ?? [])
    videos.push({
      id: v.id, title: v.snippet.title, published, durationSec: isoDur(v.contentDetails.duration),
      lifetimeViews: Number(v.statistics.viewCount ?? 0), link: clayLink(v.snippet.description ?? ''),
      daily: rows.filter(r => r[1] > 0 || r[2] > 0).map(r => [r[0], r[1], r[2]]),
    })
  }
  const doc = {
    channelId: ch.id, key: ch.key, title: info.snippet.title, handle: info.snippet.customUrl,
    subscribers: Number(info.statistics.subscriberCount), lifetimeViews: Number(info.statistics.viewCount),
    videoCount: Number(info.statistics.videoCount), since, fetchedAt: new Date().toISOString(),
    daily: daily.map(r => [r[0], r[1], r[2], r[3], r[4]]), videos,
  }
  writeFileSync(resolve(outDir, `${ch.id}.json`), JSON.stringify(doc))
  console.log(`${ch.key}: ${daily.length} days, ${videos.length} videos → dist/youtube/${ch.id}.json (${(JSON.stringify(doc).length / 1024).toFixed(0)} KB)`)
}
