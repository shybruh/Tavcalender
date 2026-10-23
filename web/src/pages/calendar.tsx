import { useMemo, useState } from "react"
import { Link } from "react-router"
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { ChevronLeftIcon, ChevronRightIcon, EyeOffIcon, ListIcon, NotebookPenIcon, PlusIcon } from "lucide-react"
import { useBusy, useCalendars, useConnections, useEvents, useMyGroups, useNotes, useUserMap } from "@/hooks/queries"
import { useAuth } from "@/hooks/use-auth"
import { useHiddenCalendars, useHiddenPeople } from "@/hooks/use-prefs"
import { eventOnDay, eventRange, floatingDate, parsePb } from "@/lib/dates"
import { displayName, type BusyBlock, type CalEvent, type Calendar, type User } from "@/lib/pb"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EventFormDialog } from "@/components/event-form"
import { NoteFormDialog } from "@/components/note-form"
import { EventCard } from "@/components/event-card"
import { UserAvatar } from "@/components/user-avatar"
import { CalendarDot } from "@/components/calendar-dot"

const WEEK = { weekStartsOn: 1 as const }

/** Everything you're allowed to see (yours, friends', groups') plus friends' busy blocks. */
export function CalendarPage() {
  const { user } = useAuth()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(() => new Date())
  const [creating, setCreating] = useState(false)
  const [creatingNote, setCreatingNote] = useState(false)

  const gridStart = startOfWeek(startOfMonth(month), WEEK)
  const gridEnd = endOfWeek(endOfMonth(month), WEEK)
  const days = useMemo(() => {
    const out: Date[] = []
    const last = endOfWeek(endOfMonth(month), WEEK)
    for (let d = startOfWeek(startOfMonth(month), WEEK); d <= last; d = addDays(d, 1)) out.push(d)
    return out
  }, [month])

  const users = useUserMap()
  const { data: calendars } = useCalendars()
  const myGroups = useMyGroups()
  const { data: rawEvents, isLoading } = useEvents(gridStart, gridEnd)
  const { data: rawBusy } = useBusy(gridStart, gridEnd)
  const { data: rawNotes } = useNotes()
  const { hidden: hiddenGroups } = useHiddenCalendars()
  const { hidden: hiddenPeople } = useHiddenPeople()

  const calMap = useMemo(() => new Map((calendars ?? []).map((c) => [c.id, c])), [calendars])
  const colorOf = (ev: CalEvent) => users.get(ev.created_by)?.color

  // a group post is hidden when every group it's in is toggled off (your own posts always show)
  const visible = (ev: CalEvent) => {
    if (hiddenPeople.has(ev.created_by)) return false
    if (ev.audience === "groups" && ev.created_by !== user?.id && ev.groups.length && ev.groups.every((g) => hiddenGroups.has(g))) return false
    return true
  }

  const events = useMemo(() => (rawEvents ?? []).filter(visible), [rawEvents, hiddenGroups, hiddenPeople, user]) // eslint-disable-line react-hooks/exhaustive-deps
  const busy = useMemo(() => (rawBusy ?? []).filter((b) => !hiddenPeople.has(b.user)), [rawBusy, hiddenPeople])
  const datedNotes = useMemo(() => (rawNotes ?? []).filter((n) => n.date && !hiddenGroups.has(n.calendar)), [rawNotes, hiddenGroups])

  const dayEvents = (day: Date) =>
    events.filter((e) => eventOnDay(e, day)).sort((a, b) => Number(b.all_day) - Number(a.all_day) || eventRange(a).start.getTime() - eventRange(b).start.getTime())
  const dayBusy = (day: Date) => busy.filter((b) => busyOnDay(b, day))
  const dayNotes = (day: Date) => datedNotes.filter((n) => isSameDay(floatingDate(n.date)!, day))

  function go(delta: number) {
    const m = addMonths(month, delta)
    setMonth(m)
    setSelected(isSameMonth(new Date(), m) ? new Date() : m)
  }

  const selectedEvents = dayEvents(selected)
  const selectedBusy = dayBusy(selected)
  const selectedNotes = dayNotes(selected)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-3 md:p-6 lg:flex-row">
      <section className="min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {format(month, "MMMM")} <span className="text-muted-foreground">{format(month, "yyyy")}</span>
          </h1>
          <div className="flex-1" />
          <Link to="/agenda" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="List view" title="List view">
            <ListIcon />
          </Link>
          <Button variant="outline" size="sm" onClick={() => { setMonth(startOfMonth(new Date())); setSelected(new Date()) }}>
            Today
          </Button>
          <Button variant="ghost" size="icon" onClick={() => go(-1)} aria-label="Previous month"><ChevronLeftIcon /></Button>
          <Button variant="ghost" size="icon" onClick={() => go(1)} aria-label="Next month"><ChevronRightIcon /></Button>
          <Button className="hidden md:inline-flex" onClick={() => setCreating(true)}>
            <PlusIcon /> New event
          </Button>
        </div>

        <Filters me={user} groups={myGroups} />

        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
            {days.slice(0, 7).map((d) => (
              <div key={d.toISOString()} className="py-2">
                <span className="md:hidden">{format(d, "EEEEE")}</span>
                <span className="hidden md:inline">{format(d, "EEE")}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const evs = dayEvents(day)
              const bs = dayBusy(day)
              const notes = dayNotes(day)
              const isSel = isSameDay(day, selected)
              const outside = !isSameMonth(day, month)
              return (
                <div
                  key={day.toISOString()}
                  role="button"
                  tabIndex={0}
                  aria-label={format(day, "EEEE d MMMM")}
                  aria-pressed={isSel}
                  onClick={() => setSelected(day)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setSelected(day))}
                  onDoubleClick={() => setCreating(true)}
                  className={cn(
                    "group relative flex min-h-14 cursor-pointer flex-col items-stretch gap-0.5 border-b p-1 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:min-h-28 md:p-1.5",
                    (i + 1) % 7 !== 0 && "border-r",
                    i >= days.length - 7 && "border-b-0",
                    outside && "bg-muted/30 text-muted-foreground",
                    isSel && "bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "mx-auto flex size-7 items-center justify-center rounded-full text-sm md:mx-0",
                      isToday(day) && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {format(day, "d")}
                  </span>

                  {/* phone: dots (hollow = busy) */}
                  <div className="flex flex-wrap justify-center gap-0.5 md:hidden">
                    {evs.slice(0, 4).map((e) => (
                      <span key={e.id} className="size-1.5 rounded-full" style={{ backgroundColor: colorOf(e) || "var(--primary)" }} />
                    ))}
                    {bs.slice(0, 3).map((b) => (
                      <span key={b.id} className="size-1.5 rounded-full border" style={{ borderColor: users.get(b.user)?.color || "currentColor" }} />
                    ))}
                    {notes.length > 0 && <span className="size-1.5 rounded-full border border-muted-foreground" />}
                  </div>

                  {/* desktop: chips */}
                  <div className="hidden flex-col gap-0.5 md:flex">
                    {evs.slice(0, 3).map((e) => (
                      <EventChip key={e.id} event={e} color={colorOf(e)} />
                    ))}
                    {evs.length > 3 && <span className="px-1 text-xs text-muted-foreground">+{evs.length - 3} more</span>}
                    {bs.length > 0 && (
                      <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                        <EyeOffIcon className="size-3" />
                        {new Set(bs.map((b) => b.user)).size === 1 ? `${displayName(users.get(bs[0].user))} busy` : `${new Set(bs.map((b) => b.user)).size} busy`}
                      </span>
                    )}
                    {notes.length > 0 && (
                      <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                        <NotebookPenIcon className="size-3" /> {notes.length} note{notes.length > 1 && "s"}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {isLoading && <Skeleton className="mt-2 h-1 w-full" />}
      </section>

      <aside className="lg:w-80 lg:shrink-0">
        <div className="mb-2 flex items-center gap-2 lg:mt-1">
          <h2 className="font-semibold">{isToday(selected) ? "Today" : format(selected, "EEEE")}</h2>
          <span className="text-sm text-muted-foreground">{format(selected, "d MMMM")}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setCreatingNote(true)}><NotebookPenIcon /> Note</Button>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}><PlusIcon /> Event</Button>
        </div>
        <div className="flex flex-col gap-2">
          {selectedEvents.length === 0 && selectedBusy.length === 0 && selectedNotes.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing on. Everyone's free!</p>
          )}
          {selectedEvents.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              color={colorOf(e)}
              showAudience={e.created_by === user?.id}
              label={<EventSource event={e} me={user} users={users} calMap={calMap} />}
            />
          ))}
          {selectedBusy.length > 0 && (
            <div className="rounded-xl border border-dashed p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><EyeOffIcon className="size-3.5" /> Busy</div>
              <div className="flex flex-col gap-1.5">
                {selectedBusy.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 text-sm">
                    <UserAvatar user={users.get(b.user)} size="sm" />
                    <span className="flex-1">{displayName(users.get(b.user))}</span>
                    <span className="text-muted-foreground">{busyTime(b)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {selectedNotes.map((n) => {
            const cal = calMap.get(n.calendar)
            return (
              <Link key={n.id} to={`/notes?open=${n.id}`} className="rounded-xl border bg-card p-3 transition-colors hover:bg-accent/50">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <NotebookPenIcon className="size-4 text-muted-foreground" /> {n.title}
                </div>
                {n.content && <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">{n.content}</p>}
                <div className="mt-1 text-xs text-muted-foreground">{cal?.personal ? "Private note" : cal?.name}</div>
              </Link>
            )
          })}
        </div>
      </aside>

      <Button
        size="icon-lg"
        className="fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 size-14 rounded-full shadow-lg md:hidden"
        onClick={() => setCreating(true)}
        aria-label="New event"
      >
        <PlusIcon className="size-6" />
      </Button>

      <EventFormDialog open={creating} onOpenChange={setCreating} defaultDate={selected} />
      <NoteFormDialog open={creatingNote} onOpenChange={setCreatingNote} defaultDate={selected} />
    </div>
  )
}

/** "You · Family", "Sam · in Uni friends", "With Alice"… */
export function EventSource({ event, me, users, calMap }: {
  event: CalEvent
  me: User | null
  users: Map<string, User>
  calMap: Map<string, Calendar>
}) {
  const author = users.get(event.created_by)
  const mine = event.created_by === me?.id
  const groupNames = event.groups.map((g) => calMap.get(g)?.name).filter(Boolean)
  return (
    <span className="flex items-center gap-1">
      <span className="size-2 rounded-full" style={{ backgroundColor: author?.color }} />
      {mine ? "You" : displayName(author)}
      {groupNames.length > 0 && <span>· in {groupNames.join(", ")}</span>}
      {!mine && event.guests?.includes(me?.id ?? "") && <span>· invited you</span>}
    </span>
  )
}

function busyOnDay(b: BusyBlock, day: Date) {
  return eventOnDay({ start: b.start, end: b.end, all_day: b.all_day } as CalEvent, day)
}

function busyTime(b: BusyBlock) {
  if (b.all_day) return "All day"
  const s = parsePb(b.start)
  const e = parsePb(b.end)
  return s ? `${format(s, "HH:mm")}${e ? `–${format(e, "HH:mm")}` : ""}` : ""
}

/** Tap people / groups to hide or show them on this device. */
function Filters({ me, groups }: { me: User | null; groups: Calendar[] }) {
  const users = useUserMap()
  const { friends } = useConnections()
  const { hidden: hiddenPeople, toggle: togglePerson } = useHiddenPeople()
  const { hidden: hiddenGroups, toggle: toggleGroup } = useHiddenCalendars()
  const people = [me, ...[...friends.keys()].map((id) => users.get(id))]
    .filter((u): u is User => !!u)
    .sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : displayName(a).localeCompare(displayName(b))))
  if (people.length < 2 && !groups.length) return null

  const chip = "flex shrink-0 items-center gap-1.5 rounded-full border py-0.5 pr-2.5 text-sm transition"
  return (
    <div className="scrollbar-none -mx-3 mb-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
      {people.map((p) => {
        const off = hiddenPeople.has(p.id)
        return (
          <button key={p.id} onClick={() => togglePerson(p.id)} aria-pressed={!off} className={cn(chip, "pl-0.5", off && "opacity-40 grayscale")} style={{ borderColor: off ? undefined : p.color }}>
            <UserAvatar user={p} size="sm" />
            {p.id === me?.id ? "You" : displayName(p)}
          </button>
        )
      })}
      {groups.map((g) => {
        const off = hiddenGroups.has(g.id)
        return (
          <button key={g.id} onClick={() => toggleGroup(g.id)} aria-pressed={!off} className={cn(chip, "pl-2", off && "opacity-40 grayscale")} style={{ borderColor: off ? undefined : g.color }}>
            <CalendarDot color={g.color} /> {g.name}
          </button>
        )
      })}
    </div>
  )
}

function EventChip({ event, color: c }: { event: CalEvent; color?: string }) {
  const color = c || "var(--primary)"
  return (
    <Link
      to={`/event/${event.id}`}
      onClick={(e) => e.stopPropagation()}
      className="truncate rounded px-1 py-px text-xs hover:opacity-80"
      style={event.all_day ? { backgroundColor: color, color: "white" } : { borderLeft: `3px solid ${color}` }}
    >
      {!event.all_day && <span className="text-muted-foreground">{format(eventRange(event).start, "HH:mm")} </span>}
      {event.title}
    </Link>
  )
}
