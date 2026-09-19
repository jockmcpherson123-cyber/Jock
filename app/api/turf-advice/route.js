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
- Is growth getting away or well-held? Judge from the clip-yield trend (rising = growth climbing) and the growth-reg GDD clock vs the reapply point.
- Should the program TIGHTEN (shorter interval or higher rate), HOLD, or EASE (stretch interval)?
- Timing: with the forecast, should they spray sooner (a heat spell speeds the GDD clock and the rebound), wait a few days, or stay on schedule? Be specific with days/dates when the data supports it.
- Which surfaces need it (greens vs fairways) — call out the ones running hottest or past the reapply point.

HOW TO WRITE
- Decisive and practical, like a good superintendent talking to their spray tech. Plain language, real numbers from the data. No hedging, no fluff, no web citations.
- Only claim what the data supports. If data is thin, say what to log.
- Always end with the reminder to verify rates against the label.

OUTPUT
Respond with ONLY a single JSON object (no prose, no markdown fences):
{
  "headline": "<one-line call, e.g. 'Tighten greens regulation before the weekend heat'>",
  "read": "<2-4 sentences: what the data shows and why it matters, with their numbers>",
  "actions": [ { "when": "<e.g. 'This week' / 'Before Fri' / 'Hold'>", "do": "<the specific move>" } ],
  "watch": [ "<short thing to keep an eye on>" ]
}
Give 2-4 actions. Keep every field tight.`

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
