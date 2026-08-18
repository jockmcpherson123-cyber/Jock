// ════════════════════════════════════════════════════════════════════════
//  AI library enrichment — server route.
//
//  Takes a batch of product names (+ type) and asks Claude to return the label
//  facts it knows for each turf product: active ingredient & %, manufacturer,
//  formulation, signal word, REI, FRAC/MOA group, EPA registration #, and
//  typical label rate ranges. The Chemical Library reviews the result and fills
//  only the BLANK fields — the applicator verifies the physical label before
//  trusting the compliance-sensitive numbers (EPA reg #, rates).
//
//  The Anthropic key stays server-side (ANTHROPIC_API_KEY). Never NEXT_PUBLIC.
// ════════════════════════════════════════════════════════════════════════
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FORMS = ['conditioner', 'dry', 'wsp', 'flowable', 'soluble', 'ec', 'fertilizer', 'adjuvant', 'other', '']

export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'AI is not set up yet. Add ANTHROPIC_API_KEY in your Vercel settings, then redeploy.' }, { status: 503 })
  }

  let body
  try { body = await request.json() } catch { return Response.json({ error: 'Bad request.' }, { status: 400 }) }

  const products = (Array.isArray(body.products) ? body.products : [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, 40)
    .map((p) => ({ name: p.name.trim().slice(0, 120), type: (p.type || '').slice(0, 40) }))
  if (products.length === 0) return Response.json({ results: [] })

  const productSchema = {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Echo the product name exactly as given in the input, so it can be matched.' },
      found: { type: 'boolean', description: 'True only if you recognize this as a real turf product with reasonable confidence.' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      activeIngredient: { type: 'string', description: 'Active ingredient(s), else empty string.' },
      activePct: { type: 'string', description: 'Active-ingredient percentage as a number string (e.g. "14.3"), else empty.' },
      manufacturer: { type: 'string', description: 'Maker/brand (e.g. Syngenta), else empty.' },
      formulation: { type: 'string', enum: FORMS, description: 'Formulation code, else empty.' },
      signalWord: { type: 'string', enum: ['Caution', 'Warning', 'Danger', ''] },
      rei: { type: 'string', description: 'Restricted-entry interval e.g. "12 hours", else empty.' },
      moaGroup: { type: 'string', description: 'Resistance group: FRAC # for fungicides, HRAC for herbicides, IRAC for insecticides (e.g. "FRAC 3", "HRAC 4"). Else empty.' },
      epaReg: { type: 'string', description: 'EPA registration number if you are confident (e.g. "100-1234"). VERIFY-SENSITIVE: leave empty rather than guessing.' },
      labelMinM: { type: 'string', description: 'Low end of label rate in oz per 1,000 sq ft, number string, else empty.' },
      labelMaxM: { type: 'string', description: 'High end of label rate in oz per 1,000 sq ft, number string, else empty.' },
      labelMinA: { type: 'string', description: 'Low end of label rate in oz per acre, number string, else empty.' },
      labelMaxA: { type: 'string', description: 'High end of label rate in oz per acre, number string, else empty.' },
      sprayInterval: { type: 'string', description: 'Typical reapplication interval in days, number string, else empty.' },
    },
    required: ['name', 'found', 'confidence', 'activeIngredient', 'activePct', 'manufacturer', 'formulation', 'signalWord', 'rei', 'moaGroup', 'epaReg', 'labelMinM', 'labelMaxM', 'labelMinA', 'labelMaxA', 'sprayInterval'],
    additionalProperties: false,
  }
  const schema = {
    type: 'object',
    properties: { results: { type: 'array', items: productSchema } },
    required: ['results'],
    additionalProperties: false,
  }

  const client = new Anthropic({ apiKey })
  let response
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system:
        'You are a turfgrass agronomy assistant that fills in reference data for a golf course chemical library. ' +
        'For each product you recognize, return its label facts from your knowledge. Never invent data: when a field ' +
        'is not something you are confident about, return an empty string. Be especially conservative with EPA ' +
        'registration numbers and exact label rates — leave them empty unless you are confident. This is ' +
        'decision-support only; a licensed applicator verifies the physical label before use.',
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content:
          'Fill in the label reference data for each of these turf products. Rate ranges: use oz per 1,000 sq ft ' +
          '(labelMinM/labelMaxM) for products applied to greens/tees, and oz per acre (labelMinA/labelMaxA) for ' +
          'broadcast/fairway/rough products; fill whichever the label uses and leave the other empty.\n\n' +
          JSON.stringify(products),
      }],
    })
  } catch (err) {
    const msg = err?.status === 401 ? 'The AI key was rejected. Check ANTHROPIC_API_KEY in Vercel.' : 'The AI service could not be reached. Try again.'
    return Response.json({ error: msg }, { status: 502 })
  }

  if (response.stop_reason === 'refusal') {
    return Response.json({ error: 'The AI declined this request.' }, { status: 422 })
  }
  const textBlock = (response.content || []).find((b) => b.type === 'text')
  let data
  try { data = JSON.parse(textBlock?.text || '{}') } catch { return Response.json({ error: 'The AI response was malformed. Try again.' }, { status: 502 }) }
  return Response.json({ results: Array.isArray(data.results) ? data.results : [] })
}
