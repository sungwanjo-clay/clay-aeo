// Runs a Clay routine through the Public API and waits for its result.
// Docs: https://developers.clay.com/api-reference/routines/

const DEFAULT_BASE = 'https://api.clay.com/public/v0'

export class ClayError extends Error {
  constructor(message: string, readonly kind: 'timeout' | 'upstream' | 'config') {
    super(message)
  }
}

interface RunResultItem {
  id: string
  status: 'complete' | 'failed'
  result?: Record<string, unknown>
  error?: { message: string }
}

interface RunResults {
  status: 'complete' | 'in_progress'
  data?: RunResultItem[]
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function clayFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = process.env.CLAY_API_KEY
  if (!apiKey) throw new ClayError('CLAY_API_KEY is not set', 'config')
  const base = process.env.CLAY_API_BASE ?? DEFAULT_BASE
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'clay-api-key': apiKey, 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
}

/**
 * Starts a one-item run of `routineId` and polls until it finishes or
 * `timeoutMs` passes. Returns the routine's structured outputs.
 */
export async function runRoutine(
  routineId: string,
  inputs: Record<string, unknown>,
  timeoutMs = 25_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs

  const start = await clayFetch(`/routines/${routineId}/run`, {
    method: 'POST',
    body: JSON.stringify({ items: [{ id: 'visitor', inputs }] }),
  })
  if (!start.ok) {
    throw new ClayError(`Clay run failed to start (${start.status}): ${await start.text()}`, 'upstream')
  }
  const { routine_run_id: runId } = (await start.json()) as { routine_run_id: string }

  let delay = 500
  while (Date.now() < deadline) {
    await sleep(delay)
    delay = Math.min(delay * 1.5, 2_000)

    const res = await clayFetch(`/routines/run/${runId}/results`)
    if (res.status === 202) continue
    if (!res.ok) {
      throw new ClayError(`Clay results failed (${res.status}): ${await res.text()}`, 'upstream')
    }
    const body = (await res.json()) as RunResults
    if (body.status !== 'complete') continue

    const item = body.data?.[0]
    if (!item || item.status !== 'complete' || !item.result) {
      throw new ClayError(`Clay run ${runId} failed: ${item?.error?.message ?? 'no result'}`, 'upstream')
    }
    const outputs = item.result.structuredOutputs
    return (outputs && typeof outputs === 'object' ? outputs : item.result) as Record<string, unknown>
  }

  throw new ClayError(`Clay run ${runId} did not finish within ${timeoutMs}ms`, 'timeout')
}
