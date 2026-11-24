/**
 * The UTMs for a video idea, built the way the [OPS] Create Campaign workflow builds them (the /campaign-create
 * skill, references/rules.md "Names" and payload-spec.md "Derived for URL branches"), so a link built from the
 * dashboard matches the campaign it will be credited to:
 *
 *   utm_campaign  <short offer>_<offer type>_<channel>_<person>, lowercase with underscores (person left off when unknown).
 *                 It is also the campaign's name and External ID: attribution matches the link's utm_campaign to it, so the
 *                 link counts only once a campaign with this name exists.
 *   utm_source    youtube (the Internal - Influencer tactic YouTube)
 *   utm_medium    influencerinternal
 *
 * The brief shows the query to paste after the page's slug (no person: the creator isn't picked yet).
 */
export const UTM = { source: 'youtube', medium: 'influencerinternal', offerType: 'video', channel: 'youtube' }

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

/** The UTM query to add after the page's slug, as the campaign workflow writes it. */
export const utmQuery = (key: string) => `?utm_source=${UTM.source}&utm_medium=${UTM.medium}&utm_campaign=${key}`
