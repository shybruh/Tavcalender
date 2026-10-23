import { useState, type FormEvent } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { pb, errorMessage, type Note } from "@/lib/pb"
import { dateInput, floatingDate, fromInputs, toPbDate } from "@/lib/dates"
import { useAuth } from "@/hooks/use-auth"
import { useMyCalendar, useMyGroups } from "@/hooks/queries"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { SimpleSelect } from "@/components/simple-select"
import { CalendarDot } from "@/components/calendar-dot"

export function NoteFormDialog({ open, onOpenChange, note, defaultDate }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  note?: Note
  defaultDate?: Date
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={note ? "Edit note" : "New note"}>
      {open && <NoteForm note={note} defaultDate={defaultDate} onDone={() => onOpenChange(false)} />}
    </ResponsiveDialog>
  )
}

function NoteForm({ note, defaultDate, onDone }: { note?: Note; defaultDate?: Date; onDone: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const myCalendar = useMyCalendar()
  const myGroups = useMyGroups()
  const calendars = [...(myCalendar ? [myCalendar] : []), ...myGroups]
  const existingDate = note?.date ? floatingDate(note.date) : null

  const [title, setTitle] = useState(note?.title ?? "")
  const [content, setContent] = useState(note?.content ?? "")
  const [calendar, setCalendar] = useState(note?.calendar ?? calendars[0]?.id ?? "")
  const [onDay, setOnDay] = useState(!!existingDate || !!defaultDate)
  const [date, setDate] = useState(dateInput(existingDate ?? defaultDate ?? new Date()))
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const data = {
      title: title.trim(),
      content,
      pinned,
      date: onDay ? toPbDate(fromInputs(date)) : "",
    }
    setBusy(true)
    try {
      // a note can't move between your private notes and a group once created
      if (note) await pb.collection("notes").update(note.id, data)
      else await pb.collection("notes").create({ ...data, calendar, created_by: user!.id })
      qc.invalidateQueries({ queryKey: ["notes"] })
      toast.success(note ? "Note saved" : "Note added")
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!calendars.length) {
    return <p className="text-sm text-muted-foreground">Your calendar is still being set up. Try again in a moment.</p>
  }

  return (
    <form onSubmit={onSubmit}>
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="note-title">Title</FieldLabel>
          <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Trip ideas" required autoFocus maxLength={200} />
        </Field>
        <Field>
          <FieldLabel htmlFor="note-content">Note</FieldLabel>
          <Textarea id="note-content" value={content} onChange={(e) => setContent(e.target.value)} rows={6} placeholder="Write anything…" maxLength={20000} />
        </Field>
        <Field>
          <FieldLabel htmlFor="note-cal">Where</FieldLabel>
          {note ? (
            <FieldDescription>{calendars.find((c) => c.id === calendar)?.personal ? "Private note" : `In ${calendars.find((c) => c.id === calendar)?.name ?? "a group"}`}</FieldDescription>
          ) : (
            <SimpleSelect
              id="note-cal"
              value={calendar}
              onChange={setCalendar}
              options={calendars.map((c) => ({ value: c.id, label: <span className="flex items-center gap-2"><CalendarDot color={c.color} />{c.personal ? "Private (just me)" : c.name}</span> }))}
            />
          )}
          {!note && (
            <FieldDescription>{calendars.find((c) => c.id === calendar)?.personal ? "Only you can see it." : "Everyone in the group can see it. Only you (and the group owner) can delete it."}</FieldDescription>
          )}
        </Field>
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="note-onday">Show on a day</FieldLabel>
          <Switch id="note-onday" checked={onDay} onCheckedChange={setOnDay} />
        </Field>
        {onDay && <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Day" required />}
        <Field orientation="horizontal" className="justify-between">
          <FieldLabel htmlFor="note-pin">Pin to top</FieldLabel>
          <Switch id="note-pin" checked={pinned} onCheckedChange={setPinned} />
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onDone}>Cancel</Button>
          <Button type="submit" className="h-10 flex-1" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
