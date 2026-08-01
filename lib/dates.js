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
