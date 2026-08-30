// ════════════════════════════════════════════════════════════════════════
//  AI label reader — server route.
//
//  Takes a product name and/or one or more photos of a pesticide label, and
//  asks Claude to read the label and pull out the safety facts we care about:
//  which grass types the product can damage, its signal word, active
//  ingredient, REI and PHI. It returns that as clean data the Chemical Library
//  can drop straight into the edit form (the user still reviews it before
//  saving).
//
//  WHY THIS LIVES ON THE SERVER: the Anthropic API key is a secret. It must
//  never ship to the browser. This route runs on Vercel's servers, reads the
//  key from an environment variable, and only sends back the extracted facts —
//  the key itself stays hidden.
//
//  SETUP (once): add an environment variable named ANTHROPIC_API_KEY in Vercel
//  (Project → Settings → Environment Variables). Do NOT prefix it with
//  NEXT_PUBLIC — that would expose it to the browser.
// ════════════════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk'

// This route reads the request body and a secret, so it can't be pre-rendered.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in your Vercel settings, then redeploy.' },
      { status: 503 },
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Bad request.' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  const grassTypes = Array.isArray(body.grassTypes) ? body.grassTypes.filter(Boolean) : []
  // images: array of { media_type, data } where data is base64 (no data: prefix)
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : []

  if (!name && images.length === 0) {
    return Response.json({ error: 'Give a product name or at least one label photo.' }, { status: 400 })
  }

  // The grass list drives an enum so the model can only return grasses this
  // club actually tracks — anything it can't map is simply left off.
  const grassEnum = grassTypes.length ? grassTypes : ['(none configured)']

  const schema = {
    type: 'object',
    properties: {
      found: {
        type: 'boolean',
        description: 'True if you could read/identify the product with reasonable confidence.',
      },
      productName: { type: 'string', description: 'The product name as printed on the label.' },
      activeIngredient: { type: 'string', description: 'Active ingredient(s), or empty string if unknown.' },
      epaReg: {
        type: 'string',
        description:
          'EPA Registration Number exactly as printed (e.g. "100-1234" or "432-1514-59884"). Look for "EPA Reg. No." on the label. Empty string if not visible/unknown. Do NOT confuse with the EPA Establishment Number ("EPA Est. No.").',
      },
      moaGroup: {
        type: 'string',
        description:
          'Resistance / mode-of-action group code if the product is a fungicide, herbicide or insecticide: FRAC group for fungicides (e.g. "FRAC 3", "FRAC M05"), HRAC group for herbicides (e.g. "HRAC 2"), IRAC group for insecticides. Empty string for fertilizers, biologicals, wetting agents, or if unknown.',
      },
      signalWord: {
        type: 'string',
        enum: ['Caution', 'Warning', 'Danger', ''],
        description: 'EPA signal word from the label, or empty string if unknown.',
      },
      rei: { type: 'string', description: 'Restricted-entry interval (e.g. "12 hours"), or empty string if unknown.' },
      phi: { type: 'string', description: 'Pre-harvest / turf re-entry note if stated, else empty string.' },
      avoidGrasses: {
        type: 'array',
        items: { type: 'string', enum: grassEnum },
        description:
          'Grass types this product can INJURE, discolor, or is NOT labeled for. Only include a grass if the label indicates real risk. Use only values from the allowed list; leave empty if none or unknown.',
      },
      safetyNote: {
        type: 'string',
        description: 'One short plain-English caution about turf safety, or empty string.',
      },
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Your confidence in this extraction.',
      },
    },
    required: ['found', 'productName', 'activeIngredient', 'epaReg', 'moaGroup', 'signalWord', 'rei', 'phi', 'avoidGrasses', 'safetyNote', 'confidence'],
    additionalProperties: false,
  }

  const parts = []
  for (const img of images) {
    if (img && img.data && img.media_type) {
      parts.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })
    }
  }
  const instruction = images.length
    ? `Read these photos of a turf pesticide/fertilizer product label${name ? ` for "${name}"` : ''} and extract the safety facts.`
    : `Using your knowledge of the turf product "${name}", extract the safety facts. If you are not confident this is a real product, set found=false and leave fields empty.`

  parts.push({
    type: 'text',
    text:
      `${instruction}\n\n` +
      `Also capture the EPA Registration Number ("EPA Reg. No.") exactly as printed — it is required for state pesticide records — and the resistance group code (FRAC/HRAC/IRAC) if this is a fungicide, herbicide or insecticide.\n` +
      `The golf course tracks these grass types: ${grassTypes.length ? grassTypes.join(', ') : '(none configured)'}.\n` +
      `For avoidGrasses, list ONLY grasses from that set that this product could injure or is not safe/labeled for. ` +
      `Be conservative — only flag a grass when the label or well-established label guidance indicates real turf injury risk. ` +
      `If you are unsure, leave avoidGrasses empty rather than guessing.`,
  })

  const client = new Anthropic({ apiKey })

  let response
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system:
        'You are a turfgrass agronomy assistant that reads pesticide and fertilizer labels for a golf course. ' +
        'You extract structured safety facts. You never invent label data. When a field is not clearly supported, ' +
        'you return an empty string or empty list. This is decision-support only; a licensed applicator verifies the physical label before spraying.',
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: parts }],
    })
  } catch (err) {
    const msg = err?.status === 401 ? 'The AI key was rejected. Check ANTHROPIC_API_KEY in Vercel.' : 'The AI service could not be reached. Try again.'
    return Response.json({ error: msg }, { status: 502 })
  }

  if (response.stop_reason === 'refusal') {
    return Response.json({ error: 'The AI declined to answer for this input. Enter the details by hand.' }, { status: 422 })
  }

  const textBlock = (response.content || []).find((b) => b.type === 'text')
  if (!textBlock) {
    return Response.json({ error: 'The AI returned nothing usable. Try a clearer photo.' }, { status: 502 })
  }

  let data
  try {
    data = JSON.parse(textBlock.text)
  } catch {
    return Response.json({ error: 'The AI response was malformed. Try again.' }, { status: 502 })
  }

  // Belt-and-suspenders: keep only grasses that are actually on the club's list.
  if (Array.isArray(data.avoidGrasses) && grassTypes.length) {
    data.avoidGrasses = data.avoidGrasses.filter((g) => grassTypes.includes(g))
  }

  return Response.json({ result: data })
}
