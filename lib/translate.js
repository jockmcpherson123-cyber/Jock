// Client helper for the crew board's per-person translation. Given the day's
// tasks and the crew's language settings, it works out which phrases need
// translating, pulls what's already cached in the database, asks the AI for
// anything new (then caches it), and returns a lookup map.
//
// The map is keyed by `${lang} ${source}`; use txGet() to read from it.
import * as db from '@/lib/db'

export const txKeyOf = (lang, source) => `${lang} ${source}`
export const txGet = (map, lang, source) => (lang && lang !== 'en' && map ? map[txKeyOf(lang, source)] : null) || null

const phrasesOf = (t) => [t.job, t.notes, ...String(t.equipment || '').split(',').map((s) => s.trim()).filter(Boolean)].filter(Boolean)

// Returns the translation map for the given tasks + crew languages. Non-fatal:
// on any error it returns whatever it has (often the plain cache), so the board
// simply falls back to the original text.
export async function loadTranslations(tasks, crew) {
  const need = {}
  ;(tasks || []).forEach((t) => {
    const lang = crew?.[t.assignee]?.lang
    if (!lang || lang === 'en') return
    phrasesOf(t).forEach((text) => { need[txKeyOf(lang, text)] = { text, lang } })
  })
  const pairs = Object.values(need)
  if (pairs.length === 0) return {}

  const langs = [...new Set(pairs.map((p) => p.lang))]
  let cached = {}
  try { cached = await db.fetchTranslations(langs) } catch (e) { console.error('translation cache read failed', e) }

  const missing = pairs.filter((p) => !(txKeyOf(p.lang, p.text) in cached))
  if (missing.length === 0) return cached

  const fresh = {}
  try {
    const res = await fetch('/api/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: missing }) })
    if (res.ok) {
      const data = await res.json()
      const rows = (data.translations || []).filter((r) => r && r.text && r.lang && r.translation)
      rows.forEach((r) => { fresh[txKeyOf(r.lang, r.text)] = r.translation })
      if (rows.length) db.saveTranslations(rows.map((r) => ({ source: r.text, lang: r.lang, translation: r.translation }))).catch((e) => console.error('translation cache write failed', e))
    }
  } catch (e) { console.error('translation request failed', e) }

  return { ...cached, ...fresh }
}
