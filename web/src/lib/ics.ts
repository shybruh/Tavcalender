import { addDays, format } from "date-fns"
import type { CalEvent } from "./pb"
import { eventRange } from "./dates"

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`)
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")

/** Downloads a single event as an .ics file (opens in Apple/Google/Outlook calendar). */
export function downloadIcs(ev: CalEvent) {
  const { start, end } = eventRange(ev)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tav Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${ev.id}@tavcalendar`,
    `DTSTAMP:${utc(new Date())}`,
    ...(ev.all_day
      ? [`DTSTART;VALUE=DATE:${format(start, "yyyyMMdd")}`, `DTEND;VALUE=DATE:${format(addDays(end, 1), "yyyyMMdd")}`]
      : [`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`]),
    `SUMMARY:${esc(ev.title)}`,
    ev.location && `LOCATION:${esc(ev.location)}`,
    ev.description && `DESCRIPTION:${esc(ev.description)}`,
    `URL:${window.location.origin}/event/${ev.id}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean)

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${ev.title.replace(/[^\w\d-]+/g, "_").slice(0, 40) || "event"}.ics`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
