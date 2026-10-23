import { useMemo, useState } from "react"
import { AlertTriangleIcon, CheckIcon } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { useBusy, useConnections, useEvents, useUsers } from "@/hooks/queries"
import { eventRange, parsePb } from "@/lib/dates"
import { displayName, type User } from "@/lib/pb"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"

/** What someone already has on between start and end: an event title if we can see it, else just busy. */
export interface Clash {
  title?: string
}

export function useClashes(start: Date, end: Date, ignoreEventId?: string) {
  const { data: events } = useEvents(start, end)
  const { data: busy } = useBusy(start, end)

  return useMemo(() => {
    const out = new Map<string, Clash>()
    for (const ev of events ?? []) {
      if (ev.id === ignoreEventId) continue
      const r = eventRange(ev)
      if (!(r.start < end && r.end > start)) continue
      // the author is busy, and so is anyone who said they're going
      out.set(ev.created_by, { title: ev.title })
    }
    for (const b of busy ?? []) {
      const s = parsePb(b.start)
      const e = parsePb(b.end) ?? s
      if (s && e && s < end && e > start && !out.has(b.user)) out.set(b.user, {})
    }
    return out
  }, [events, busy, start, end, ignoreEventId])
}

/**
 * Tap-to-select list of friends. Picking someone who's already busy asks first:
 * "Sam is busy with Gym. Ask if they're free?" Yes adds them to `askFree`.
 */
export function FriendPicker({ value, onChange, askFree, onAskFreeChange, start, end, exclude = [], ignoreEventId }: {
  value: string[]
  onChange: (ids: string[]) => void
  askFree: string[]
  onAskFreeChange: (ids: string[]) => void
  start: Date
  end: Date
  exclude?: string[]
  ignoreEventId?: string
}) {
  const { user } = useAuth()
  const { data: users } = useUsers()
  const { friends: links } = useConnections()
  const clashes = useClashes(start, end, ignoreEventId)
  const [confirming, setConfirming] = useState<User | null>(null)

  const friends = (users ?? []).filter((u) => links.has(u.id) && u.id !== user?.id && !exclude.includes(u.id))
  if (!friends.length) {
    return <p className="text-sm text-muted-foreground">Add friends on the People page to invite them.</p>
  }

  function toggle(f: User) {
    if (value.includes(f.id)) {
      onChange(value.filter((id) => id !== f.id))
      onAskFreeChange(askFree.filter((id) => id !== f.id))
    } else if (clashes.has(f.id)) {
      setConfirming(f)
    } else {
      onChange([...value, f.id])
    }
  }

  const clash = confirming ? clashes.get(confirming.id) : undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {friends.map((f) => {
          const on = value.includes(f.id)
          const busy = clashes.has(f.id)
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-sm transition-colors",
                on ? "border-primary bg-primary/10" : "hover:bg-accent",
              )}
              aria-pressed={on}
              title={busy ? "Already has something on then" : undefined}
            >
              <UserAvatar user={f} size="sm" />
              {displayName(f)}
              {busy && !on && <AlertTriangleIcon className="size-3.5 text-amber-500" />}
              {on && <CheckIcon className="size-3.5 text-primary" />}
            </button>
          )
        })}
      </div>

      {confirming && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p>
            <b>{displayName(confirming)}</b> is busy {clash?.title ? <>with <b>{clash.title}</b></> : "then"}.
            {" "}Ask if they're free?
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onChange([...value, confirming.id])
                onAskFreeChange([...askFree, confirming.id])
                setConfirming(null)
              }}
            >
              Yes, ask
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(null)}>No</Button>
          </div>
        </div>
      )}
    </div>
  )
}
