import { format, isSameDay, startOfDay, endOfDay, addMinutes } from "date-fns"
import type { CalEvent } from "./pb"

// PocketBase stores dates as "2026-10-23 11:13:22.171Z" (UTC).
//
// Timed events are stored as real instants.
// All-day events are "floating": stored as UTC midnight of the calendar date and
// read back using the UTC Y/M/D so they land on the same day in every timezone.

export function parsePb(value: string): Date | null {
  if (!value) return null
  const d = new Date(value.replace(" ", "T"))
  return Number.isNaN(d.getTime()) ? null : d
}

export function toPb(date: Date): string {
  return date.toISOString().replace("T", " ")
}

/** Local Date for a floating all-day value. */
function floating(value: string): Date | null {
  const d = parsePb(value)
  return d ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : null
}

/** Stores a local calendar date as a floating all-day value. */
export function toPbDate(date: Date): string {
  return toPb(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())))
}

/** Start/end of an event as local Dates (end is inclusive for all-day events). */
export function eventRange(ev: CalEvent): { start: Date; end: Date } {
  if (ev.all_day) {
    const start = floating(ev.start) ?? new Date()
    const end = floating(ev.end) ?? start
    return { start, end: endOfDay(end < start ? start : end) }
  }
  const start = parsePb(ev.start) ?? new Date()
  const end = parsePb(ev.end) ?? addMinutes(start, 60)
  return { start, end: end < start ? start : end }
}

export function eventOnDay(ev: CalEvent, day: Date) {
  const { start, end } = eventRange(ev)
  return start <= endOfDay(day) && end >= startOfDay(day)
}

/** "All day", "14:00 – 15:30", or "Mon 3 Nov 14:00 – Tue 4 Nov 10:00". */
export function formatEventTime(ev: CalEvent, opts: { withDate?: boolean } = {}) {
  const { start, end } = eventRange(ev)
  if (ev.all_day) {
    const label = isSameDay(start, end) ? format(start, "EEE d MMM") : `${format(start, "EEE d MMM")} – ${format(end, "EEE d MMM")}`
    return opts.withDate ? `${label} · All day` : isSameDay(start, end) ? "All day" : label
  }
  if (isSameDay(start, end)) {
    const time = `${format(start, "HH:mm")} – ${format(end, "HH:mm")}`
    return opts.withDate ? `${format(start, "EEE d MMM")} · ${time}` : time
  }
  return `${format(start, "EEE d MMM HH:mm")} – ${format(end, "EEE d MMM HH:mm")}`
}

/** Value for <input type="date"> */
export const dateInput = (d: Date) => format(d, "yyyy-MM-dd")
/** Value for <input type="time"> */
export const timeInput = (d: Date) => format(d, "HH:mm")

/** Combines <input type="date"> and <input type="time"> values into a local Date. */
export function fromInputs(date: string, time = "00:00"): Date {
  const [y, m, d] = date.split("-").map(Number)
  const [hh, mm] = time.split(":").map(Number)
  return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0)
}

export function floatingDate(value: string) {
  return floating(value)
}
