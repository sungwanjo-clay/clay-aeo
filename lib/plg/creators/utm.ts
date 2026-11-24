/**
 * Tracked links for a video idea, built the way the [OPS] Create Campaign workflow builds them (the /campaign-create
 * skill, references/rules.md "Names" and payload-spec.md "Derived for URL branches"), so a link copied from the
 * dashboard matches the campaign it will be credited to:
 *
 *   utm_campaign  <short offer>_<offer type>_<channel>_<person>, lowercase with underscores (person left off when unknown).
 *                 It is also the campaign's name and External ID: attribution matches the link's utm_campaign to it, so the
 *                 link counts only once a campaign with this name exists.
 *   utm_source    youtube (the Internal - Influencer tactic YouTube)
 *   utm_medium    influencerinternal
 *   final URL     the destination with any utm_source / utm_medium / utm_campaign removed, then the three appended with ? or
 *                 &, and a #fragment kept at the end.
 */
export const UTM = { source: 'youtube', medium: 'influencerinternal', offerType: 'video', channel: 'youtube', campaignType: 'Internal - Influencer', tactic: 'YouTube' }

const STOP = new Set('how to the a an in on with for of and your you i my me is it this that from vs or at by'.split(' '))
/** Lowercase letters, digits and underscores only; accents and punctuation dropped. */
// \p{M} (combining marks) keeps the source ASCII: a literal accent range breaks in the page build.
export const slug = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** The short offer: the first few words of the video's working title that recognize it (no filler words, no bare numbers). */
export function shortOffer(title: string, words = 4): string {
  const ws = slug(title).split('_').filter(w => w && !STOP.has(w) && !/^\d+$/.test(w))
  return ws.slice(0, words).join('_')
}

export function utmName(title: string, person?: string | null): string {
  return [shortOffer(title), UTM.offerType, UTM.channel, person ? slug(person) : ''].filter(Boolean).join('_')
}

/** The workflow's final URL: existing utm_source / utm_medium / utm_campaign replaced, every other parameter kept. */
export function trackedUrl(destination: string, key: string): string {
  const [base, ...frag] = destination.split('#')
  const [path, query = ''] = base.split('?')
  const isUtm = (p: string) => { try { return /^utm_(source|medium|campaign)$/i.test(decodeURIComponent(p.split('=')[0])) } catch { return false } }
  const kept = query.split('&').filter(p => p && !isUtm(p))
  const utm = `utm_source=${UTM.source}&utm_medium=${UTM.medium}&utm_campaign=${key}`
  return `${path}?${[...kept, utm].join('&')}${frag.length ? `#${frag.join('#')}` : ''}`
}

/** UTMs are tracked automatically only on the clay.com main domain (the skill's UTM tracking note). */
export const tracksUtm = (url: string) => { try { return ['clay.com', 'www.clay.com'].includes(new URL(url).host) } catch { return false } }
export const UTM_NOTE = 'This link does not point to the clay.com main domain, so UTMs are not tracked automatically. If the UTMs are meant to give Clay credit for workspace sign-ups: subdomains such as app.clay.com don’t currently have UTM tracking. Check in Monty that UTMs will be created for this page. If they won’t, submit a ticket in #request-gtm-ops.'

/** A brief to paste into /campaign-create: the answers it would otherwise ask for, as a proposal it still previews. */
export function campaignBrief(o: { title: string; destination: string; key: string; person?: string | null; useCase: string; offer: string }): string {
  return [
    `Create a channel campaign: ${UTM.campaignType}, tactic ${UTM.tactic}.`,
    `Video: "${o.title}"${o.person ? `, posted by ${o.person}` : ''}.`,
    `Destination URL: ${o.destination}`,
    `utm campaign name: ${o.key}`,
    `Description: Sponsored YouTube video, "${o.title}". It shows ${o.useCase[0].toLowerCase() + o.useCase.slice(1)}; the offer is ${o.offer[0].toLowerCase() + o.offer.slice(1)}. Viewers click the link in the description to sign up for Clay.`,
  ].join('\n')
}
