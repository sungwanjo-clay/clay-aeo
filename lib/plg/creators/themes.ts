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

/**
 * Default play per theme: the Clay use case a video on it should show, where its link should land, the offer and the
 * call to action. A judgment, like clayFit, used until the weekly review writes the idea's own brief (ScanRec). Landing
 * pages are real clay.com pages (entry pages seen in the Conversion section).
 */
export type Play = { useCase: string; landing: string; landingUrl: string; offer: string; cta: string }
export const PLAYS: Partial<Record<ThemeId, Play>> = {
  'gtm-career': { useCase: 'Build a first outbound system in Clay, the GTM engineer’s portfolio piece', landing: 'GTM engineering guide', landingUrl: 'https://www.clay.com/guides/gtm-engineering', offer: 'The guide plus Clay 101 on Clay University, free', cta: 'Start free and build the system from the video' },
  'clay-course': { useCase: 'Clay end to end: find companies, enrich, write, send', landing: 'Clay 101 on Clay University', landingUrl: 'https://university.clay.com/courses/clay-101', offer: 'The free Clay 101 course to follow along', cta: 'Sign up free and follow along with Clay 101' },
  'clay-narrow': { useCase: 'The one feature in the video, on a real list', landing: 'Templates', landingUrl: 'https://www.clay.com/templates', offer: 'The template from the video, ready to copy', cta: 'Copy the template into a free workspace' },
  authority: { useCase: 'The operator’s playbook rebuilt as a Clay table', landing: 'Claybooks', landingUrl: 'https://www.clay.com/claybooks', offer: 'The playbook as a Claybook', cta: 'Get the Claybook and run it free' },
  'ai-leads': { useCase: 'Claude or ChatGPT driving Clay through the MCP to build and enrich a lead list', landing: 'Clay MCP', landingUrl: 'https://www.clay.com/mcp', offer: 'Connect Clay to your AI assistant, free credits to start', cta: 'Connect Clay to Claude or ChatGPT free' },
  'lead-lists': { useCase: 'Waterfall enrichment: work emails and phones from many providers in one column', landing: 'Waterfall enrichment', landingUrl: 'https://www.clay.com/waterfall-enrichment', offer: 'Free credits to enrich your first list', cta: 'Enrich your first list free' },
  'cold-email': { useCase: 'Personalized first lines from each prospect’s website with Claygent', landing: 'Template: personalized emails from website data', landingUrl: 'https://www.clay.com/templates/write-personalized-emails-based-on-website-data', offer: 'The personalization template from the video', cta: 'Copy the template and write your first 100 emails free' },
  linkedin: { useCase: 'Sales Navigator lists turned into work emails and phones', landing: 'Claybook: enrich Sales Navigator lists', landingUrl: 'https://www.clay.com/claybooks/enrich-sales-navigator-lists-with-work-emails-and-phone-numbers', offer: 'The Claybook from the video', cta: 'Run the Claybook on your Sales Navigator list free' },
  deliverability: { useCase: 'Verify and clean a list before it’s sent', landing: 'Waterfall enrichment', landingUrl: 'https://www.clay.com/waterfall-enrichment', offer: 'Free credits to verify a list', cta: 'Verify your next list free' },
  'cold-calling': { useCase: 'Mobile numbers for a call list through waterfall enrichment', landing: 'Waterfall enrichment', landingUrl: 'https://www.clay.com/waterfall-enrichment', offer: 'Free credits to find mobile numbers', cta: 'Build your call list free' },
  signals: { useCase: 'Signal-based outbound: job changes, funding, hiring as triggers', landing: 'Signals', landingUrl: 'https://www.clay.com/signals', offer: 'A signals Claybook from the video', cta: 'Set up your first signal free' },
  automation: { useCase: 'Clay as the data step inside an n8n, Make or Zapier workflow', landing: 'Templates', landingUrl: 'https://www.clay.com/templates', offer: 'The workflow’s Clay table as a template', cta: 'Copy the table and plug it into your workflow' },
  'ai-use-cases': { useCase: 'An AI assistant using Clay’s data through the MCP', landing: 'Clay MCP', landingUrl: 'https://www.clay.com/mcp', offer: 'Connect Clay to your AI assistant', cta: 'Connect Clay to Claude or ChatGPT free' },
  'agency-growth': { useCase: 'Outbound for clients: find, enrich and personalize in one table', landing: 'Outbound use case', landingUrl: 'https://www.clay.com/use-cases/outbound', offer: 'The outbound table from the video as a template', cta: 'Start free and run your first client campaign' },
}

/**
 * What a video is about inside its theme: the tool or platform its title names. A topic (theme + subject) is one video
 * idea; "Clay for beginners" and "the full Clay course" are the same topic sold two ways (title formats). Checked in
 * order, first match wins; Clay is implicit in the Clay themes.
 */
