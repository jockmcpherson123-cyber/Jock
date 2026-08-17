// Built-in Spanish for grounds-crew job / surface / equipment terms, so the crew
// phone board can flip to Spanish INSTANTLY — no AI key, no login. Whole-phrase
// matches win; otherwise every known term inside a phrase is swapped and the rest
// (place names, hole numbers like "#6", abbreviations) is left exactly as-is.
//
// Longest phrases are listed first so multi-word jobs match before single words.
const TERMS = [
  ['course setup', 'Preparación del campo'],
  ['set up course', 'Preparar el campo'],
  ['mow greens', 'Cortar greens'],
  ['mow approaches', 'Cortar approaches'],
  ['mow tees', 'Cortar tees'],
  ['mow fairways', 'Cortar fairways'],
  ['mow rough', 'Cortar rough'],
  ['mow collars', 'Cortar collars'],
  ['mow surrounds', 'Cortar contornos'],
  ['rake bunkers', 'Rastrillar bunkers'],
  ['change cups', 'Cambiar hoyos'],
  ['change holes', 'Cambiar hoyos'],
  ['move tees', 'Mover marcas'],
  ['hand water', 'Riego manual'],
  ['irrigation check', 'Revisión de riego'],
  ['fix irrigation', 'Reparar riego'],
  ['blow / clean', 'Soplar / limpiar'],
  ['blow/clean', 'Soplar / limpiar'],
  ['fill divots', 'Rellenar divots'],
  ['divot fill', 'Rellenar divots'],
  ['pull tarps', 'Quitar lonas'],
  ['weed eat', 'Desbrozar'],
  ['string trim', 'Desbrozar'],
  ['leaf blow', 'Soplar hojas'],
  ['blow leaves', 'Soplar hojas'],
  ['set up', 'Preparar'],
  ['clean up', 'Limpiar'],
  ['mow', 'Cortar'],
  ['rolling', 'Rodando'],
  ['roll', 'Rodar'],
  ['bunkers', 'Bunkers'],
  ['bunker', 'Bunker'],
  ['topdressing', 'Topdressing'],
  ['topdress', 'Topdress'],
  ['aerify', 'Aerear'],
  ['aerate', 'Aerear'],
  ['verticut', 'Verticorte'],
  ['spraying', 'Fumigando'],
  ['spray', 'Fumigar'],
  ['fertilize', 'Fertilizar'],
  ['blowing', 'Soplando'],
  ['blow', 'Soplar'],
  ['cleaning', 'Limpiando'],
  ['clean', 'Limpiar'],
  ['raking', 'Rastrillando'],
  ['rake', 'Rastrillar'],
  ['watering', 'Regando'],
  ['water', 'Regar'],
  ['edging', 'Bordear'],
  ['edge', 'Bordear'],
  ['trim', 'Recortar'],
  ['nursery', 'Vivero'],
  ['practice green', 'Green de práctica'],
  ['putting green', 'Putting green'],
  ['driving range', 'Driving range'],
  ['clubhouse', 'Casa club'],
  ['pro shop', 'Pro shop'],
  ['carts', 'Carritos'],
  ['cart', 'Carrito'],
  ['greens', 'Greens'],
  ['green', 'Green'],
  ['tees', 'Tees'],
  ['tee', 'Tee'],
  ['fairways', 'Fairways'],
  ['fairway', 'Fairway'],
  ['approaches', 'Approaches'],
  ['approach', 'Approach'],
  ['rough', 'Rough'],
  ['collars', 'Collars'],
  ['collar', 'Collar'],
  ['surrounds', 'Contornos'],
  ['each and every day', 'todos los días'],
  ['every day', 'todos los días'],
  ['please', 'Por favor'],
  ['and', 'y'],
  ['the', 'el'],
  ['out', ''],
]

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Translate a phrase to Spanish using the dictionary. Falls back gracefully:
// unknown words (place names, numbers) are left untouched.
export function toEs(text) {
  if (text == null || text === '') return text
  const key = String(text).trim().toLowerCase()
  const exact = TERMS.find(([en]) => en === key)
  if (exact) return exact[1]
  let out = String(text)
  for (const [en, es] of TERMS) {
    out = out.replace(new RegExp(`\\b${escapeRe(en)}\\b`, 'gi'), es)
  }
  // Tidy up any double spaces left by blank replacements.
  return out.replace(/\s{2,}/g, ' ').trim()
}
