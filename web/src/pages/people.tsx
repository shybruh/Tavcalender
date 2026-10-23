import { useMemo, useState, type FormEvent } from "react"
import { Link, useSearchParams } from "react-router"
import { toast } from "sonner"
import { CheckIcon, ChevronRightIcon, CrownIcon, PlusIcon, SearchIcon, UserPlusIcon, UsersIcon, XIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { pb, displayName, errorMessage, type Calendar, type ConnectionLabel, type User } from "@/lib/pb"
import { LABELS, labelName } from "@/lib/audience"
import { useAuth } from "@/hooks/use-auth"
import { groupAction, useConnections, useGroupRequests, useGroups, useUserMap, useUsers } from "@/hooks/queries"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ResponsiveDialog } from "@/components/responsive-dialog"
import { SimpleSelect } from "@/components/simple-select"
import { UserAvatar } from "@/components/user-avatar"
import { CalendarDot } from "@/components/calendar-dot"
import { ConfirmButton } from "@/components/confirm-button"
import { EmptyState } from "@/components/empty-state"
import { COLORS } from "./settings"

const LABEL_OPTIONS = LABELS.map((l) => ({ value: l.value, label: l.label }))

export function PeoplePage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "groups" ? "groups" : "friends"
  const { incoming } = useConnections()
  const { data: requests } = useGroupRequests()
  const { user } = useAuth()
  const groupBadge = (requests ?? []).filter((r) =>
    (r.kind === "invite" && r.user === user?.id) || (r.kind === "request" && r.expand?.group?.owner === user?.id),
  ).length

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <h1 className="mb-4 text-xl font-semibold tracking-tight md:text-2xl">People</h1>
      <Tabs value={tab} onValueChange={(v) => setParams(v === "groups" ? { tab: "groups" } : {})}>
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="friends">
            Friends {incoming.length > 0 && <Badge className="ml-1">{incoming.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="groups">
            Groups {groupBadge > 0 && <Badge className="ml-1">{groupBadge}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="friends"><Friends /></TabsContent>
        <TabsContent value="groups"><Groups /></TabsContent>
      </Tabs>
    </div>
  )
}

// ---- friends ------------------------------------------------------------------------

function Friends() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const users = useUserMap()
  const { data: allUsers } = useUsers()
  const { friends, incoming, outgoing, isLoading } = useConnections()
  const [adding, setAdding] = useState(false)

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["connections"] })
    qc.invalidateQueries({ queryKey: ["events"] })
  }

  async function add(to: string, label: ConnectionLabel) {
    try {
      await pb.collection("connections").create({ from: user!.id, to, label })
      refresh()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  async function relabel(id: string, label: ConnectionLabel) {
    await pb.collection("connections").update(id, { label }).catch((err) => toast.error(errorMessage(err)))
    refresh()
  }
  async function remove(id: string) {
    await pb.collection("connections").delete(id).catch((err) => toast.error(errorMessage(err)))
    refresh()
  }

  const friendList = [...friends.values()]
    .map((c) => ({ c, u: users.get(c.to) }))
    .sort((a, b) => displayName(a.u).localeCompare(displayName(b.u)))
  const connected = new Set([...friends.keys(), ...outgoing.map((c) => c.to), ...incoming.map((c) => c.from)])
  const addable = (allUsers ?? []).filter((u) => u.status === "approved" && u.id !== user?.id && !connected.has(u.id))

  return (
    <div className="flex flex-col gap-6">
      {incoming.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Requests</h2>
          <div className="flex flex-col gap-2">
            {incoming.map((c) => (
              <IncomingRequest key={c.id} user={users.get(c.from)} onAccept={(label) => add(c.from, label)} onDecline={() => remove(c.id)} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 text-sm font-medium">Your people {friendList.length > 0 && <span className="text-muted-foreground">· {friendList.length}</span>}</h2>
          <Button size="sm" onClick={() => setAdding(true)}><UserPlusIcon /> Add</Button>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          What you mark someone as decides which of your plans they see. They can't see your label.
        </p>
        {!isLoading && friendList.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-6" />} title="No one yet" description="Add friends to see each other's plans." />
        ) : (
          <div className="flex flex-col gap-2">
            {friendList.map(({ c, u }) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <UserAvatar user={u} />
                <span className="min-w-0 flex-1 truncate font-medium">{displayName(u)}</span>
                <SimpleSelect
                  size="sm"
                  className="w-32"
                  value={c.label ?? "friend"}
                  onChange={(v) => relabel(c.id, v as ConnectionLabel)}
                  options={LABEL_OPTIONS}
                />
                <ConfirmButton
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${displayName(u)}`}
                  title={`Remove ${displayName(u)}?`}
                  description="You'll both stop seeing each other's plans. You can add each other again later."
                  confirmLabel="Remove"
                  onConfirm={() => remove(c.id)}
                >
                  <XIcon />
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </section>

      {outgoing.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Waiting for them to accept</h2>
          <div className="flex flex-col gap-2">
            {outgoing.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-dashed p-3">
                <UserAvatar user={users.get(c.to)} size="sm" />
                <span className="flex-1 text-sm">{displayName(users.get(c.to))} <span className="text-muted-foreground">· as {labelName(c.label).toLowerCase()}</span></span>
                <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>Cancel</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <ResponsiveDialog open={adding} onOpenChange={setAdding} title="Add people" description="They'll get a request and choose how to add you back.">
        {adding && <AddPeople people={addable} onAdd={add} />}
      </ResponsiveDialog>
    </div>
  )
}

function IncomingRequest({ user, onAccept, onDecline }: {
  user?: User
  onAccept: (label: ConnectionLabel) => void
  onDecline: () => void
}) {
  const [label, setLabel] = useState<ConnectionLabel>("friend")
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-3">
        <UserAvatar user={user} />
        <div className="flex-1 text-sm"><b>{displayName(user)}</b> wants to add you</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">They are your</span>
        <SimpleSelect size="sm" className="w-32" value={label} onChange={(v) => setLabel(v as ConnectionLabel)} options={LABEL_OPTIONS} />
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={onDecline}>Decline</Button>
        <Button size="sm" onClick={() => onAccept(label)}><CheckIcon /> Accept</Button>
      </div>
    </div>
  )
}

function AddPeople({ people, onAdd }: { people: User[]; onAdd: (id: string, label: ConnectionLabel) => Promise<void> }) {
  const [query, setQuery] = useState("")
  const [labels, setLabels] = useState<Record<string, ConnectionLabel>>({})
  const [sent, setSent] = useState<Set<string>>(new Set())
  const shown = people.filter((p) => displayName(p).toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name" className="h-10 pl-8" />
      </div>
      {shown.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No one else to add.</p>}
      {shown.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <UserAvatar user={p} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{displayName(p)}</span>
          <SimpleSelect
            size="sm"
            className="w-32"
            value={labels[p.id] ?? "friend"}
            onChange={(v) => setLabels((l) => ({ ...l, [p.id]: v as ConnectionLabel }))}
            options={LABEL_OPTIONS}
          />
          <Button
            size="sm"
            disabled={sent.has(p.id)}
            onClick={async () => {
              await onAdd(p.id, labels[p.id] ?? "friend")
              setSent((s) => new Set(s).add(p.id))
            }}
          >
            {sent.has(p.id) ? "Sent" : "Add"}
          </Button>
        </div>
      ))}
    </div>
  )
}

// ---- groups -------------------------------------------------------------------------

function Groups() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: groups, isLoading } = useGroups()
  const { data: requests } = useGroupRequests()
  const users = useUserMap()
  const [creating, setCreating] = useState(false)

  const mine = groups.filter((g) => user && g.members.includes(user.id))
  const others = groups.filter((g) => user && !g.members.includes(user.id))
  const invites = (requests ?? []).filter((r) => r.kind === "invite" && r.user === user?.id)
  const myRequests = new Set((requests ?? []).filter((r) => r.kind === "request" && r.user === user?.id).map((r) => r.group))
  const pendingByGroup = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of requests ?? []) if (r.kind === "request" && r.expand?.group?.owner === user?.id) m.set(r.group, (m.get(r.group) ?? 0) + 1)
    return m
  }, [requests, user])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["group_requests"] })
    qc.invalidateQueries({ queryKey: ["calendars"] })
    qc.invalidateQueries({ queryKey: ["events"] })
  }
  async function respond(id: string, accept: boolean) {
    try {
      await groupAction(`group-requests/${id}/respond`, { accept })
      refresh()
      if (accept) toast.success("Joined!")
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
  async function join(g: Calendar) {
    try {
      await groupAction(`groups/${g.id}/join`)
      refresh()
      toast.success(`Asked to join ${g.name}`)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {invites.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Invites</h2>
          <div className="flex flex-col gap-2">
            {invites.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <CalendarDot color={r.expand?.group?.color} className="size-4" />
                <div className="min-w-0 flex-1 text-sm">
                  <b>{displayName(r.expand?.invited_by)}</b> invited you to <b>{r.expand?.group?.name}</b>
                </div>
                <Button size="sm" variant="outline" onClick={() => respond(r.id, false)}>Decline</Button>
                <Button size="sm" onClick={() => respond(r.id, true)}><CheckIcon /> Join</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 text-sm font-medium">Your groups</h2>
          <Button size="sm" onClick={() => setCreating(true)}><PlusIcon /> New group</Button>
        </div>
        {!isLoading && mine.length === 0 ? (
          <EmptyState icon={<UsersIcon className="size-6" />} title="No groups yet" description="Make one for each friend circle, your family, or just you and your partner." />
        ) : (
          <div className="flex flex-col gap-2">
            {mine.map((g) => (
              <Link key={g.id} to={`/groups/${g.id}`} className="flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/50">
                <CalendarDot color={g.color} className="size-4" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    {g.name}
                    {g.owner === user?.id && <CrownIcon className="size-3.5 text-amber-500" aria-label="You own this group" />}
                  </div>
                  <div className="text-sm text-muted-foreground">{g.members.length} {g.members.length === 1 ? "member" : "members"}</div>
                </div>
                {pendingByGroup.get(g.id) ? <Badge>{pendingByGroup.get(g.id)} waiting</Badge> : null}
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {others.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Other groups</h2>
          <div className="flex flex-col gap-2">
            {others.map((g) => (
              <div key={g.id} className="flex items-center gap-3 rounded-xl border border-dashed p-3">
                <CalendarDot color={g.color} className="size-4" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{g.name}</div>
                  <div className="text-sm text-muted-foreground">Run by {displayName(users.get(g.owner))} · {g.members.length} members</div>
                </div>
                <Button size="sm" variant="outline" disabled={myRequests.has(g.id)} onClick={() => join(g)}>
                  {myRequests.has(g.id) ? "Requested" : "Ask to join"}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      <ResponsiveDialog open={creating} onOpenChange={setCreating} title="New group" description="You'll own it: you approve who joins and can tidy up posts.">
        {creating && <GroupForm onDone={() => setCreating(false)} />}
      </ResponsiveDialog>
    </div>
  )
}

/** Create a group, or edit one you own. */
export function GroupForm({ group, onDone }: { group?: Calendar; onDone: (created?: Calendar) => void }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState(group?.name ?? "")
  const [description, setDescription] = useState(group?.description ?? "")
  const [color, setColor] = useState(group?.color ?? COLORS[5])
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const data = { name: name.trim(), description: description.trim(), color }
      const saved = group
        ? await pb.collection("calendars").update<Calendar>(group.id, data)
        : await pb.collection("calendars").create<Calendar>({ ...data, owner: user!.id, personal: false })
      qc.invalidateQueries({ queryKey: ["calendars"] })
      toast.success(group ? "Group saved" : "Group created")
      onDone(saved)
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
          <FieldLabel htmlFor="g-name">Name</FieldLabel>
          <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Uni friends, Family, Us two…" autoFocus />
        </Field>
        <Field>
          <FieldLabel htmlFor="g-desc">Description</FieldLabel>
          <Textarea id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={500} placeholder="Optional" />
        </Field>
        <Field>
          <FieldLabel>Color</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="size-8 rounded-full ring-offset-2 ring-offset-background transition data-[on=true]:ring-2 data-[on=true]:ring-foreground"
                data-on={color === c}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </Field>
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={() => onDone()}>Cancel</Button>
          <Button type="submit" className="h-10 flex-1" disabled={busy}>{group ? "Save" : "Create"}</Button>
        </div>
      </FieldGroup>
    </form>
  )
}
