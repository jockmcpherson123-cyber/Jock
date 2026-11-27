// Local calendar date as YYYY-MM-DD, in the device's own timezone — NOT UTC.
//
// `new Date().toISOString()` is UTC, so in US timezones "today" rolls over
// several hours early: an evening in Chicago (UTC−5/−6) is already "tomorrow"
// in UTC. That nudged GDD / rainfall / disease "as of today" off for a few
// evening hours and made an evening-logged spray default to tomorrow's date.
// Everything that means "today" (or "now" as a date) should use this.
export function localDateISO(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

// The hour (0–23) of a timestamp in a named timezone — defaults to the club's
// America/New_York wall-clock. Used so a moisture round is classed Afternoon
// when it STARTS at noon or later in the club's own time, regardless of the
// device or server timezone. Returns null for an unparseable timestamp.
export function hourInTZ(ts, timeZone = 'America/New_York') {
  const d = ts instanceof Date ? ts : new Date(ts)
  if (isNaN(d.getTime())) return null
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone }).format(d))
  return h % 24 // some platforms format midnight as "24"
}
