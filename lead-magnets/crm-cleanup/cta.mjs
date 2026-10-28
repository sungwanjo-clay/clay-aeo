// Builds the CRM Cleanup CTA URL from an endpoint response (reference for Ploy).
export function buildCrmCleanupPrompt({ result, emails, crm }) {
  const c = result.counts
  const lines = [
    `Use the crm-cleanup skill (${result.spec_version}).`,
    `I ran Clay's free CRM Cleanup check on clay.com: ${result.headline}.`,
    `Counts: invalid ${c.invalid}, catch-all ${c.risky_catch_all}, role inboxes ${c.role_inboxes}, duplicates ${c.duplicates}, personal ${c.personal}, disposable ${c.disposable}, clean ${c.clean}, unverified ${c.unverified}.`,
    `Emails checked, in order: ${emails.join(', ')}`,
  ]
  if (result.truncated > 0) lines.push(`My list has ${result.truncated} more that the page didn't check.`)
  if (crm) lines.push(`My CRM is ${crm}.`)
  lines.push(`Check id: ${result.run_id}.`)
  lines.push('Recheck these and confirm you get the same counts, then show each email with its bucket and reason, give me a keep list, and help me fix the bad ones and sync the clean ones to my CRM.')
  return lines.join('\n')
}

export function buildCrmCleanupCtaUrl(input) {
  const prompt = buildCrmCleanupPrompt(input)
  const redirectTo = `chats?sculptorPrompt=${encodeURIComponent(prompt)}&oneShot=true`
  return `https://app.clay.com/signup?redirect_to=${encodeURIComponent(redirectTo)}`
}
