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

  const cleanUrl = (u) => {
    const s = String(u || '').trim()
    return /^https?:\/\//i.test(s) ? s.slice(0, 500) : ''
  }
  const products = (Array.isArray(body.products) ? body.products : [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .slice(0, 40)
    .map((p) => ({
      name: p.name.trim().slice(0, 120),
      type: (p.type || '').slice(0, 40),
      labelUrl: cleanUrl(p.labelUrl),
      sdsUrl: cleanUrl(p.sdsUrl),
      epaReg: String(p.epaReg || '').trim().slice(0, 40),
    }))
  if (products.length === 0) return Response.json({ results: [] })
  const withLabels = products.filter((p) => p.labelUrl)

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

  const system =
    'You are a turfgrass agronomy assistant that fills in reference data for a golf course chemical library. ' +
    'When a product includes a "labelUrl", FETCH that page with the web_fetch tool and read that exact label as ' +
    'the AUTHORITATIVE source for that product — so you identify the precise product/formulation and never second-' +
    'guess which one it is. If no labelUrl is given (or the fetch fails), fall back to your own knowledge. ' +
    'Never invent data: when a field is not stated on the label (or you are not confident), return an empty string. ' +
    'Be especially conservative with EPA registration numbers and exact label rates — leave them empty unless the ' +
    'label (or your confident knowledge) states them. This is decision-support only; a licensed applicator verifies ' +
    'the physical label before use.'
  const userMsg =
    'Fill in the label reference data for each of these turf products. For any product with a labelUrl, read that ' +
    'label first and use it. Rate ranges: use oz per 1,000 sq ft (labelMinM/labelMaxM) for products applied to ' +
    'greens/tees, and oz per acre (labelMinA/labelMaxA) for broadcast/fairway/rough products; fill whichever the ' +
    'label uses and leave the other empty.\n\n' + JSON.stringify(products)

  const client = new Anthropic({ apiKey })
  const base = {
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: userMsg }],
  }
  const JSON_KEYS = 'name, found, confidence, activeIngredient, activePct, manufacturer, formulation, signalWord, rei, moaGroup, epaReg, labelMinM, labelMaxM, labelMinA, labelMaxA, sprayInterval'

  const parse = (response) => {
    if (response?.stop_reason === 'refusal') return { error: 'The AI declined this request.', status: 422 }
    const textBlock = (response?.content || []).find((b) => b.type === 'text')
    let raw = textBlock?.text || ''
    // Be lenient: strip code fences / grab the first JSON object if needed.
    try { return { results: JSON.parse(raw).results || [] } }
    catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) { try { return { results: JSON.parse(m[0]).results || [] } } catch { /* fall through */ } }
      return { error: 'The AI response was malformed. Try again.', status: 502 }
    }
  }

  let response
  // When the user supplied label links, let the model fetch and read them so it
  // identifies the exact product. (Prompt-driven JSON here — tools + structured
  // output don't combine.) If the web-fetch tool isn't available on this
  // account/model, fall back to the plain structured call so it still works.
  if (withLabels.length > 0) {
    try {
      response = await client.messages.create({
        ...base,
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: Math.min(20, withLabels.length + 3) }],
        messages: [{
          role: 'user',
          content: userMsg + `\n\nReply with ONLY a JSON object of the form {"results":[ ... ]}, one item per input product, each with these keys: ${JSON_KEYS}. Every value is a string except "found" (boolean) and "confidence" (one of "high","medium","low"). Echo "name" exactly as given.`,
        }],
      })
    } catch { response = null }
  }
  if (!response) {
    try {
      response = await client.messages.create({ ...base, output_config: { format: { type: 'json_schema', schema } } })
    } catch (err) {
      const msg = err?.status === 401 ? 'The AI key was rejected. Check ANTHROPIC_API_KEY in Vercel.' : 'The AI service could not be reached. Try again.'
      return Response.json({ error: msg }, { status: 502 })
    }
  }

  const out = parse(response)
  if (out.error) return Response.json({ error: out.error }, { status: out.status })
  return Response.json({ results: Array.isArray(out.results) ? out.results : [] })
}
