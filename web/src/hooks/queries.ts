import { useEffect, useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { addDays } from "date-fns"
import {
  pb,
  type AppNotification,
  type AppSettings,
  type DiscordChannel,
  type BusyBlock,
  type CalEvent,
  type Calendar,
  type Connection,
  type GroupRequest,
  type Note,
  type Reminder,
  type Rsvp,
  type User,
} from "@/lib/pb"
import { toPb } from "@/lib/dates"
import { useAuth } from "./use-auth"

/** Invalidates the matching react-query keys whenever a collection changes (PocketBase realtime). */
export function useRealtimeSync() {
  const qc = useQueryClient()
  const { user, isApproved } = useAuth()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    const collections = isApproved
      ? ["calendars", "events", "notes", "rsvps", "reminders", "notifications", "users", "connections", "group_requests", "app_settings", "discord_channels"]
      : ["notifications"]
    // friendships and group membership change which events you can see
    const alsoRefresh: Record<string, string[]> = { connections: ["events"], calendars: ["events", "notes"] }
    const unsubs: Array<() => Promise<void>> = []
    let cancelled = false
    for (const name of collections) {
      pb.collection(name)
        .subscribe("*", () => {
          for (const key of [name, ...(alsoRefresh[name] ?? [])]) qc.invalidateQueries({ queryKey: [key] })
        })
        .then((u) => {
          if (cancelled) u()
          else unsubs.push(u)
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
      unsubs.forEach((u) => u())
    }
  }, [qc, userId, isApproved])
}

// ---- users ---------------------------------------------------------------------

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: () => pb.collection("users").getFullList<User>({ sort: "name,email" }),
  })
}

export function useUserMap() {
  const { data } = useUsers()
  return useMemo(() => new Map((data ?? []).map((u) => [u.id, u])), [data])
}

// ---- calendars -----------------------------------------------------------------

export function useCalendars() {
  return useQuery({
    queryKey: ["calendars"],
    queryFn: () => pb.collection("calendars").getFullList<Calendar>({ sort: "name" }),
  })
}

/** The signed-in user's personal calendar (where all their events live). */
export function useMyCalendar() {
  const { user } = useAuth()
  const { data } = useCalendars()
  return useMemo(() => data?.find((c) => c.personal && c.owner === user?.id), [data, user])
}

/** Every group (anyone can see a group exists and ask to join). */
export function useGroups() {
  const { data, isLoading } = useCalendars()
  return { data: useMemo(() => (data ?? []).filter((c) => !c.personal), [data]), isLoading }
}

/** Groups the signed-in user is a member of. */
export function useMyGroups() {
  const { user } = useAuth()
  const { data } = useGroups()
  return useMemo(() => data.filter((g) => user && g.members.includes(user.id)), [data, user])
}

/** Pending join requests and invites the user can see (their own, and ones for groups they own). */
export function useGroupRequests() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["group_requests", user?.id],
    enabled: !!user,
    queryFn: () => pb.collection("group_requests").getFullList<GroupRequest>({ expand: "group,user,invited_by", sort: "-created" }),
  })
}

export const groupAction = (path: string, body?: Record<string, unknown>) =>
  pb.send(`/api/tav/${path}`, { method: "POST", body })

// ---- connections -------------------------------------------------------------------

/**
 * Friends: everyone I'm connected with, plus requests both ways.
 * `label` is what they are to me; `status` is accepted once both sides added each other.
 */
export function useConnections() {
  const { user } = useAuth()
  const q = useQuery({
    queryKey: ["connections", user?.id],
    enabled: !!user,
    queryFn: () => pb.collection("connections").getFullList<Connection>({ sort: "-created" }),
  })
  return useMemo(() => {
    const rows = q.data ?? []
    const mine = rows.filter((c) => c.from === user?.id)
    const theirs = rows.filter((c) => c.to === user?.id)
    return {
      isLoading: q.isLoading,
      /** accepted friends, keyed by their user id -> my side (with my label) */
      friends: new Map(mine.filter((c) => c.status === "accepted").map((c) => [c.to, c])),
      /** I asked, they haven't added me back */
      outgoing: mine.filter((c) => c.status === "pending"),
      /** they asked, I haven't added them back */
      incoming: theirs.filter((c) => c.status === "pending"),
    }
  }, [q.data, q.isLoading, user])
}

// ---- events --------------------------------------------------------------------

export function useEvents(from: Date, to: Date) {
  // pad backwards so multi-day events that started earlier still show
  const fromPb = toPb(addDays(from, -31))
  const toPbStr = toPb(addDays(to, 1))
  return useQuery({
    queryKey: ["events", fromPb, toPbStr],
    queryFn: () =>
      pb.collection("events").getFullList<CalEvent>({
        filter: pb.filter("start >= {:from} && start < {:to}", { from: fromPb, to: toPbStr }),
        sort: "start",
        expand: "created_by",
      }),
    placeholderData: (prev) => prev,
  })
}

export function useUpcomingEvents(limit = 50) {
  const now = toPb(addDays(new Date(), -1))
  return useQuery({
    queryKey: ["events", "upcoming", limit],
    queryFn: () =>
      pb.collection("events").getList<CalEvent>(1, limit, {
        filter: pb.filter("start >= {:now} || end >= {:now}", { now }),
        sort: "start",
        expand: "created_by",
      }).then((r) => r.items),
  })
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ["events", "one", id],
    enabled: !!id,
    queryFn: () => pb.collection("events").getOne<CalEvent>(id!, { expand: "created_by,groups" }),
  })
}

