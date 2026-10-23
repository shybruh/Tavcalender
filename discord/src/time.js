// Date helpers. Everything is in the server's timezone (TZ env, e.g. Indian/Maldives),
// matching the times used in notification text.
import * as chrono from "chrono-node"

export const TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone

const fmt = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts })
const dayFmt = fmt({ weekday: "short", day: "numeric", month: "short" })
const timeFmt = fmt({ hour: "2-digit", minute: "2-digit", hour12: false })
const ymdFmt = fmt({ year: "numeric", month: "2-digit", day: "2-digit" })

/** "2026-10-24" for a Date, in TZ. */
export function ymd(date) {
  const p = Object.fromEntries(ymdFmt.formatToParts(date).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export const dayLabel = (date) => dayFmt.format(date)
export const timeLabel = (date) => timeFmt.format(date)

/** Offset (ms) of TZ from UTC at a given instant. */
function tzOffset(at) {
  const p = Object.fromEntries(
    fmt({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
      .formatToParts(at).map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return asUtc - at.getTime()
}

/** The instant for a wall-clock date ("2026-10-24") and time ("19:30") in TZ. */
export function zoned(day, time = "00:00") {
  const [y, m, d] = day.split("-").map(Number)
  const [hh, mm] = time.split(":").map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  return new Date(guess - tzOffset(new Date(guess)))
}

/** All-day events are stored as UTC midnight of the calendar date (same as the app). */
export const floatingDay = (day) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** The next 14 days as select options. */
export function nextDays(n = 14) {
  const out = []
  const today = ymd(new Date())
  for (let i = 0; i < n; i++) {
    const day = ymd(new Date(zoned(today, "12:00").getTime() + i * 864e5))
    const d = zoned(day, "12:00")
    out.push({ value: day, label: i === 0 ? `Today · ${dayLabel(d)}` : i === 1 ? `Tomorrow · ${dayLabel(d)}` : dayLabel(d) })
  }
  return out
}

/** Hourly options 07:00–23:00. */
export const HOURS = Array.from({ length: 17 }, (_, i) => `${String(7 + i).padStart(2, "0")}:00`)

/** The next full hour today, as "HH:00" (clamped into the hour list). */
export function nextHour() {
  const h = Number(timeLabel(new Date()).slice(0, 2)) + 1
  return `${String(Math.min(23, Math.max(7, h))).padStart(2, "0")}:00`
}

/**
 * Parses things like "sat 7pm", "tomorrow 18:30", "in 2 hours", "24/10".
 * Returns a Date (instant) or null. Interpreted in TZ.
 */
export function parseWhen(text, ref = new Date()) {
  const results = chrono.parse(text, { instant: ref, timezone: tzOffset(ref) / 60000 }, { forwardDate: true })
  return results[0]?.start?.date() ?? null
}

/** Parses a typed date ("sat", "24 oct", "2026-10-24") into "YYYY-MM-DD", or null. */
export function parseDay(text) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) return text.trim()
  const d = parseWhen(text)
  return d ? ymd(d) : null
}

/** Parses a typed time ("7pm", "19:30", "7.30") into "HH:MM", or null. */
export function parseTime(text) {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] || 0)
  if (m[3] === "pm" && h < 12) h += 12
  if (m[3] === "am" && h === 12) h = 0
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
}

/** "Sat 25 Oct · 19:00–21:00" / "Sat 25 Oct · All day" for an event record. */
export function describeEvent(ev) {
  if (ev.all_day) {
    const d = new Date(ev.start.replace(" ", "T"))
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d)} · All day`
  }
  const s = new Date(ev.start.replace(" ", "T"))
  const e = ev.end ? new Date(ev.end.replace(" ", "T")) : null
  return `${dayLabel(s)} · ${timeLabel(s)}${e ? `–${timeLabel(e)}` : ""}`
}

/** Discord's own timestamp markup (shows in each viewer's local time). */
export const discordTime = (date, style = "f") => `<t:${Math.floor(date.getTime() / 1000)}:${style}>`
