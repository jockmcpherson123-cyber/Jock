// When does a spray "count"?
//
// The agronomic info banks — growth-reg (PGR) timing, disease protection, and
// nutrition (N-P-K) — must only count a spray once it has actually gone out, not
// while it's still planned or merely director-approved. "Actually gone out"
// means the field sheet is submitted, the applicator has signed it, and every
// product is checked into the tank.
//
// Bulk-imported historical sprays are real past applications entered after the
// fact (no field sign-off), so they count as-is.

// Every product on the sheet is checked into every tank load.
export function allTanksChecked(sheet) {
  const productIds = (sheet?.products || []).filter((p) => p.product).map((p) => p.id)
  if (productIds.length === 0) return true
  const tankCount = sheet.tanks || 1
  const checks = sheet.tankChecks || {}
  for (let n = 1; n <= tankCount; n++) {
    const c = checks[String(n)] || []
    if (!productIds.every((id) => c.includes(id))) return false
  }
  return true
}

export function sheetApplied(sheet) {
  if (!sheet || !sheet.completed) return false          // must be submitted ("Mark as sprayed")
  if (sheet.imported) return true                        // bulk-imported historical record
  // Field sheets stamp completedAt on submit; a historical import won't have it.
  if (!sheet.completedAt) return true
  if (!sheet.applicatorSignature) return false           // applicator must have signed
  return allTanksChecked(sheet)                           // all products checked into the tank
}
