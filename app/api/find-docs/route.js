// Find a product's official label and SDS PDF links via web search.
//
// A label PHOTO can't tell us its own document URL — those live on the
// manufacturer's site — so this route uses Claude with the web-search tool to
// look them up by product name + manufacturer and return the best official
// links. It is deliberately SEPARATE from the label scanner so that if search
// is unavailable, the scanner still works; this just returns empty URLs.

import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return Response.json({ error: 'AI is not set up yet.' }, { status: 503 })

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }
  const name = (body.name || '').trim()
  const manufacturer = (body.manufacturer || '').trim()
  if (!name) return Response.json({ error: 'Give a product name.' }, { status: 400 })

  const client = new Anthropic({ apiKey })
  const query = `${manufacturer ? manufacturer + ' ' : ''}${name}`.trim()

  let response
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      system:
        'You find official manufacturer documents for turf pesticide/fertilizer products. ' +
        'Use web search to locate the current product LABEL (PDF preferred) and SAFETY DATA SHEET (SDS). ' +
        'Strongly prefer the manufacturer\'s own domain (or CDMS/Greenbook/Agrian) over blogs or retailers. ' +
        'Return ONLY a JSON object and nothing else: {"labelUrl":"...","sdsUrl":"..."}. ' +
        'Use an empty string for any document you cannot find a direct, credible link to. Never invent a URL.',
      messages: [{
        role: 'user',
        content: `Find the official product label PDF and SDS for the turf product "${query}". Return only the JSON object.`,
      }],
    })
  } catch (err) {
    // Web search may be unavailable on this account/model — fail soft.
    return Response.json({ result: { labelUrl: '', sdsUrl: '' }, note: 'search_unavailable' })
  }

  const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  let result = { labelUrl: '', sdsUrl: '' }
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0])
      const clean = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : '')
      result = { labelUrl: clean(parsed.labelUrl), sdsUrl: clean(parsed.sdsUrl) }
    }
  } catch { /* leave empties */ }

  return Response.json({ result })
}
