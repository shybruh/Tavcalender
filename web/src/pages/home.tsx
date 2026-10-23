import { useMemo, useRef, useState } from "react"
import { Link } from "react-router"
import { addDays, addWeeks, format, isSameDay, isSameMonth, isToday, startOfDay, startOfWeek } from "date-fns"
import { AlarmClockIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, HelpCircleIcon, MailIcon, PlusIcon, UsersIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/hooks/use-auth"
import { useCalendars, useHomeEvents, useMyRsvps, usePendingInvites, useReminders, useUserMap } from "@/hooks/queries"
import { eventOnDay, eventRange, formatEventTime, parsePb } from "@/lib/dates"
import { pb, displayName, errorMessage, type Rsvp, type RsvpStatus } from "@/lib/pb"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EventFormDialog } from "@/components/event-form"
import { EventCard, StatusPill } from "@/components/event-card"
import { UserAvatar } from "@/components/user-avatar"
import { PushPrompt } from "@/components/push-prompt"
import { EventSource } from "./calendar"

const WEEK = { weekStartsOn: 1 as const }

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
}

/** Your own day: personal events (incl. private), invites, events you're going to, reminders. */
export function HomePage() {
  const { user } = useAuth()
  const [selected, setSelected] = useState(() => startOfDay(new Date()))
  const [creating, setCreating] = useState(false)

  const today = startOfDay(new Date())
  const weekStart = startOfWeek(selected, WEEK)
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const { data: events, isLoading } = useHomeEvents(weekStart, days[6])
  const { data: calendars } = useCalendars()
  const { data: rsvps } = useMyRsvps()
  const { data: reminders } = useReminders()
  const invites = usePendingInvites()
  const users = useUserMap()

  const calMap = useMemo(() => new Map((calendars ?? []).map((c) => [c.id, c])), [calendars])
  const rsvpByEvent = useMemo(() => new Map((rsvps ?? []).map((r) => [r.event, r])), [rsvps])

  const dayEvents = (day: Date) =>
    events.filter((e) => eventOnDay(e, day)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || eventRange(a).start.getTime() - eventRange(b).start.getTime())
  const dayReminders = (day: Date) =>
    (reminders ?? []).filter((r) => !r.sent && isSameDay(parsePb(r.remind_at)!, day))

  const list = dayEvents(selected)
  const rems = dayReminders(selected)

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <div className="mb-4 flex items-end gap-2">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground">{format(today, "EEEE d MMMM")}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}, {user?.name?.split(" ")[0] || "you"}</h1>
        </div>
        <Button className="hidden md:inline-flex" onClick={() => setCreating(true)}><PlusIcon /> Plan something</Button>
      </div>

      <PushPrompt className="mb-4" />

      {invites.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium"><MailIcon className="size-4" /> Invites</h2>
          <div className="flex flex-col gap-2">
            {invites.map((r) => <InviteCard key={r.id} rsvp={r} />)}
          </div>
        </section>
      )}

      <WeekPager
        days={days}
        selected={selected}
        onSelect={setSelected}
        countFor={(d) => dayEvents(d).length}
      />

      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-semibold">{isToday(selected) ? "Today" : format(selected, "EEEE")}</h2>
        <span className="text-sm text-muted-foreground">{format(selected, "d MMMM")}</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {list.length === 0 && rems.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing planned.{" "}
              <button className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setCreating(true)}>Plan something</button>
              {" "}or see what <Link to="/group" className="font-medium text-primary underline-offset-4 hover:underline">everyone's up to</Link>.
            </div>
          )}
          {list.map((e) => {
            const mine = e.created_by === user?.id
            const r = rsvpByEvent.get(e.id)
            return (
              <EventCard
                key={e.id}
                event={e}
                color={users.get(e.created_by)?.color}
                showAudience={mine}
                label={mine && !e.groups.length ? undefined : <EventSource event={e} me={user} users={users} calMap={calMap} />}
                badge={
                  r?.status === "invited" ? <StatusPill tone="warn">Invited</StatusPill>
                    : r?.status === "going" ? <StatusPill tone="primary">Going</StatusPill>
                    : r?.status === "maybe" ? <StatusPill>Maybe</StatusPill>
                    : mine && e.guests?.length ? <StatusPill><UsersIcon className="mr-1 inline size-3" />{e.guests.length}</StatusPill>
                    : null
                }
              />
            )
          })}
          {rems.map((r) => (
            <Link key={r.id} to={r.event ? `/event/${r.event}` : "/reminders"} className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/50">
              <AlarmClockIcon className="size-4 text-primary" />
              <span className="flex-1 text-sm">{r.title}</span>
              <span className="text-sm text-muted-foreground">{format(parsePb(r.remind_at)!, "HH:mm")}</span>
            </Link>
          ))}
        </div>
      )}

      <Button
        size="icon-lg"
        className="fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 size-14 rounded-full shadow-lg md:hidden"
        onClick={() => setCreating(true)}
        aria-label="Plan something"
      >
        <PlusIcon className="size-6" />
      </Button>

      <EventFormDialog open={creating} onOpenChange={setCreating} defaultDate={selected} />
    </div>
  )
}

