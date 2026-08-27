// Greens speed (Stimpmeter) is measured in feet and inches — "9'10"" is 9 feet
// 10 inches, not 9.1 feet. We store the reading as decimal feet (so averaging and
// trends stay simple), but always ENTER and DISPLAY it as feet + inches.

// Decimal feet → `9'10"`. Rounds to the nearest inch and rolls 12" up to a foot.
export function fmtStimp(v) {
  if (v == null || v === '' || isNaN(Number(v))) return '—'
  const totalIn = Math.round(Number(v) * 12)
  const ft = Math.floor(totalIn / 12)
  const inch = totalIn % 12
  return `${ft}'${inch}"`
}

// Feet + inches → decimal feet. Blank/invalid parts count as 0.
export function stimpToFeet(ft, inch) {
  const f = Number(ft) || 0
  const i = Number(inch) || 0
  return Math.round((f + i / 12) * 1000) / 1000
}

// Decimal feet → { ft, inch } for splitting a stored value back into two inputs.
export function feetToParts(v) {
  if (v == null || v === '' || isNaN(Number(v))) return { ft: '', inch: '' }
  const totalIn = Math.round(Number(v) * 12)
  return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 }
}
