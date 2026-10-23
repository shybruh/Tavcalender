import { useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router"
import { addDays, format, isToday, isTomorrow, startOfDay } from "date-fns"
import { toast } from "sonner"
import { ArrowLeftIcon, CheckIcon, CrownIcon, LogOutIcon, PencilIcon, PlusIcon, Trash2Icon, UserPlusIcon, XIcon } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { pb, displayName, errorMessage, type CalEvent } from "@/lib/pb"
import { eventRange, toPb } from "@/lib/dates"
import { useAuth } from "@/hooks/use-auth"
import { groupAction, useConnections, useGroupChannels, useGroupRequests, useGroups, useUserMap } from "@/hooks/queries"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { EventFormDialog } from "@/components/event-form"
import { EventCard } from "@/components/event-card"
import { UserAvatar } from "@/components/user-avatar"
import { CalendarDot } from "@/components/calendar-dot"
import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState } from "@/components/empty-state"
import { GroupForm } from "./people"
import { DiscordIcon } from "./settings"
import { Switch } from "@/components/ui/switch"

export function GroupDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()
  const users = useUserMap()
  const { data: groups, isLoading } = useGroups()
  const { data: requests } = useGroupRequests()
  const [posting, setPosting] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState(false)

  const group = groups.find((g) => g.id === id)
  const isMember = !!(group && user && group.members.includes(user.id))
  const isOwner = group?.owner === user?.id

  // upcoming posts in this group (only members can load them)
  const from = toPb(addDays(startOfDay(new Date()), -1))
  const posts = useQuery({
    queryKey: ["events", "group", id, from],
    enabled: isMember,
    queryFn: () =>
      pb.collection("events").getFullList<CalEvent>({
        filter: pb.filter("groups.id ?= {:g} && (start >= {:from} || end >= {:from})", { g: id, from }),
        sort: "start",
        expand: "created_by",
      }),
  })

  const joinRequests = (requests ?? []).filter((r) => r.group === id && r.kind === "request")
  const myRequest = (requests ?? []).find((r) => r.group === id && r.user === user?.id)

  const refresh = () => {
    for (const k of ["calendars", "group_requests", "events"]) qc.invalidateQueries({ queryKey: [k] })
  }
  const act = async (path: string, body?: Record<string, unknown>, ok?: string) => {
    try {
      await groupAction(path, body)
      refresh()
      if (ok) toast.success(ok)
      return true
    } catch (err) {
      toast.error(errorMessage(err))
      return false
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<number, CalEvent[]>()
    for (const ev of posts.data ?? []) {
      const key = Math.max(startOfDay(eventRange(ev).start).getTime(), startOfDay(new Date()).getTime())
      map.set(key, [...(map.get(key) ?? []), ev])
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [posts.data])

  if (isLoading) return <div className="mx-auto max-w-2xl space-y-3 p-4"><Skeleton className="h-24 rounded-2xl" /></div>
  if (!group) return <EmptyState title="Group not found" description="It may have been deleted." />

  const owner = users.get(group.owner)

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={() => navigate("/people?tab=groups")}>
        <ArrowLeftIcon /> Groups
      </Button>

      <div className="mb-5 rounded-2xl border bg-card p-4">
        <div className="flex items-start gap-3">
          <CalendarDot color={group.color} className="mt-2 size-4" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
            {group.description && <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>}
            <p className="mt-1 text-xs text-muted-foreground">Run by {group.owner === user?.id ? "you" : displayName(owner)} · {group.members.length} {group.members.length === 1 ? "member" : "members"}</p>
          </div>
        </div>

        <div className="mt-3 flex -space-x-2">
          {group.members.slice(0, 12).map((m) => (
            <UserAvatar key={m} user={users.get(m)} className="ring-2 ring-card" />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {isMember ? (
            <>
              <Button onClick={() => setPosting(true)}><PlusIcon /> Post plan</Button>
              <Button variant="outline" onClick={() => setInviting(true)}><UserPlusIcon /> Invite</Button>
              {isOwner ? (
                <>
                  <Button variant="ghost" onClick={() => setEditing(true)}><PencilIcon /> Edit</Button>
                  <ConfirmButton
                    variant="ghost"
                    title={`Delete “${group.name}”?`}
                    description="Posts here go back to being private on each person's own calendar. Group notes are deleted."
                    confirmLabel="Delete group"
                    onConfirm={async () => {
                      try {
                        await pb.collection("calendars").delete(group.id)
                        refresh()
                        navigate("/people?tab=groups")
                      } catch (err) {
                        toast.error(errorMessage(err))
                      }
                    }}
                  >
                    <Trash2Icon /> Delete
                  </ConfirmButton>
                </>
              ) : (
                <ConfirmButton
                  variant="ghost"
                  title={`Leave “${group.name}”?`}
                  description="You'll stop seeing its plans. Your own posts here become private."
                  confirmLabel="Leave"
                  onConfirm={async () => { if (await act(`groups/${group.id}/leave`)) navigate("/people?tab=groups") }}
                >
                  <LogOutIcon /> Leave
                </ConfirmButton>
              )}
            </>
          ) : myRequest?.kind === "invite" ? (
            <Button onClick={() => act(`group-requests/${myRequest.id}/respond`, { accept: true }, "Joined!")}><CheckIcon /> Accept invite</Button>
          ) : (
            <Button disabled={!!myRequest} onClick={() => act(`groups/${group.id}/join`, undefined, "Request sent")}>
              {myRequest ? "Request sent" : "Ask to join"}
            </Button>
          )}
        </div>
      </div>

      {isOwner && joinRequests.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-medium">Want to join</h2>
          <div className="flex flex-col gap-2">
            {joinRequests.map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <UserAvatar user={r.expand?.user} />
                <span className="flex-1 text-sm font-medium">{displayName(r.expand?.user)}</span>
                <Button size="sm" variant="outline" onClick={() => act(`group-requests/${r.id}/respond`, { accept: false })}>Decline</Button>
                <Button size="sm" onClick={() => act(`group-requests/${r.id}/respond`, { accept: true }, "Approved")}><CheckIcon /> Approve</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {isMember ? (
        <>
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-medium">Coming up</h2>
            {posts.isLoading ? (
              <Skeleton className="h-20 rounded-xl" />
            ) : grouped.length === 0 ? (
              <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing planned yet. Post the first plan!</p>
            ) : (
              <div className="flex flex-col gap-4">
                {grouped.map(([key, evs]) => {
                  const day = new Date(key)
                  return (
                    <div key={key}>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                        {isToday(day) ? "Today" : isTomorrow(day) ? "Tomorrow" : format(day, "EEEE d MMMM")}
                      </div>
                      <div className="flex flex-col gap-2">
                        {evs.map((ev) => (
                          <EventCard
                            key={ev.id}
                            event={ev}
                            color={users.get(ev.created_by)?.color || group.color}
                            label={`Posted by ${ev.created_by === user?.id ? "you" : displayName(ev.expand?.created_by)}`}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <DiscordChannels groupId={group.id} isOwner={isOwner} />

          <section>
            <h2 className="mb-2 text-sm font-medium">Members</h2>
            <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
              {group.members.map((m) => {
                const u = users.get(m)
                return (
                  <div key={m} className="flex items-center gap-3 border-b p-3 last:border-b-0">
                    <UserAvatar user={u} size="sm" />
                    <span className="flex-1 text-sm">{m === user?.id ? "You" : displayName(u)}</span>
                    {m === group.owner && <Badge variant="secondary"><CrownIcon /> Owner</Badge>}
                    {isOwner && m !== group.owner && (
                      <ConfirmButton
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove ${displayName(u)}`}
                        title={`Remove ${displayName(u)} from the group?`}
                        confirmLabel="Remove"
                        onConfirm={() => { act(`groups/${group.id}/remove-member`, { user: m }) }}
                      >
                        <XIcon />
                      </ConfirmButton>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Only members can see this group's plans.
        </p>
      )}

      <EventFormDialog open={posting} onOpenChange={setPosting} defaultGroup={group.id} />
      <ResponsiveDialog open={inviting} onOpenChange={setInviting} title={`Invite to ${group.name}`} description="They'll get an invite and can join straight away.">
        {inviting && <InviteToGroup groupId={group.id} members={group.members} onDone={() => setInviting(false)} />}
      </ResponsiveDialog>
      <ResponsiveDialog open={editing} onOpenChange={setEditing} title="Edit group">
        {editing && <GroupForm group={group} onDone={() => setEditing(false)} />}
      </ResponsiveDialog>
    </div>
  )
}

function InviteToGroup({ groupId, members, onDone }: { groupId: string; members: string[]; onDone: () => void }) {
  const qc = useQueryClient()
  const users = useUserMap()
  const { friends } = useConnections()
  const { data: requests } = useGroupRequests()
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const invitedAlready = new Set((requests ?? []).filter((r) => r.group === groupId && r.kind === "invite").map((r) => r.user))
  const candidates = [...friends.keys()].filter((id) => !members.includes(id)).map((id) => users.get(id)).filter((u) => !!u)

  async function send() {
    setBusy(true)
    try {
      const res = await groupAction(`groups/${groupId}/invite`, { users: picked }) as { invited: number }
      qc.invalidateQueries({ queryKey: ["group_requests"] })
      qc.invalidateQueries({ queryKey: ["calendars"] })
      toast.success(`Invited ${res.invited}`)
      onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!candidates.length) return <p className="text-sm text-muted-foreground">All your friends are already in this group.</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {candidates.map((u) => {
          const on = picked.includes(u.id)
          const already = invitedAlready.has(u.id)
          return (
            <button
              key={u.id}
              type="button"
              disabled={already}
              onClick={() => setPicked(on ? picked.filter((x) => x !== u.id) : [...picked, u.id])}
              className={`flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-sm transition-colors disabled:opacity-50 ${on ? "border-primary bg-primary/10" : "hover:bg-accent"}`}
            >
              <UserAvatar user={u} size="sm" />
              {displayName(u)}
              {already && <span className="text-xs text-muted-foreground">invited</span>}
              {on && <CheckIcon className="size-3.5 text-primary" />}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="h-10 flex-1" onClick={onDone}>Cancel</Button>
        <Button className="h-10 flex-1" disabled={!picked.length || busy} onClick={send}>Send {picked.length > 0 && `(${picked.length})`}</Button>
      </div>
    </div>
  )
}

/** Discord channels connected with /group connect. Owners decide whether new posts get announced. */
function DiscordChannels({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const qc = useQueryClient()
  const { data: channels } = useGroupChannels(groupId)
  if (!channels?.length) return null

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn()
      qc.invalidateQueries({ queryKey: ["discord_channels"] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-medium"><DiscordIcon className="size-3.5" /> Discord channels</h2>
      <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
        {channels.map((ch) => (
          <div key={ch.id} className="flex items-center gap-3 border-b p-3 last:border-b-0">
            <span className="flex-1 text-sm">#{ch.channel_name || ch.channel_id}</span>
            {isOwner ? (
              <>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Announce new plans
                  <Switch
                    size="sm"
                    checked={ch.announce}
                    onCheckedChange={(on) => run(() => pb.collection("discord_channels").update(ch.id, { announce: on }))}
                  />
                </label>
                <Button size="icon-sm" variant="ghost" aria-label="Disconnect channel" onClick={() => run(() => pb.collection("discord_channels").delete(ch.id))}>
                  <XIcon />
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{ch.announce ? "Announces new plans" : "Plans default here"}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
