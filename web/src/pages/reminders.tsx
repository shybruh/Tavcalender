import { useState, type FormEvent } from "react"
import { Link } from "react-router"
import { addHours, format, formatDistanceToNow, startOfHour } from "date-fns"
import { AlarmClockIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { pb, errorMessage, type Reminder } from "@/lib/pb"
import { dateInput, fromInputs, parsePb, timeInput, toPb } from "@/lib/dates"
import { useAuth } from "@/hooks/use-auth"
import { useReminders } from "@/hooks/queries"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { EmptyState } from "@/components/empty-state"
import { PushPrompt } from "@/components/push-prompt"

export function RemindersPage() {
  const { data: reminders, isLoading } = useReminders()
  const [creating, setCreating] = useState(false)
  const upcoming = (reminders ?? []).filter((r) => !r.sent)
  const done = (reminders ?? []).filter((r) => r.sent).reverse().slice(0, 20)

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Reminders</h1>
        <div className="flex-1" />
        <Button onClick={() => setCreating(true)}><PlusIcon /> New</Button>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Reminders are private. You'll get a notification when they're due.</p>
      <PushPrompt className="mb-4" />

      {isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : upcoming.length === 0 && done.length === 0 ? (
        <EmptyState icon={<AlarmClockIcon className="size-6" />} title="No reminders" description="Add one here, or from any event." />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {upcoming.map((r) => <ReminderRow key={r.id} reminder={r} />)}
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Nothing upcoming.</p>}
          </div>
          {done.length > 0 && (
            <>
              <h2 className="mt-8 mb-2 text-sm font-medium text-muted-foreground">Done</h2>
              <div className="flex flex-col gap-2 opacity-70">
                {done.map((r) => <ReminderRow key={r.id} reminder={r} />)}
              </div>
            </>
          )}
        </>
      )}

      <ResponsiveDialog open={creating} onOpenChange={setCreating} title="New reminder">
        {creating && <ReminderForm onDone={() => setCreating(false)} />}
      </ResponsiveDialog>
    </div>
  )
}

function ReminderRow({ reminder: r }: { reminder: Reminder }) {
  const qc = useQueryClient()
  const at = parsePb(r.remind_at)!
  async function remove() {
    await pb.collection("reminders").delete(r.id)
    qc.invalidateQueries({ queryKey: ["reminders"] })
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", r.sent ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
        <AlarmClockIcon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium", r.sent && "line-through")}>{r.title}</div>
        <div className="text-sm text-muted-foreground">
          {format(at, "EEE d MMM, HH:mm")}
          {!r.sent && ` · ${formatDistanceToNow(at, { addSuffix: true })}`}
        </div>
        {r.event && (
          <Link to={`/event/${r.event}`} className="text-xs text-primary underline-offset-4 hover:underline">
            Open event
          </Link>
        )}
      </div>
      <Button variant="ghost" size="icon" onClick={remove} aria-label="Delete reminder"><Trash2Icon /></Button>
    </div>
  )
}

function ReminderForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const initial = startOfHour(addHours(new Date(), 1))
  const [title, setTitle] = useState("")
  const [date, setDate] = useState(dateInput(initial))
  const [time, setTime] = useState(timeInput(initial))
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await pb.collection("reminders").create({
        user: user!.id,
        title: title.trim(),
        remind_at: toPb(fromInputs(date, time)),
      })
      qc.invalidateQueries({ queryKey: ["reminders"] })
      toast.success("Reminder set")
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="rem-title">Remind me to…</FieldLabel>
          <Input id="rem-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Buy Sam's birthday present" required autoFocus maxLength={200} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field>
            <FieldLabel htmlFor="rem-date">Date</FieldLabel>
            <Input id="rem-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="rem-time">Time</FieldLabel>
            <Input id="rem-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
        </div>
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onDone}>Cancel</Button>
          <Button type="submit" className="h-10 flex-1" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
