'use client'

import { useState } from 'react'
import { Info } from 'lucide-react'

interface MetricTooltipProps {
  text: string
}

export const TOOLTIP_DEFINITIONS: Record<string, string> = {
  // Homepage KPIs
  'Visibility Score': '% of AI responses in the selected period where Clay was mentioned. Denominator is all responses, not just ones that mentioned anything.',
  'Citation Count': 'Number of responses where clay.com appeared as a cited source link. Sourced from responses.cited_domains.',
  'Avg Position': 'Average rank at which Clay first appears among all tools mentioned in a response (1 = first mention). Lower is better. Only counted in responses where Clay was mentioned.',
  'Positive Sentiment': 'Of the responses where Clay was mentioned, what % described Clay in a positive light.',
  'ClayMCP & Agent': 'Number of responses that mention Claygent or Clay MCP as a recommended tool or integration.',
  'Total Prompts': 'Total number of distinct AI prompts evaluated in the selected period across all platforms.',
  // Competitive / share metrics
  'Mention Share': "Clay's mentions as a % of all competitor mentions across the same responses. Different from Visibility Score — this is relative share among competitors, not raw coverage.",
  'Citation Share': '% of all AI responses in the period where clay.com was included as a cited source. Same denominator as Visibility Score.',
  'Share of Voice': "Clay's share of total competitor mentions. A competitor mentioned in 30 out of 100 total competitor mentions has 30% SoV. Filtered by the same responses as other metrics.",
  // Sentiment
  'Positive Sentiment %': 'Of the responses where Clay was mentioned, what % described Clay positively.',
  'Brand Sentiment Score': '0–100 score of how positively Clay is portrayed across responses. 0 = not mentioned, 76–100 = primary recommendation.',
  'Response Quality Score': "1–10 score of the AI response's overall clarity and helpfulness, independent of Clay mention.",
  // Prompts / structure
  'Benchmark Prompts': 'Prompts designated as the canonical set for measuring AI visibility over time. Campaign prompts are excluded from these metrics by default.',
  'Neutral %': 'Of responses where Clay was mentioned, what % described Clay in a neutral (neither positive nor negative) way.',
  'Negative %': 'Of responses where Clay was mentioned, what % described Clay negatively.',
  // Citations
  'Citation Domain Rank': 'Clay.com\'s rank among all domains cited in the period by response count (1 = most cited domain).',
  'Total Unique Domains': 'Number of distinct domains cited across all AI responses in the selected period.',
  'Avg Citations per Response': 'Average number of distinct source domains cited per AI response that included any citations.',
  'Claygent / MCP Rate': '% of responses that mention Claygent or Clay MCP as a tool or integration.',
  'Citation Coverage': '% of AI responses in the period that cited any source URL — measures how often AI backs answers with links.',
  'Avg per Response': 'Average number of source domains cited per response, among responses that included any citations.',
  // Domain table
  'Response Share': '% of all AI responses in this period that cited this domain at least once. Uses the same denominator as Citation Share so numbers are directly comparable.',
}

export default function MetricTooltip({ text }: MetricTooltipProps) {
  const [visible, setVisible] = useState(false)

  return (
    <span className="relative inline-flex items-center">
      <button
        className="text-gray-400 hover:text-gray-600 transition-colors ml-1"
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onFocus={() => setVisible(true)}
        onBlur={() => setVisible(false)}
        aria-label={`Info: ${text}`}
        type="button"
      >
        <Info size={12} />
      </button>
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded-md bg-gray-900 text-white text-xs px-3 py-2 shadow-lg leading-relaxed pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  )
}
