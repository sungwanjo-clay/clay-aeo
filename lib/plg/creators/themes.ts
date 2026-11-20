/**
 * One taxonomy for every video on the Content insights tab, the niche scan's and our program creators': a theme (what
 * the video is about) and formats (how the title sells it). Both come from title rules, evaluated in order; our program
 * videos can also carry a hand-checked theme (youtube/creators → tags, video id → theme id), which wins over the rules.
 *
 * clayFit is a judgment, kept here so it's visible: how naturally a video on the theme can show Clay doing the work
 * (1 = Clay is the product on screen, 0.3 = Clay would be a detour). It weights the recommendations, nothing else.
 */
export type ThemeId = 'gtm-career' | 'clay-course' | 'clay-narrow' | 'authority' | 'ai-leads' | 'lead-lists' | 'cold-email' | 'linkedin'
  | 'deliverability' | 'cold-calling' | 'signals' | 'automation' | 'ai-use-cases' | 'agency-growth' | 'off-niche' | 'other'

export const THEMES: { id: ThemeId; label: string; desc: string; clayFit: number; rule?: RegExp }[] = [
  { id: 'gtm-career', label: 'GTM engineer career', desc: 'Becoming a GTM engineer: roadmaps, getting hired, first clients', clayFit: 1, rule: /\bgtm ?(engineer|engineering|eng)\b|\bgtme\b/i },
  { id: 'clay-course', label: 'Clay course or tutorial', desc: 'The whole tool, beginner to a working campaign', clayFit: 1, rule: /\bclay\b.*\b(course|tutorial|guide|walkthrough|beginner|explained|how to use|what is|101)|\b(course|tutorial|guide|walkthrough|how to use|what is)\b.*\bclay\b/i },
  { id: 'clay-narrow', label: 'Clay feature or tactic', desc: 'One Clay feature, use case or tour', clayFit: 1, rule: /\bclay(\.com)?\b|claygent/i },
  { id: 'authority', label: 'Borrowed authority', desc: 'A famous operator’s playbook or interview (Hormozi, a CEO)', clayFit: 0.6, rule: /hormozi|\bceo\b|billionaire|interview with|\bft\.|\bfeat\./i },
  { id: 'ai-leads', label: 'AI tool + lead gen build', desc: 'Claude, Grok, ChatGPT or agents used to find leads or run outbound', clayFit: 1,
    rule: /(claude|grok|chatgpt|gpt|openai|gemini|cursor|\bai\b|agent).*(lead|outbound|cold email|prospect|customers|clients|pipeline|meetings)|(lead|outbound|cold email|prospect|pipeline).*(claude|grok|chatgpt|gpt|gemini|\bai\b|agent)/i },
  { id: 'lead-lists', label: 'Lead lists and data', desc: 'Finding leads and emails, scraping, Sales Navigator, Apollo, enrichment', clayFit: 1,
    rule: /lead list|scrap(e|ing)|find (anyone|any|someone)'?s? (email|phone)|email finder|sales navigator|apollo|enrich|\b\d[\d,]*\+? leads\b|unlimited leads|free leads|b2b data|contact data/i },
  { id: 'cold-email', label: 'Cold email strategy and copy', desc: 'Writing, offers, subject lines, reply rates, sequences', clayFit: 0.8, rule: /cold email|email copy|subject line|reply rate|open rate|cold outreach|email outreach|sequence|personali[sz]/i },
  { id: 'linkedin', label: 'LinkedIn outreach', desc: 'LinkedIn prospecting, DMs and content for leads', clayFit: 0.6, rule: /linkedin/i },
  { id: 'deliverability', label: 'Deliverability and infrastructure', desc: 'Domains, inboxes, warm-up, spam', clayFit: 0.3, rule: /deliverab|inbox(es)?\b|domains?\b|warm.?up|spam|mailbox|smtp|dns|dmarc/i },
  { id: 'cold-calling', label: 'Cold calling and sales skills', desc: 'Calls, objections, closing, sales skills', clayFit: 0.3, rule: /cold call|calling|phone|sales call|objection|clos(e|ing) (deals|sales)|discovery call|sales skill|how to sell/i },
  { id: 'signals', label: 'Signals and intent', desc: 'Buying signals, intent data, triggers', clayFit: 1, rule: /signal|intent|trigger/i },
  { id: 'automation', label: 'Automation builds', desc: 'n8n, Make, Zapier, workflows, agents (not lead gen)', clayFit: 0.6, rule: /n8n|make\.com|zapier|automat|workflow/i },
  { id: 'ai-use-cases', label: 'AI tool use cases', desc: 'Claude, ChatGPT, Grok or agents in general, not lead gen', clayFit: 0.4, rule: /claude|chatgpt|grok|gemini|cursor|\bai\b|gpt|agent|llm|openai|anthropic|vibe cod/i },
  { id: 'agency-growth', label: 'Getting clients and agency growth', desc: 'Starting or growing an agency or one-person business', clayFit: 0.6, rule: /agency|clients?\b|business|offer|freelanc|side hustle|make money|\$\d/i },
  { id: 'off-niche', label: 'Off-niche lifestyle or news', desc: 'Broad channels outside GTM (lifestyle, finance stories, dev news)', clayFit: 0 },
  { id: 'other', label: 'Other', desc: 'No rule matched', clayFit: 0 },
]
export const themeLabel = (id: ThemeId) => THEMES.find(t => t.id === id)?.label ?? id
export const clayFit = (id: ThemeId) => THEMES.find(t => t.id === id)?.clayFit ?? 0

export function themeOf(vid: string | null, title: string, tagged?: Record<string, string> | null): ThemeId {
  const t = vid && tagged?.[vid]
  if (t && THEMES.some(x => x.id === t)) return t as ThemeId
  return THEMES.find(x => x.rule?.test(title))?.id ?? 'other'
}

export type FormatId = 'course' | 'year' | 'timebox' | 'tried-n' | 'replace' | 'changed' | 'listicle' | 'steal' | 'warning' | 'proof' | 'beginner' | 'free' | 'question'
export const FORMATS: { id: FormatId; label: string; rule: RegExp }[] = [
  { id: 'course', label: 'Course, full guide or masterclass', rule: /\b(full )?course\b|masterclass|full guide|complete guide|full tutorial|crash course|bootcamp/i },
  { id: 'beginner', label: 'For beginners / step by step', rule: /beginner|step.by.step|\b101\b|from scratch|no experience|explained simply/i },
  { id: 'year', label: 'Year-tagged', rule: /\b20(25|26|27)\b/ },
  { id: 'timebox', label: 'Time-boxed (“in 23 minutes”)', rule: /\bin \d+ (min|minutes|mins|hours|hrs|seconds|days)\b|\d+ (years?|hours?) of .* in \d+/i },
  { id: 'tried-n', label: '“I tried / tested N…”', rule: /\bi (tried|tested|analy[sz]ed|sent|wrote|reviewed|scraped|cold called|called) [\d,]+|\btested (every|all)\b/i },
  { id: 'replace', label: 'Tool replacement (“I cancelled X”)', rule: /cancel(l)?ed|instead\b|replac|forget |killer|\bvs\.?\b|alternative/i },
  { id: 'changed', label: '“X just changed Y forever” / “the new way”', rule: /changed .*forever|just changed|the new way|game.?changer|is insane|destroys/i },
  { id: 'listicle', label: 'Number listicle', rule: /^\s*(top )?\d+ |\b\d+ (ways|tips|tools|things|use cases|mistakes|steps|strategies|lessons|plays|prompts|hacks|secrets|ideas)\b/i },
  { id: 'steal', label: '“Steal / copy my X”', rule: /\bsteal\b|copy (my|this)|swipe/i },
  { id: 'warning', label: 'Stop / mistakes / warning', rule: /\bstop\b|mistake|warning|don'?t |never |avoid/i },
  { id: 'proof', label: 'Proof number (“$30k/month”, “2,000 leads”)', rule: /\$\s?\d|\d+%|\b\d[\d,]*\+? (leads|meetings|replies|clients|calls|customers|emails)\b|\d+k\b/i },
  { id: 'free', label: '“Free”', rule: /\bfree\b/i },
  { id: 'question', label: 'Question title', rule: /\?\s*$/ },
]
export const formatsOf = (title: string): FormatId[] => FORMATS.filter(f => f.rule.test(title)).map(f => f.id)
export const formatLabel = (id: FormatId) => FORMATS.find(f => f.id === id)?.label ?? id
