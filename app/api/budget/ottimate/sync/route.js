// ════════════════════════════════════════════════════════════════════════
//  Ottimate (AP / invoice processing) sync — Phase 6 SCAFFOLD.
//
//  Ottimate has an OAuth API for invoices and their GL coding, but club IT has
//  to request access and give us the credentials + the entity/location IDs that
//  belong to Golf & Grounds (dept 13). Until those exist this endpoint is a safe
//  no-op: it reports "not configured" and pulls nothing. It never invents data.
//
//  When credentials are set (as environment variables, server-side only), this
//  is where the hourly pull lives: fetch invoices coded to -13 GL lines, upsert
//  them into `actuals` as source='ottimate', status='pending', and remove/clear
//  any that were voided or re-coded in Ottimate. A matching Jonas upload later
//  supersedes the pending row (handled in lib/budget/db.js applyJonasImport).
//
//  GET  → { configured, message }           status, for the header chip
//  POST → runs the pull (finance or cron secret). 501 while unimplemented.
// ════════════════════════════════════════════════════════════════════════
import { getUser } from '@/lib/getUser'

export const dynamic = 'force-dynamic'

// True only when club IT has provisioned real credentials.
function ottimateConfig() {
  const clientId = process.env.OTTIMATE_CLIENT_ID
  const clientSecret = process.env.OTTIMATE_CLIENT_SECRET
  const entity = process.env.OTTIMATE_ENTITY_IDS // comma-separated Golf/Grounds entity or location ids
  if (!clientId || !clientSecret || !entity) return null
  return { clientId, clientSecret, entities: entity.split(',').map((s) => s.trim()).filter(Boolean), tokenUrl: process.env.OTTIMATE_TOKEN_URL, apiBase: process.env.OTTIMATE_API_BASE }
}

export async function GET() {
  const cfg = ottimateConfig()
  return Response.json({
    configured: !!cfg,
    message: cfg
      ? 'Ottimate is configured. Trigger a sync with POST, or wait for the hourly job.'
      : 'Ottimate is not connected yet. Club IT must request API access and provide the OAuth credentials and the Golf & Grounds entity IDs (set OTTIMATE_CLIENT_ID, OTTIMATE_CLIENT_SECRET, OTTIMATE_ENTITY_IDS).',
  })
}

export async function POST(request) {
  // Allow a scheduled job (shared secret) or a signed-in finance user.
  const cronSecret = process.env.OTTIMATE_CRON_SECRET
  const headerSecret = request.headers.get('x-cron-secret')
  const authedByCron = cronSecret && headerSecret && headerSecret === cronSecret
  if (!authedByCron) {
    const user = await getUser()
    if (!user || user.role !== 'finance') return Response.json({ error: 'Finance only.' }, { status: 403 })
  }

  const cfg = ottimateConfig()
  if (!cfg) return Response.json({ configured: false, synced: 0, message: 'Ottimate is not connected yet — nothing to sync.' })

  // ── When credentials exist, implement here (needs the real Ottimate API
  //    contract + the Golf/Grounds entity IDs from club IT):
  //    1. OAuth client-credentials grant against cfg.tokenUrl → access token.
  //    2. GET invoices for cfg.entities since the last sync, filtered to -13 GLs.
  //    3. For each line item, upsert into `actuals` (source 'ottimate',
  //       status 'pending') keyed by external_id; map its date → fiscal month.
  //    4. Remove pending rows whose Ottimate invoice was voided or re-coded.
  //    5. Record an import_batch (source 'ottimate') so the header shows the time.
  return Response.json({ configured: true, synced: 0, message: 'Ottimate connector not implemented yet — awaiting the API contract and entity IDs.' }, { status: 501 })
}