export function useRsvps(eventId: string | undefined) {
  return useQuery({
    queryKey: ["rsvps", eventId],
    enabled: !!eventId,
    queryFn: () =>
      pb.collection("rsvps").getFullList<Rsvp>({
        filter: pb.filter("event = {:id}", { id: eventId }),
        expand: "user",
      }),
  })
}

/** Other people's "busy" blocks in a range (refreshes along with events). */
export function useBusy(from: Date, to: Date) {
  const f = toPb(addDays(from, -31))
  const t = toPb(addDays(to, 1))
  return useQuery({
    queryKey: ["events", "busy", f, t],
    queryFn: () => pb.send<BusyBlock[]>("/api/tav/busy", { query: { from: f, to: t } }),
    placeholderData: (prev) => prev,
  })
}

/** Events that belong on the user's Home: their own, ones they're a guest of, and ones they RSVP'd to. */
export function useHomeEvents(from: Date, to: Date) {
  const { user } = useAuth()
  const fromPb = toPb(addDays(from, -31))
  const toPbStr = toPb(addDays(to, 1))
  const own = useQuery({
    queryKey: ["events", "home", user?.id, fromPb, toPbStr],
    enabled: !!user,
    queryFn: () =>
      pb.collection("events").getFullList<CalEvent>({
        filter: pb.filter("start >= {:from} && start < {:to} && (created_by = {:me} || guests.id ?= {:me})", {
          from: fromPb, to: toPbStr, me: user!.id,
        }),
        sort: "start",
        expand: "created_by",
      }),
    placeholderData: (prev) => prev,
  })
  const rsvps = useMyRsvps()
  const data = useMemo(() => {
    const byId = new Map((own.data ?? []).map((e) => [e.id, e]))
    for (const r of rsvps.data ?? []) {
      const ev = r.expand?.event
      if (ev && (r.status === "going" || r.status === "maybe") && ev.start >= fromPb && ev.start < toPbStr) byId.set(ev.id, ev)
    }
    // hide events I declined
    const declined = new Set((rsvps.data ?? []).filter((r) => r.status === "no").map((r) => r.event))
    return [...byId.values()].filter((e) => !declined.has(e.id))
  }, [own.data, rsvps.data, fromPb, toPbStr])
  return { data, isLoading: own.isLoading }
}

/** All of the signed-in user's RSVPs / invites, with their events. */
export function useMyRsvps() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["rsvps", "mine", user?.id],
    enabled: !!user,
    queryFn: () =>
      pb.collection("rsvps").getFullList<Rsvp>({
        filter: pb.filter("user = {:me}", { me: user!.id }),
        expand: "event,invited_by",
        sort: "-created",
      }),
  })
}

/** Invites still waiting for an answer (event not over yet). */
export function usePendingInvites() {
  const { data } = useMyRsvps()
  return useMemo(() => {
    const now = toPb(new Date())
    return (data ?? []).filter((r) => r.status === "invited" && r.expand?.event && (r.expand.event.end || r.expand.event.start) >= now)
  }, [data])
}

/** Invite people to your event. `askFree` = invitees who look busy then (they're asked if they're free). */
export async function inviteToEvent(eventId: string, users: string[], message = "", askFree: string[] = []) {
  if (!users.length) return { invited: 0 }
  return pb.send<{ invited: number }>("/api/tav/invite", {
    method: "POST",
    body: { event: eventId, users, message, ask_free: askFree.filter((id) => users.includes(id)) },
  })
}

// ---- notes ---------------------------------------------------------------------

export function useNotes() {
  return useQuery({
    queryKey: ["notes"],
    queryFn: () => pb.collection("notes").getFullList<Note>({ sort: "-pinned,-updated", expand: "created_by" }),
  })
}

// ---- reminders -----------------------------------------------------------------

export function useReminders() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["reminders", user?.id],
    enabled: !!user,
    queryFn: () =>
      pb.collection("reminders").getFullList<Reminder>({
        filter: pb.filter("user = {:u}", { u: user!.id }),
        sort: "sent,remind_at",
        expand: "event",
      }),
  })
}

// ---- notifications -------------------------------------------------------------

export function useNotifications() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: () =>
      pb.collection("notifications").getList<AppNotification>(1, 50, {
        filter: pb.filter("user = {:u}", { u: user!.id }),
        sort: "-created",
      }).then((r) => r.items),
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => pb.send("/api/tav/notifications/read-all", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  })
}

// ---- discord -------------------------------------------------------------------------

export function useAppSettings() {
  return useQuery({
    queryKey: ["app_settings"],
    queryFn: () => pb.collection("app_settings").getFullList<AppSettings>().then((r) => r[0] ?? null),
  })
}

/** Discord channels connected to a group (members only). */
export function useGroupChannels(groupId: string | undefined) {
  return useQuery({
    queryKey: ["discord_channels", groupId],
    enabled: !!groupId,
    queryFn: () => pb.collection("discord_channels").getFullList<DiscordChannel>({ filter: pb.filter("group = {:g}", { g: groupId }) }),
  })
}

/** "Add to server" link for the bot: slash commands + send messages / embeds / view channel. */
export function botInviteUrl(appId: string) {
  const permissions = 1024 + 2048 + 16384 // view channel, send messages, embed links
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&scope=bot+applications.commands&permissions=${permissions}`
}
