import { useMemo } from "react"
import { format, isToday, isTomorrow, startOfDay } from "date-fns"
import { ListIcon } from "lucide-react"
import { useCalendars, useUpcomingEvents, useUserMap } from "@/hooks/queries"
import { useHiddenPeople } from "@/hooks/use-prefs"
import { EventSource } from "./calendar"
import { useHiddenCalendars } from "@/hooks/use-prefs"
import { eventRange } from "@/lib/dates"
import type { CalEvent } from "@/lib/pb"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import { EventCard } from "@/components/event-card"
import { useAuth } from "@/hooks/use-auth"

export function AgendaPage() {
  const { data: events, isLoading } = useUpcomingEvents(200)
  const { data: calendars } = useCalendars()
  const { hidden } = useHiddenCalendars()
  const { user } = useAuth()
  const users = useUserMap()
  const { hidden: hiddenPeople } = useHiddenPeople()
  const calMap = useMemo(() => new Map((calendars ?? []).map((c) => [c.id, c])), [calendars])

  // group by the day each event starts (events already running show under today)
  const groups = useMemo(() => {
    const today = startOfDay(new Date())
    const map = new Map<number, CalEvent[]>()
    for (const ev of events ?? []) {
      if (hiddenPeople.has(ev.created_by)) continue
      if (ev.audience === "groups" && ev.created_by !== user?.id && ev.groups.length && ev.groups.every((g) => hidden.has(g))) continue
      const { start, end } = eventRange(ev)
      if (end < new Date()) continue
      const key = Math.max(startOfDay(start).getTime(), today.getTime())
      map.set(key, [...(map.get(key) ?? []), ev])
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [events, hidden, hiddenPeople, user])

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight md:text-2xl">Coming up</h1>
      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : groups.length === 0 ? (
        <EmptyState icon={<ListIcon className="size-6" />} title="Nothing coming up" description="Time to plan something!" />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([key, evs]) => {
            const day = new Date(key)
            const label = isToday(day) ? "Today" : isTomorrow(day) ? "Tomorrow" : format(day, "EEEE")
            return (
              <section key={key}>
                <h2 className="sticky top-14 z-10 -mx-3 mb-2 bg-background/90 px-3 py-1 backdrop-blur md:-mx-6 md:px-6">
                  <span className="font-semibold">{label}</span>{" "}
                  <span className="text-sm text-muted-foreground">{format(day, "d MMMM")}</span>
                </h2>
                <div className="flex flex-col gap-2">
                  {evs.map((ev) => <EventCard key={ev.id} event={ev} color={users.get(ev.created_by)?.color} showAudience={ev.created_by === user?.id} label={<EventSource event={ev} me={user} users={users} calMap={calMap} />} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