export type SubjectId = 'ai-assistant' | 'n8n' | 'zapier-make' | 'apollo' | 'google-maps' | 'linkedin' | 'email-tools' | 'hormozi' | 'clay' | 'general'
export const SUBJECTS: { id: SubjectId; label: string; rule?: RegExp }[] = [
  // One subject for every AI assistant: "leads with Claude" and "leads with ChatGPT" are the same video. Which assistant
  // to name is a choice inside the brief (ASSISTANTS), like the title format.
  { id: 'ai-assistant', label: 'AI assistants', rule: /claude|chatgpt|\bgpt|openai|\bgrok|gemini/i },
  { id: 'n8n', label: 'n8n', rule: /\bn8n\b/i },
  { id: 'zapier-make', label: 'Zapier or Make', rule: /zapier|make\.com/i },
  { id: 'apollo', label: 'Apollo', rule: /apollo/i },
  { id: 'google-maps', label: 'Google Maps', rule: /google maps/i },
  { id: 'linkedin', label: 'LinkedIn and Sales Navigator', rule: /linkedin|sales nav/i },
  { id: 'email-tools', label: 'Instantly, Smartlead or Lemlist', rule: /instantly|smartlead|lemlist/i },
  { id: 'hormozi', label: 'Hormozi', rule: /hormozi/i },
  { id: 'clay', label: 'Clay', rule: /\bclay\b/i },
  { id: 'general', label: 'General' },
]
export function subjectOf(theme: ThemeId, title: string): SubjectId {
  const s = SUBJECTS.find(x => x.rule?.test(title))?.id ?? 'general'
  // Clay is the topic itself in the Clay themes; LinkedIn is the theme itself in the LinkedIn theme.
  if ((s === 'clay' && (theme === 'clay-course' || theme === 'clay-narrow')) || (s === 'linkedin' && theme === 'linkedin')) return 'general'
  return s
}
export const ASSISTANTS: { id: string; label: string; rule: RegExp }[] = [
  { id: 'claude', label: 'Claude', rule: /claude/i }, { id: 'chatgpt', label: 'ChatGPT', rule: /chatgpt|\bgpt|openai/i },
  { id: 'grok', label: 'Grok', rule: /\bgrok/i }, { id: 'gemini', label: 'Gemini', rule: /gemini/i },
]
export const assistantOf = (title: string) => ASSISTANTS.find(a => a.rule.test(title))?.id ?? null
export const assistantLabel = (id: string) => ASSISTANTS.find(a => a.id === id)?.label ?? id
export const subjectLabel = (id: SubjectId) => SUBJECTS.find(s => s.id === id)?.label ?? id
/** A topic's name: the theme, narrowed by its subject ("AI tool + lead gen build: Claude"). */
export const topicLabel = (theme: ThemeId, s: SubjectId) => (s === 'general' ? themeLabel(theme) : `${themeLabel(theme)}: ${subjectLabel(s)}`)

/** Up to three related clay.com resources per theme, most relevant first (real entry pages; the play's landing is first). */
export type Resource = { label: string; url: string }
const R = (label: string, url: string): Resource => ({ label, url })
const U = {
  clay101: R('Clay 101 on Clay University', 'https://university.clay.com/courses/clay-101'), courses: R('Clay University courses', 'https://university.clay.com/courses'),
  templates: R('Templates', 'https://www.clay.com/templates'), claybooks: R('Claybooks', 'https://www.clay.com/claybooks'), mcp: R('Clay MCP', 'https://www.clay.com/mcp'),
  claygent: R('Claygent', 'https://www.clay.com/claygent'), waterfall: R('Waterfall enrichment', 'https://www.clay.com/waterfall-enrichment'), signals: R('Signals', 'https://www.clay.com/signals'),
  outbound: R('Outbound use case', 'https://www.clay.com/use-cases/outbound'), gtmGuide: R('GTM engineering guide', 'https://www.clay.com/guides/gtm-engineering'),
  gtmBlog: R('Blog: GTM engineering', 'https://www.clay.com/blog/gtm-engineering'), aiLeadBlog: R('Blog: AI lead generation', 'https://www.clay.com/blog/ai-lead-generation'),
  freeLeads: R('Free tool: generate leads', 'https://www.clay.com/tools/generate-leads-for-free'), dataProviders: R('Guide: best B2B data providers', 'https://www.clay.com/guides/best/b2b-data-providers'),
  salesNav: R('Claybook: enrich Sales Navigator lists', 'https://www.clay.com/claybooks/enrich-sales-navigator-lists-with-work-emails-and-phone-numbers'),
  linkedinBlog: R('Blog: LinkedIn automation', 'https://www.clay.com/blog/linkedin-automation'), useCaseTemplates: R('Use-case templates on Clay University', 'https://university.clay.com/use-case-templates'),
  emailTemplate: R('Template: personalized emails from website data', 'https://www.clay.com/templates/write-personalized-emails-based-on-website-data'),
  sequencer: R('Sequencer', 'https://www.clay.com/sequencer'), customers: R('Customer stories', 'https://www.clay.com/customers'), abm: R('ABM use case', 'https://www.clay.com/use-cases/abm'),
}
export const RESOURCES: Partial<Record<ThemeId, Resource[]>> = {
  'gtm-career': [U.gtmGuide, U.clay101, U.gtmBlog],
  'clay-course': [U.clay101, U.courses, U.templates],
  'clay-narrow': [U.templates, U.claybooks, U.claygent],
  authority: [U.claybooks, U.customers, U.templates],
  'ai-leads': [U.mcp, U.aiLeadBlog, U.templates],
  'lead-lists': [U.waterfall, U.freeLeads, U.dataProviders],
  'cold-email': [U.emailTemplate, U.outbound, U.sequencer],
  linkedin: [U.salesNav, U.linkedinBlog, U.waterfall],
  deliverability: [U.waterfall],
  'cold-calling': [U.waterfall],
  signals: [U.signals, U.abm, U.claybooks],
  automation: [U.templates, U.claybooks, U.mcp],
  'ai-use-cases': [U.mcp, U.claygent, U.useCaseTemplates],
  'agency-growth': [U.outbound, U.templates, U.claybooks],
}
