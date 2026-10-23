import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router"
import { format, formatDistanceToNow } from "date-fns"
import { CalendarIcon, NotebookPenIcon, PinIcon, PlusIcon, SearchIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { pb, displayName, errorMessage, type Note } from "@/lib/pb"
import { floatingDate, parsePb } from "@/lib/dates"
import { useAuth } from "@/hooks/use-auth"
import { useCalendars, useNotes } from "@/hooks/queries"
import { useHiddenCalendars } from "@/hooks/use-prefs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { NoteFormDialog } from "@/components/note-form"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { EmptyState } from "@/components/empty-state"
import { CalendarDot } from "@/components/calendar-dot"
import { UserAvatar } from "@/components/user-avatar"
import { ConfirmButton } from "@/components/confirm-button"

export function NotesPage() {
  const { data: notes, isLoading } = useNotes()
  const { data: calendars } = useCalendars()
  const { hidden } = useHiddenCalendars()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState("")
  const [creating, setCreating] = useState(false)

  const calMap = useMemo(() => new Map((calendars ?? []).map((c) => [c.id, c])), [calendars])
  const filtered = (notes ?? []).filter((n) => {
    if (hidden.has(n.calendar)) return false
    const q = query.trim().toLowerCase()
    return !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
  })

  const openId = params.get("open")
  const openNote = notes?.find((n) => n.id === openId)

  return (
    <div className="mx-auto max-w-5xl p-3 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Notes</h1>
        <div className="flex-1" />
        <Button onClick={() => setCreating(true)}><PlusIcon /> New note</Button>
      </div>
      <div className="relative mb-4">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes" className="h-10 pl-8" />
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<NotebookPenIcon className="size-6" />}
          title={query ? "No matching notes" : "No notes yet"}
          description={query ? undefined : "Jot down ideas, packing lists, gift ideas, anything the group should remember."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((n) => {
            const cal = calMap.get(n.calendar)
            const day = n.date ? floatingDate(n.date) : null
            return (
              <button
                key={n.id}
                onClick={() => setParams({ open: n.id })}
                className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/50"
              >
                <div className="flex items-start gap-2">
                  <span className="flex-1 font-medium">{n.title}</span>
                  {n.pinned && <PinIcon className="size-4 shrink-0 text-primary" />}
                </div>
                {n.content && <p className="line-clamp-4 text-sm whitespace-pre-line text-muted-foreground">{n.content}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                  {cal && <span className="flex items-center gap-1.5"><CalendarDot color={cal.color} className="size-2" />{cal.personal ? "Private" : cal.name}</span>}
                  {day && <span className="flex items-center gap-1"><CalendarIcon className="size-3" />{format(day, "d MMM")}</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      <NoteFormDialog open={creating} onOpenChange={setCreating} />
      <NoteViewer note={openNote} onClose={() => setParams({})} />
    </div>
  )
}

function NoteViewer({ note, onClose }: { note?: Note; onClose: () => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: calendars } = useCalendars()
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState(note)
  // keep showing the last note while the drawer animates closed
  useEffect(() => { if (note) setCurrent(note) }, [note])

  const cal = calendars?.find((c) => c.id === current?.calendar)
  // you edit your own notes; a group's owner can also delete notes in it
  const canEdit = current?.created_by === user?.id
  const canDelete = canEdit || (!!cal && !cal.personal && cal.owner === user?.id)
  const updated = current ? parsePb(current.updated) : null

  async function remove() {
    try {
      await pb.collection("notes").delete(current!.id)
      qc.invalidateQueries({ queryKey: ["notes"] })
      toast.success("Note deleted")
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <>
      <ResponsiveDialog open={!!note && !editing} onOpenChange={(o) => !o && onClose()} title={current?.title ?? ""}>
        {current && (
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{current.content || <span className="text-muted-foreground">No content</span>}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <UserAvatar user={current.expand?.created_by} size="sm" />
              <span>
                {displayName(current.expand?.created_by)}
                {updated && ` · updated ${formatDistanceToNow(updated, { addSuffix: true })}`}
                {cal && ` · ${cal.personal ? "Private" : cal.name}`}
              </span>
            </div>
            {canDelete && (
              <div className="flex gap-2">
                <ConfirmButton
                  title="Delete this note?"
                  description="This can't be undone."
                  confirmLabel="Delete"
                  onConfirm={remove}
                  variant="outline"
                  className="h-10"
                >
                  <Trash2Icon /> Delete
                </ConfirmButton>
                {canEdit && <Button className="h-10 flex-1" onClick={() => setEditing(true)}>Edit</Button>}
              </div>
            )}
          </div>
        )}
      </ResponsiveDialog>
      <NoteFormDialog open={editing} onOpenChange={setEditing} note={current} />
    </>
  )
}
