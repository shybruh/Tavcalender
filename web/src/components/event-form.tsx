import { useState, type FormEvent } from "react"
import { addHours, addMinutes, differenceInMinutes, startOfHour } from "date-fns"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronDownIcon } from "lucide-react"
import { pb, errorMessage, type Audience, type CalEvent } from "@/lib/pb"
import { AUDIENCES } from "@/lib/audience"
import { dateInput, eventRange, fromInputs, timeInput, toPb, toPbDate } from "@/lib/dates"
import { useAuth } from "@/hooks/use-auth"
import { inviteToEvent, useMyCalendar, useMyGroups } from "@/hooks/queries"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { SimpleSelect } from "@/components/simple-select"
import { CalendarDot } from "@/components/calendar-dot"
import { FriendPicker } from "@/components/friend-picker"

export const REMINDER_OPTIONS = [
  { value: "0", label: "No reminder" },
  { value: "10", label: "10 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "180", label: "3 hours before" },
  { value: "1440", label: "1 day before" },
  { value: "10080", label: "1 week before" },
]

// new events start with whatever audience you picked last time (per device)
const LAST_AUDIENCE = "tav:last-audience"
function lastAudience(): Audience {
  try {
    const v = localStorage.getItem(LAST_AUDIENCE) as Audience | null
    return v && AUDIENCES.some((a) => a.value === v) && v !== "groups" ? v : "private"
  } catch {
    return "private"
  }
}

/** Create (no `event`) or edit an event. `defaultDate` pre-fills the day; `defaultGroup` posts to a group. */
export function EventFormDialog({ open, onOpenChange, event, defaultDate, defaultGroup, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  event?: CalEvent
  defaultDate?: Date
  defaultGroup?: string
  onSaved?: (ev: CalEvent) => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={event ? "Edit event" : "New event"}>
      {/* remount on open so fields reset */}
      {open && (
        <EventForm
          event={event}
          defaultDate={defaultDate}
          defaultGroup={defaultGroup}
          onDone={(ev) => {
            onOpenChange(false)
            if (ev) onSaved?.(ev)
          }}
        />
      )}
    </ResponsiveDialog>
  )
}

function EventForm({ event, defaultDate, defaultGroup, onDone }: {
  event?: CalEvent
  defaultDate?: Date
  defaultGroup?: string
  onDone: (ev?: CalEvent) => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const myCalendar = useMyCalendar()
  const myGroups = useMyGroups()

  const initial = (() => {
    if (event) return eventRange(event)
    const base = defaultDate ?? new Date()
    const now = new Date()
    // default to the next full hour on the chosen day
    const start = startOfHour(addHours(new Date(base.getFullYear(), base.getMonth(), base.getDate(), now.getHours(), 0), 1))
    return { start, end: addHours(start, 1) }
  })()

  const [title, setTitle] = useState(event?.title ?? "")
  const [audience, setAudience] = useState<Audience>(event?.audience ?? (defaultGroup ? "groups" : lastAudience()))
  const [groups, setGroups] = useState<string[]>(event?.groups ?? (defaultGroup ? [defaultGroup] : []))
  const [allDay, setAllDay] = useState(event?.all_day ?? false)
  const [startDate, setStartDate] = useState(dateInput(initial.start))
  const [startTime, setStartTime] = useState(timeInput(initial.start))
  const [endDate, setEndDate] = useState(dateInput(initial.end))
  const [endTime, setEndTime] = useState(timeInput(initial.end))
  const [location, setLocation] = useState(event?.location ?? "")
  const [description, setDescription] = useState(event?.description ?? "")
  const [remind, setRemind] = useState("0")
  const [invitees, setInvitees] = useState<string[]>([])
  const [askFree, setAskFree] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const range = allDay
    ? { start: fromInputs(startDate), end: fromInputs(endDate < startDate ? startDate : endDate, "23:59") }
    : { start: fromInputs(startDate, startTime), end: fromInputs(endDate, endTime) }

  // keep the duration when the start moves
  function changeStart(date: string, time: string) {
    const oldStart = fromInputs(startDate, startTime)
    const oldEnd = fromInputs(endDate, endTime)
    const duration = Math.max(0, differenceInMinutes(oldEnd, oldStart))
    const newEnd = addMinutes(fromInputs(date, time), duration)
    setStartDate(date)
    setStartTime(time)
    setEndDate(dateInput(newEnd))
    setEndTime(timeInput(newEnd))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!myCalendar) return toast.error("Your calendar is still being set up")
    if (audience === "groups" && !groups.length) return toast.error("Pick at least one group")
    let start: string, end: string
    if (allDay) {
      const s = fromInputs(startDate)
      const en = fromInputs(endDate < startDate ? startDate : endDate)
      start = toPbDate(s)
      end = toPbDate(en)
    } else {
      const s = fromInputs(startDate, startTime)
      let en = fromInputs(endDate, endTime)
      if (en < s) en = addHours(s, 1)
      start = toPb(s)
      end = toPb(en)
    }

    const data = {
      title: title.trim(), all_day: allDay, start, end, location: location.trim(), description: description.trim(),
      audience, groups: audience === "groups" ? groups : [],
    }
    try { localStorage.setItem(LAST_AUDIENCE, audience) } catch { /* ignore */ }
    setBusy(true)
    try {
      let saved: CalEvent
      if (event) {
        saved = await pb.collection("events").update<CalEvent>(event.id, data)
      } else {
        saved = await pb.collection("events").create<CalEvent>({ ...data, calendar: myCalendar.id, created_by: user!.id })
        const offset = Number(remind)
        if (offset > 0) {
          await pb.collection("reminders").create({
            user: user!.id,
            event: saved.id,
            title: saved.title,
            offset_minutes: offset,
            remind_at: start, // replaced server-side with start - offset
          })
        }
      }
      if (invitees.length) await inviteToEvent(saved.id, invitees, message.trim(), askFree)
      qc.invalidateQueries({ queryKey: ["events"] })
      qc.invalidateQueries({ queryKey: ["reminders"] })
      qc.invalidateQueries({ queryKey: ["rsvps"] })
      toast.success(
        invitees.length
          ? `${event ? "Saved" : "Added"} and invited ${invitees.length} ${invitees.length === 1 ? "friend" : "friends"}`
          : event ? "Event updated" : "Event added",
      )
      onDone(saved)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const audienceHint = AUDIENCES.find((a) => a.value === audience)?.hint

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="ev-title">Title</FieldLabel>
          <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Board games at Sam's" required autoFocus maxLength={200} />
        </Field>

        <Field>
          <FieldLabel htmlFor="ev-audience">Who can see it</FieldLabel>
          <SimpleSelect
            id="ev-audience"
            value={audience}
            onChange={(v) => setAudience(v as Audience)}
            options={AUDIENCES.map((a) => ({
              value: a.value,
              label: <span className="flex items-center gap-2"><a.icon className="size-4 text-muted-foreground" />{a.label}</span>,
            }))}
          />
          {audience === "groups" ? (
            <GroupPicker value={groups} onChange={setGroups} groups={myGroups} />
          ) : (
            <FieldDescription>
              {audienceHint}. {audience === "private" ? "Friends only see that you're busy." : "Other friends only see that you're busy."}
            </FieldDescription>
          )}
        </Field>

        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="ev-allday">All day</FieldLabel>
          <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
        </Field>

        <Field>
          <FieldLabel htmlFor="ev-start">Starts</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <Input id="ev-start" type="date" value={startDate} onChange={(e) => changeStart(e.target.value, startTime)} className={allDay ? "col-span-2" : ""} required />
            {!allDay && (
              <Input type="time" aria-label="Start time" value={startTime} onChange={(e) => changeStart(startDate, e.target.value)} required />
            )}
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="ev-end">Ends</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <Input id="ev-end" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={allDay ? "col-span-2" : ""} required />
            {!allDay && (
              <Input type="time" aria-label="End time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            )}
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="ev-location">Location</FieldLabel>
          <Input id="ev-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Optional" maxLength={300} />
        </Field>

        <Field>
          <FieldLabel htmlFor="ev-desc">Details</FieldLabel>
          <Textarea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What to bring, who's driving…" rows={3} maxLength={5000} />
        </Field>

        <Field>
          <FieldLabel>Invite friends</FieldLabel>
          <FriendPicker
            value={invitees}
            onChange={setInvitees}
            askFree={askFree}
            onAskFreeChange={setAskFree}
            start={range.start}
            end={range.end}
            exclude={event?.guests ?? []}
            ignoreEventId={event?.id}
          />
          {invitees.length > 0 && (
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a message (optional)" maxLength={500} />
          )}
        </Field>

        {!event && (
          <Field>
            <FieldLabel htmlFor="ev-remind">Remind me</FieldLabel>
            <SimpleSelect id="ev-remind" value={remind} onChange={setRemind} options={REMINDER_OPTIONS} />
          </Field>
        )}

        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => onDone()}>Cancel</Button>
          <Button type="submit" className="h-10 flex-1" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}

/** Dropdown with "Select all" + one checkbox per group you're in. */
function GroupPicker({ value, onChange, groups }: {
  value: string[]
  onChange: (ids: string[]) => void
  groups: { id: string; name: string; color: string }[]
}) {
  if (!groups.length) {
    return <FieldDescription>You're not in any groups yet. Create or join one on the People page.</FieldDescription>
  }
  const all = groups.every((g) => value.includes(g.id))
  const names = groups.filter((g) => value.includes(g.id)).map((g) => g.name)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" className="h-9 w-full justify-between font-normal">
            <span className="truncate">{all && groups.length > 1 ? "All groups" : names.length ? names.join(", ") : "Pick groups…"}</span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent className="w-(--anchor-width) min-w-56">
        {groups.length > 1 && (
          <>
            <DropdownMenuCheckboxItem checked={all} onCheckedChange={(on) => onChange(on ? groups.map((g) => g.id) : [])}>
              Select all
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
          </>
        )}
        {groups.map((g) => (
          <DropdownMenuCheckboxItem
            key={g.id}
            checked={value.includes(g.id)}
            onCheckedChange={(on) => onChange(on ? [...value, g.id] : value.filter((id) => id !== g.id))}
          >
            <CalendarDot color={g.color} /> {g.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
