// ════════════════════════════════════════════════════════════════════════
//  Weekly AI Reports — "The Grounds Dispatch" — server route.
//
//  Researches recent turf science far and wide, targets it to THIS course's
//  weather-station region and grass types, avoids anything it has already
//  covered, and returns a structured editorial brief (+ a spoken audio script)
//  the app renders as a bespoke weekly dispatch.
//
//  SETUP (once): ANTHROPIC_API_KEY in the hosting env (no NEXT_PUBLIC_ prefix).
//  Web search + Opus can take a couple of minutes — needs a longer function
//  timeout (e.g. Vercel Pro).
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SYSTEM = `You are the research desk behind "The Grounds Dispatch" — a bespoke weekly agronomy intelligence brief written for one golf course superintendent. You write like a sharp turf editor: confident, specific, plain-spoken, no fluff or hype.

HOW YOU RESEARCH
- Cast a WIDE net every week: university extension (Penn State, Rutgers, Cornell, Wisconsin, Tennessee, UMass, NC State, etc.), USGA, GCSAA, peer-reviewed journals (Crop Science, Plant Disease, Agronomy Journal, Crop, Forage & Turfgrass Mgmt), and international turf research. Use web search.
- Bias hard toward RECENT work (this season / this year). Avoid evergreen textbook facts the super already knows.
- TARGET the course's region and grasses: the weather-station coordinates define the climate zone — prioritise the nearest land-grant turf programs and regionally-relevant conditions. Filter findings to THIS course's grass species; if a study used a different cultivar, say so rather than over-applying it.
- NEVER repeat anything in the COVERED list you are given — those topics have already been sent in past editions. Find genuinely new material each week.
- Only state a finding you actually found via search. Cite the source. Never invent studies, numbers, or citations.

GROUND IT
- Weave the course's own data into the hero and the "take" lines where it's genuinely relevant (growth-reg GDD vs target, clip/GvX, moisture, spray program / FRAC rotation, forecast). Be concrete with their numbers.

OUTPUT
Respond with ONLY a single JSON object (no prose, no markdown fences) of this exact shape:
{
  "title": "Friday Turf Research Brief — <Month Day>",
  "dateline": "<short, e.g. 'Blue & Gold · Mid-Atlantic'>",
  "hero": { "eyebrow": "This week's call", "headline": "<one bold decision, ~10-14 words>", "standfirst": "<2-3 sentences; include their data + why now>" },
  "findings": [
    { "n": "I", "subhead": "<punchy editorial subhead>", "body": "<2-3 sentences, the finding>", "take": "<'For you' — how it applies to THIS course/grasses/region>", "sources": [ { "name": "<institution / journal>" } ] }
  ],
  "audioScript": "<a natural ~150-word spoken version of the brief, first sentence names the single most important call, plain sentences for text-to-speech>",
  "keys": [ "<short kebab-case topic key per finding, for de-duplication next week, e.g. 'dmi-injury-poa'>" ]
}
Give 3-5 findings. Keep each tight. The headline is the single most important thing this week.`

// Close off a JSON object that got cut short (e.g. the model hit max_tokens
// mid-brief): finish an open string, drop a dangling comma, and balance the
// braces/brackets that were still open. Lets a truncated brief still render.
function repairJson(s) {
  let out = '', inStr = false, esc = false
  const stack = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    out += ch
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
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
  if (b > 0) { try { return JSON.parse(s.slice(0, b + 1)) } catch { /* fall through to repair */ } }
  return repairJson(s)
}

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in your hosting settings, then redeploy.' }, { status: 503 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const context = body?.context
  if (!context || typeof context !== 'object') return Response.json({ error: 'Missing course context.' }, { status: 400 })
  const covered = Array.isArray(body?.covered) ? body.covered.slice(0, 200) : []

  const client = new Anthropic({ apiKey })
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 7 }]
  const messages = [{
    role: 'user',
    content: `Today is ${today}. Research this week's turf science for this course and return the JSON brief.\n\nALREADY COVERED (do NOT repeat these topics):\n${covered.length ? covered.join(', ') : '(nothing yet)'}\n\nCOURSE CONTEXT:\n\`\`\`json\n${JSON.stringify(context).slice(0, 60000)}\n\`\`\``,
  }]

  // Stream so the long web-search + reasoning run doesn't trip a socket timeout,
  // and give the JSON room: adaptive thinking + search results share max_tokens,
  // so a tight budget was truncating the brief mid-object.
  const make = () => client.messages.stream({
    model: 'claude-opus-5', max_tokens: 16000, thinking: { type: 'adaptive' }, tools, system: SYSTEM, messages,
  }).finalMessage()

  try {
    let resp = await make()
    let guard = 0
    while (resp.stop_reason === 'pause_turn' && guard++ < 10) { messages.push({ role: 'assistant', content: resp.content }); resp = await make() }
    if (resp.stop_reason === 'refusal') return Response.json({ error: 'The request was declined.' }, { status: 422 })
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
    const brief = extractJson(text)
    if (!brief || !Array.isArray(brief.findings) || !brief.findings.length) return Response.json({ error: 'Could not compile the brief. Try again.' }, { status: 502 })
    return Response.json({ brief, generatedAt: new Date().toISOString() })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: 'AI is busy right now — try again in a minute.' }, { status: 429 })
    if (e instanceof Anthropic.APIError) return Response.json({ error: e.message || 'AI request failed.' }, { status: e.status || 502 })
    return Response.json({ error: 'AI request failed.' }, { status: 500 })
  }
}
