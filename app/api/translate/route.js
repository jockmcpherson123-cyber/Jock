// ════════════════════════════════════════════════════════════════════════
//  Crew-board translation — server route.
//
//  Takes a batch of short job/equipment phrases, each with a target language
//  code, and asks Claude to translate them for the grounds crew. The client
//  caches every result in the `translations` table, so each phrase is only ever
//  translated once per language — the AI cost is one-time, not per view.
//
//  The Anthropic key is a secret and stays on the server (same as the label
//  reader). Set ANTHROPIC_API_KEY in the environment.
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LANG_NAMES = { es: 'Spanish', pt: 'Portuguese', ht: 'Haitian Creole', vi: 'Vietnamese', zh: 'Chinese (Simplified)', fr: 'French', ko: 'Korean', en: 'English' }

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in your environment, then redeploy.' }, { status: 503 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }

  // items: [{ text, lang }] — cap the batch and skip anything without a known,
  // non-English target language.
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((i) => i && typeof i.text === 'string' && i.text.trim() && i.lang && i.lang !== 'en' && LANG_NAMES[i.lang])
    .slice(0, 100)
    .map((i) => ({ text: i.text.trim().slice(0, 200), lang: i.lang }))

  if (items.length === 0) return Response.json({ translations: [] })

  const schema = {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The original phrase, echoed back exactly.' },
            lang: { type: 'string', description: 'The target language code, echoed back exactly.' },
            translation: { type: 'string', description: 'The phrase translated into the target language.' },
          },
          required: ['text', 'lang', 'translation'],
          additionalProperties: false,
        },
      },
    },
    required: ['translations'],
    additionalProperties: false,
  }

  const client = new Anthropic({ apiKey })
  let response
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2048,
      system:
        'You translate short golf-course grounds-crew job and equipment phrases for the daily work board. ' +
        'Translate each item\'s `text` into the language named by its `lang` code. Use natural, concise wording a ' +
        'maintenance crew member would use in the field. Keep brand names, equipment model names/numbers, and hole ' +
        'numbers unchanged. Echo back the original text and lang exactly so the client can match them.',
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: `Language codes: ${Object.entries(LANG_NAMES).map(([c, n]) => `${c}=${n}`).join(', ')}.\n\nTranslate these items:\n${JSON.stringify(items)}`,
      }],
    })
  } catch (err) {
    const msg = err?.status === 401 ? 'The AI key was rejected.' : 'The AI service could not be reached.'
    return Response.json({ error: msg }, { status: 502 })
  }

  const textBlock = (response.content || []).find((b) => b.type === 'text')
  if (!textBlock) return Response.json({ translations: [] })
  let data
  try { data = JSON.parse(textBlock.text) } catch { return Response.json({ translations: [] }) }
  const out = (data.translations || []).filter((r) => r && r.text && r.lang && r.translation && LANG_NAMES[r.lang])
  return Response.json({ translations: out })
}