const ANSWERS: { value: Exclude<RsvpStatus, "invited">; label: string; icon: typeof CheckIcon }[] = [
  { value: "going", label: "Going", icon: CheckIcon },
  { value: "maybe", label: "Maybe", icon: HelpCircleIcon },
  { value: "no", label: "Decline", icon: XIcon },
]

export function InviteCard({ rsvp }: { rsvp: Rsvp }) {
  const qc = useQueryClient()
  const ev = rsvp.expand?.event
  const from = rsvp.expand?.invited_by
  const [busy, setBusy] = useState(false)
  if (!ev) return null

  async function answer(status: RsvpStatus) {
    setBusy(true)
    try {
      await pb.collection("rsvps").update(rsvp.id, { status })
      qc.invalidateQueries({ queryKey: ["rsvps"] })
      qc.invalidateQueries({ queryKey: ["events"] })
      toast.success(status === "going" ? "See you there!" : status === "maybe" ? "Marked as maybe" : "Declined")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-start gap-3">
        <UserAvatar user={from} />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{displayName(from)}</span> invited you</div>
          <Link to={`/event/${ev.id}`} className="font-medium underline-offset-4 hover:underline">{ev.title}</Link>
          <div className="text-sm text-muted-foreground">{formatEventTime(ev, { withDate: true })}</div>
          {rsvp.message && <p className="mt-1 text-sm italic">“{rsvp.message}”</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {ANSWERS.map(({ value, label, icon: Icon }) => (
          <Button key={value} size="sm" variant={value === "going" ? "default" : "outline"} className="h-9" disabled={busy} onClick={() => answer(value)}>
            <Icon /> {label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** One week of days that always fits the screen; arrows (or a swipe) move a week at a time. */
function WeekPager({ days, selected, onSelect, countFor }: {
  days: Date[]
  selected: Date
  onSelect: (d: Date) => void
  countFor: (d: Date) => number
}) {
  const touchX = useRef<number | null>(null)
  const first = days[0]
  const last = days[6]
  const thisWeek = days.some((d) => isToday(d))

  // keep the same weekday selected when paging
  const page = (delta: number) => onSelect(addWeeks(selected, delta))
  const range = isSameMonth(first, last)
    ? `${format(first, "d")} – ${format(last, "d MMMM")}`
    : `${format(first, "d MMM")} – ${format(last, "d MMM")}`

  return (
    <div
      className="mb-5 rounded-2xl border bg-card p-2"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return
        const dx = e.changedTouches[0].clientX - touchX.current
        touchX.current = null
        if (Math.abs(dx) > 50) page(dx < 0 ? 1 : -1)
      }}
    >
      <div className="mb-1 flex items-center gap-1 px-1">
        <Button variant="ghost" size="icon-sm" onClick={() => page(-1)} aria-label="Previous week"><ChevronLeftIcon /></Button>
        <div className="flex-1 text-center text-sm font-medium">{thisWeek ? "This week" : range}</div>
        {!thisWeek && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onSelect(startOfDay(new Date()))}>Today</Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={() => page(1)} aria-label="Next week"><ChevronRightIcon /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const n = countFor(d)
          const sel = isSameDay(d, selected)
          const today = isToday(d)
          return (
            <button
              key={d.toISOString()}
              onClick={() => onSelect(d)}
              aria-pressed={sel}
              aria-label={format(d, "EEEE d MMMM")}
              className={cn(
                "flex min-w-0 flex-col items-center gap-1 rounded-xl py-2 transition-colors",
                sel ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              <span className={cn("text-[11px] font-medium uppercase", sel ? "opacity-80" : "text-muted-foreground")}>
                {format(d, "EEEEE")}
                <span className="hidden sm:inline">{format(d, "EEE").slice(1)}</span>
              </span>
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-base leading-none font-semibold",
                  today && !sel && "text-primary ring-1 ring-primary",
                )}
              >
                {format(d, "d")}
              </span>
              <span className="flex h-1.5 gap-0.5">
                {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                  <span key={i} className={cn("size-1.5 rounded-full", sel ? "bg-primary-foreground" : "bg-primary")} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
