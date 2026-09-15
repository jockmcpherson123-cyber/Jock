// ════════════════════════════════════════════════════════════════════════
//  AI Turf Brief — server route.
//
//  Takes a compact summary of the club's data (recent trends, weather forecast,
//  annual program, course grasses/regions) and asks Claude to research recent,
//  credible turf findings on the web and write a weekly decision brief grounded
//  in THAT club's situation.
//
//  WHY SERVER-SIDE: the Anthropic API key is a secret and must never reach the
//  browser. This runs on Vercel, reads the key from an env var, and returns
//  only the finished brief.
//
//  SETUP (once): ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables
//  (no NEXT_PUBLIC_ prefix). Web search + Opus can take up to a couple of
//  minutes, so this route needs a plan that allows a longer function timeout.
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SYSTEM = `You are a turf agronomy research assistant for a golf course maintenance team. You write a weekly decision brief for the superintendent and their director — plain, confident, practical language a superintendent respects. Specific, no fluff, no hype.

Ground EVERYTHING in the COURSE CONTEXT provided (grasses, region, recent data trends, weather forecast, annual program). When you state an external research finding, you MUST have actually found it via web search in this session — cite the source (institution + what it is). NEVER invent studies, numbers, product claims, or citations. If you found nothing solid this week, say so plainly rather than padding. Flag anything the team must verify against the product label and local conditions before acting.

Write the brief in markdown with these sections, giving each real weight:

## Your data — what to notice
Read the trends in the provided data (clipping volume / GvX, growth-reg GDD, moisture, green speed, soil). Call out what is moving, whether it is inside target, outlier greens, and why it matters this week.

## Spray program check
From the products (with FRAC group / mode of action) and the recent + planned sprays: flag resistance-management concerns (repeating the same FRAC group, not rotating modes of action), reapply intervals slipping, and any REI/PHI that could collide with upcoming play or events. Think of the fungicide plan as a resistance-management plan first. If the data isn't there to judge something, say so rather than guessing.

## Incoming weather & spray windows
From the forecast: disease pressure, heat/cold/wind stress, and the best days to spray or water-in over the coming week.

## This week's research worth knowing
2–4 recent, credible turf findings relevant to THIS course's grasses and conditions. Each: the finding in a sentence, a one-line "what it means for you", and the source. Prefer university extension, peer-reviewed journals, USGA. Verify-before-acting applies here.

## Annual program — on the radar
Upcoming applications and tasks from their program, and what to prepare for.

## Recommended actions this week
A short, prioritized checklist grounded in everything above.

Keep it tight — a superintendent reads this over coffee. End with one line reminding the team to verify research items and rates against the product label and local conditions before acting.`

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in your Vercel settings, then redeploy.' }, { status: 503 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const context = body?.context
  if (!context || typeof context !== 'object') {
    return Response.json({ error: 'Missing course context.' }, { status: 400 })
  }

  const client = new Anthropic({ apiKey })
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }]
  const messages = [{
    role: 'user',
    content: `Today is ${today}. Below is the course context as JSON. Search the web for recent, relevant turf research, then write this week's brief for this specific course.\n\nCOURSE CONTEXT:\n\`\`\`json\n${JSON.stringify(context).slice(0, 60000)}\n\`\`\``,
  }]

  const make = () => client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 6000,
    thinking: { type: 'adaptive' },
    tools,
    system: SYSTEM,
    messages,
  })

  try {
    let resp = await make()
    // Web search is a server tool; the model may pause to run it. Continue the loop.
    let guard = 0
    while (resp.stop_reason === 'pause_turn' && guard++ < 6) {
      messages.push({ role: 'assistant', content: resp.content })
      resp = await make()
    }
    if (resp.stop_reason === 'refusal') {
      return Response.json({ error: 'The request was declined.' }, { status: 422 })
    }
    const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
    if (!text) return Response.json({ error: 'No brief was produced. Try again.' }, { status: 502 })
    return Response.json({ brief: text, generatedAt: new Date().toISOString() })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: 'AI is busy right now — try again in a minute.' }, { status: 429 })
    if (e instanceof Anthropic.APIError) return Response.json({ error: e.message || 'AI request failed.' }, { status: e.status || 502 })
    return Response.json({ error: 'AI request failed.' }, { status: 500 })
  }
}
