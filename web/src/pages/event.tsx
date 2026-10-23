import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { format, formatDistanceToNow } from "date-fns"
import {
  AlarmClockIcon,
  ArrowLeftIcon,
  CalendarPlusIcon,
  CheckIcon,
  HelpCircleIcon,
  MailIcon,
  MapPinIcon,
  PencilIcon,
  Trash2Icon,
  UserPlusIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { pb, displayName, errorMessage, type CalEvent, type RsvpStatus } from "@/lib/pb"
import { eventRange, formatEventTime, parsePb } from "@/lib/dates"
import { downloadIcs } from "@/lib/ics"
import { useAuth } from "@/hooks/use-auth"
import { groupAction, inviteToEvent, useEvent, useReminders, useRsvps, useUserMap } from "@/hooks/queries"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { EventFormDialog, REMINDER_OPTIONS } from "@/components/event-form"
import { CalendarDot } from "@/components/calendar-dot"
import { UserAvatar } from "@/components/user-avatar"
import { ConfirmButton } from "@/components/confirm-button"
import { SimpleSelect } from "@/components/simple-select"
import { EmptyState } from "@/components/empty-state"
import { AudienceBadge } from "@/components/event-card"
import { FriendPicker } from "@/components/friend-picker"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { Input } from "@/components/ui/input"

const RSVP: { value: RsvpStatus; label: string; icon: typeof CheckIcon }[] = [
  { value: "going", label: "Going", icon: CheckIcon },
  { value: "maybe", label: "Maybe", icon: HelpCircleIcon },
  { value: "no", label: "Can't go", icon: XIcon },
]

export function EventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: event, isLoading, error } = useEvent(id)
  const { data: rsvps } = useRsvps(id)
  const { data: reminders } = useReminders()
  const [editing, setEditing] = useState(false)
  const [inviting, setInviting] = useState(false)
  const users = useUserMap()

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4 md:p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (error || !event) {
    return <EmptyState title="Event not found" description="It may have been deleted, or you don't have access to it." />
  }

  // only the person who posted it can change it; group owners can take it off their group
  const author = users.get(event.created_by) ?? event.expand?.created_by
  const isAuthor = event.created_by === user?.id
  const canEdit = isAuthor
  const canInvite = isAuthor
  const groups = event.expand?.groups ?? []
  const ownedGroups = isAuthor ? [] : groups.filter((g) => g.owner === user?.id)
  const mine = rsvps?.find((r) => r.user === user?.id)
  const myReminders = (reminders ?? []).filter((r) => r.event === event.id)
  const { start } = eventRange(event)
  const past = start < new Date()

  async function setRsvp(status: RsvpStatus) {
    try {
      // tapping your current answer again clears it (but an invite can only be re-answered)
      if (mine?.status === status && !mine.invited_by) await pb.collection("rsvps").delete(mine.id)
      else if (mine) await pb.collection("rsvps").update(mine.id, { status })
      else await pb.collection("rsvps").create({ event: event!.id, user: user!.id, status })
      qc.invalidateQueries({ queryKey: ["rsvps"] })
      qc.invalidateQueries({ queryKey: ["events"] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function addReminder(offset: string) {
    if (offset === "0") return
    try {
      await pb.collection("reminders").create({
        user: user!.id,
        event: event!.id,
        title: event!.title,
        offset_minutes: Number(offset),
        remind_at: event!.start,
      })
      qc.invalidateQueries({ queryKey: ["reminders"] })
      toast.success("Reminder set")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function removeReminder(rid: string) {
    await pb.collection("reminders").delete(rid)
    qc.invalidateQueries({ queryKey: ["reminders"] })
  }

  async function remove() {
    try {
      await pb.collection("events").delete(event!.id)
      qc.invalidateQueries({ queryKey: ["events"] })
      toast.success("Event deleted")
      navigate("/")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const created = parsePb(event.created)

  async function removeFromGroup(groupId: string, name: string) {
    try {
      await groupAction(`groups/${groupId}/remove-post`, { event: event!.id })
      qc.invalidateQueries({ queryKey: ["events"] })
      toast.success(`Removed from ${name}`)
      navigate(`/groups/${groupId}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => (history.length > 1 ? navigate(-1) : navigate("/"))}>
        <ArrowLeftIcon /> Back
      </Button>

      <div className="rounded-2xl border bg-card p-4 md:p-6">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <CalendarDot color={author?.color} />
          {isAuthor ? "Your plan" : `${displayName(author)}'s plan`}
          {isAuthor && <AudienceBadge audience={event.audience} />}
          {groups.map((g) => (
            <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-accent">
              <CalendarDot color={g.color} className="size-2" /> {g.name}
            </Link>
          ))}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <p className={cn("mt-1 font-medium", past ? "text-muted-foreground" : "text-primary")}>
          {formatEventTime(event, { withDate: true })}
        </p>
        {!past && <p className="text-sm text-muted-foreground">{formatDistanceToNow(start, { addSuffix: true })}</p>}

        {event.location && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
          >
            <MapPinIcon className="size-4 text-muted-foreground" /> {event.location}
          </a>
        )}

        {event.description && <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap">{event.description}</p>}

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <UserAvatar user={event.expand?.created_by} size="sm" />
          Added by {displayName(event.expand?.created_by)}
          {created && ` · ${format(created, "d MMM")}`}
        </div>

        <Separator className="my-5" />

        {mine?.status === "invited" && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <MailIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <b>{displayName(users.get(mine.invited_by))}</b> invited you.
              {mine.message && <span className="italic"> “{mine.message}”</span>}
            </div>
          </div>
        )}

        {/* RSVP */}
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 text-sm font-medium">Are you in?</h2>
          {canInvite && (
            <Button variant="outline" size="sm" onClick={() => setInviting(true)}><UserPlusIcon /> Invite friends</Button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {RSVP.map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={mine?.status === value ? "default" : "outline"}
              className="h-10"
              onClick={() => setRsvp(value)}
            >
              <Icon /> {label}
            </Button>
          ))}
        </div>
        <RsvpList rsvps={rsvps ?? []} />

        <Separator className="my-5" />

        {/* reminders */}
        <h2 className="mb-2 flex items-center gap-2 text-sm font-medium"><AlarmClockIcon className="size-4" /> My reminders</h2>
        <div className="flex flex-col gap-2">
          {myReminders.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <span className={cn("flex-1", r.sent && "text-muted-foreground line-through")}>
                {REMINDER_OPTIONS.find((o) => Number(o.value) === r.offset_minutes)?.label ??
                  format(parsePb(r.remind_at)!, "EEE d MMM HH:mm")}
              </span>
              <Button variant="ghost" size="icon-sm" onClick={() => removeReminder(r.id)} aria-label="Remove reminder"><XIcon /></Button>
            </div>
          ))}
          <SimpleSelect
            value="0"
            onChange={addReminder}
            options={[{ value: "0", label: "Add a reminder…" }, ...REMINDER_OPTIONS.slice(1)]}
          />
        </div>

        <Separator className="my-5" />

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="h-10 sm:h-8" onClick={() => downloadIcs(event as CalEvent)}>
            <CalendarPlusIcon /> Add to my calendar
          </Button>
          <div className="hidden flex-1 sm:block" />
          {ownedGroups.map((g) => (
            <ConfirmButton
              key={g.id}
              variant="outline"
              className="h-10 sm:h-8"
              title={`Remove from “${g.name}”?`}
              description={`It stays on ${displayName(author)}'s own calendar; the group just won't see it any more. They'll be told.`}
              confirmLabel="Remove"
              onConfirm={() => removeFromGroup(g.id, g.name)}
            >
              <Trash2Icon /> Remove from {g.name}
            </ConfirmButton>
          ))}
          {canEdit && (
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <ConfirmButton variant="outline" className="h-10 sm:h-8" title="Delete this event?" description="Everyone will lose it, including RSVPs and reminders." confirmLabel="Delete" onConfirm={remove}>
                <Trash2Icon /> Delete
              </ConfirmButton>
              <Button className="h-10 sm:h-8" onClick={() => setEditing(true)}><PencilIcon /> Edit</Button>
            </div>
          )}
        </div>
      </div>

      <ResponsiveDialog open={inviting} onOpenChange={setInviting} title="Invite friends" description="They'll get a notification and can accept or decline.">
        {inviting && <InviteForm event={event} onDone={() => setInviting(false)} />}
      </ResponsiveDialog>
      <EventFormDialog open={editing} onOpenChange={setEditing} event={event} onSaved={() => qc.invalidateQueries({ queryKey: ["events", "one", id] })} />
    </div>
  )
}

function RsvpList({ rsvps }: { rsvps: NonNullable<ReturnType<typeof useRsvps>["data"]> }) {
  if (!rsvps.length) return <p className="mt-3 text-sm text-muted-foreground">No replies yet. Be the first!</p>
  return (
    <div className="mt-4 flex flex-col gap-3">
      {[...RSVP, { value: "invited" as const, label: "Not answered yet" }].map(({ value, label }) => {
        const list = rsvps.filter((r) => r.status === value)
        if (!list.length) return null
        return (
          <div key={value}>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label} · {list.length}</div>
            <div className="flex flex-wrap gap-2">
              {list.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-sm">
                  <UserAvatar user={r.expand?.user} size="sm" />
                  {displayName(r.expand?.user)}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InviteForm({ event, onDone }: { event: CalEvent; onDone: () => void }) {
  const qc = useQueryClient()
  const [ids, setIds] = useState<string[]>([])
  const [askFree, setAskFree] = useState<string[]>([])
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const { start, end } = eventRange(event)

  async function send() {
    setBusy(true)
    try {
      const res = await inviteToEvent(event.id, ids, message.trim(), askFree)
      qc.invalidateQueries({ queryKey: ["rsvps"] })
      qc.invalidateQueries({ queryKey: ["events"] })
      toast.success(`Invited ${res.invited} ${res.invited === 1 ? "friend" : "friends"}`)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FriendPicker
        value={ids}
        onChange={setIds}
        askFree={askFree}
        onAskFreeChange={setAskFree}
        start={start}
        end={end}
        exclude={event.guests ?? []}
        ignoreEventId={event.id}
      />
      <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add a message (optional)" maxLength={500} />
      <div className="flex gap-2">
        <Button variant="outline" className="h-10 flex-1" onClick={onDone}>Cancel</Button>
        <Button className="h-10 flex-1" disabled={!ids.length || busy} onClick={send}>
          Send {ids.length > 0 && `(${ids.length})`}
        </Button>
      </div>
    </div>
  )
}
