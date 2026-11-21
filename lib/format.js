// Shared formatting helpers — one number, money and date style across the whole
// app, so figures never disagree page to page. Negatives always use a real
// minus sign "−" (not a hyphen), and money shows the sign before the "$".

// A plain number with comma thousands separators. Pass { decimals } to fix the
// number of decimal places; otherwise it prints as given. Non-numbers → "—".
export function formatNumber(n, opts = {}) {
  if (n == null || n === '' || !isFinite(Number(n))) return '—'
  const num = Number(n)
  const o = opts.decimals != null ? { minimumFractionDigits: opts.decimals, maximumFractionDigits: opts.decimals } : {}
  return num.toLocaleString('en-US', o).replace('-', '−')
}

// Money: "−$6,104.46", never "$-6,104.46". Defaults to 2 decimals; pass
// { decimals: 0 } for whole-dollar figures.
export function formatMoney(n, opts = {}) {
  if (n == null || !isFinite(Number(n))) return '—'
  const num = Number(n)
  const decimals = opts.decimals != null ? opts.decimals : 2
  const sign = num < 0 ? '−' : ''
  return `${sign}$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

// Dates: "Mon, Nov 23" in lists, "Nov 23, 2026" in headers. Accepts an ISO
// string ("2026-11-23") or a Date. Invalid/empty → "—".
export function formatDate(d, style = 'list') {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d) : d
  if (!dt || isNaN(dt.getTime())) return '—'
  if (style === 'header') return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
