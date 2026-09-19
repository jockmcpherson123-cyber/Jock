// ════════════════════════════════════════════════════════════════════════
//  Program read — an AI agronomist's take on THIS course's own data.
//
//  Studies the last ~3 weeks of clip yield, the growth-reg GDD clock per
//  surface, recent regulating sprays, and the upcoming forecast, then returns a
//  short, decisive recommendation: tighten / hold / ease the program, timing,
//  which surfaces, and what to watch. No web search — a single cheap call on the
//  club's own numbers.
//
//  SETUP: ANTHROPIC_API_KEY in the hosting env (no NEXT_PUBLIC_ prefix).
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SYSTEM = `You are a turf agronomist reading a single golf course's OWN data to advise on its plant growth-regulator (PGR) and spray program. You do not search the web — you reason only from the data given.

WHAT YOU'RE DECIDING
- Is growth getting away or well-held? (clip-yield trend + growth-reg GDD vs the reapply point)
- Should the program TIGHTEN, HOLD, or EASE, and on which surfaces (greens vs fairways)?
- Timing with the forecast: spray sooner, wait a few days, or stay on schedule.

WEIGH RAIN (the GDD clock is temperature-only, so you cover what it misses):
- Rain within a few hours of a PGR going down cuts uptake — suppression breaks EARLY, so a big rainSinceSprayIn soon after the last spray means reapply sooner than the GDD suggests.
- Rain + warmth flushes growth beyond the GDD clock; if clips are climbing and rain fell, growth may be getting away even if GDD isn't at target yet.
- Heavy forecast rain is a spray blackout — get overdue apps down in the dry window before it.

BE BRIEF. This is a glanceable read for a busy superintendent, not an essay.
- headline: one line, the single call.
- read: ONE or TWO short sentences — the key why, with one or two real numbers. No more.
- actions: 2-3 items, each ONE short line (~12 words max), leading with the day/timing. Superintendent shorthand.
- Do not restate the same point across fields. Cut everything non-essential. Only claim what the data supports.

OUTPUT
Respond with ONLY a single JSON object (no prose, no markdown fences):
{
  "headline": "<one-line call>",
  "read": "<1-2 short sentences>",
  "actions": [ { "when": "<e.g. 'Today' / 'Wed' / 'Hold'>", "do": "<short move, ~12 words>" } ],
  "watch": [ "<one short thing to watch>" ]
}
Keep the whole thing tight — a super should read it in 15 seconds.`

// Close off a JSON object cut short by the token limit (finish an open string,
// drop a dangling comma, balance the braces) so a truncated read still renders.
function repairJson(s) {
  let out = '', inStr = false, esc = false
  const stack = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]; out += ch
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inStr) out += '"'
  out = out.replace(/,\s*$/, '')
  while (stack.length) out += stack.pop()
  out = out.replace(/,(\s*[}\]])/g, '$1')
  try { return JSON.parse(out) } catch { return null }
}

function extractJson(text) {
  if (!text) return null
  let s = text.trim()
  if (s.startsWith('```')) s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const a = s.indexOf('{')
  if (a < 0) return null
  s = s.slice(a)
  const b = s.lastIndexOf('}')
  if (b > 0) { try { return JSON.parse(s.slice(0, b + 1)) } catch { /* fall through */ } }
  return repairJson(s)
}

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in your hosting settings, then redeploy.' }, { status: 503 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const context = body?.context
  if (!context || typeof context !== 'object') return Response.json({ error: 'Missing course data.' }, { status: 400 })

  const client = new Anthropic({ apiKey })
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const messages = [{
    role: 'user',
    content: `Today is ${today}. Read this course's data and return the JSON program read.\n\nDATA:\n\`\`\`json\n${JSON.stringify(context).slice(0, 40000)}\n\`\`\``,
  }]

  try {
    // Stream + a roomy budget: adaptive thinking shares max_tokens, so a tight
    // cap was truncating the JSON before it finished.
    const resp = await client.messages.stream({
      model: 'claude-opus-5', max_tokens: 5000, thinking: { type: 'adaptive' }, system: SYSTEM, messages,
    }).finalMessage()
    if (resp.stop_reason === 'refusal') return Response.json({ error: 'The request was declined.' }, { status: 422 })
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    const advice = extractJson(text)
    if (!advice || !advice.headline) return Response.json({ error: 'Could not read the data. Try again.' }, { status: 502 })
    return Response.json({ advice, generatedAt: new Date().toISOString() })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: 'AI is busy right now — try again in a minute.' }, { status: 429 })
    if (e instanceof Anthropic.APIError) return Response.json({ error: e.message || 'AI request failed.' }, { status: e.status || 502 })
    return Response.json({ error: 'AI request failed.' }, { status: 500 })
  }
}
