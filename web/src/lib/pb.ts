import PocketBase, { type RecordModel } from "pocketbase"

// In production the app is served by PocketBase itself (pb_public), so the API is same-origin.
// In dev, Vite proxies /api to PocketBase.
export const pb = new PocketBase(import.meta.env.VITE_PB_URL || window.location.origin)
pb.autoCancellation(false)

export type Role = "member" | "admin"
export type UserStatus = "pending" | "approved" | "rejected"

export interface User extends RecordModel {
  email: string
  name: string
  avatar: string
  color: string
  role: Role
  status: UserStatus
  created: string
  discord_id: string
  discord_name: string
  discord_mute_invites: boolean
  discord_mute_reminders: boolean
}

/** The single app-wide settings row (Admin -> Discord). The bot token is never sent to the browser. */
export interface AppSettings extends RecordModel {
  app_url: string
  discord_app_id: string
  discord_server_invite: string
  discord_bot_name: string
  discord_last_seen: string
  discord_guilds: number
  discord_error: string
}

export interface DiscordChannel extends RecordModel {
  channel_id: string
  channel_name: string
  guild_id: string
  group: string
  announce: boolean
  created_by: string
}

/**
 * personal = true: a user's own calendar (all their events live here).
 * personal = false: a group. The owner runs it; members can post.
 */
export interface Calendar extends RecordModel {
  name: string
  description: string
  color: string
  personal: boolean
  owner: string
  members: string[]
}

export type Audience = "private" | "partner" | "close_friends" | "family" | "friends" | "groups"
export type ConnectionLabel = "friend" | "close_friend" | "family" | "partner"

/** My side of a friendship: who they are to me. Pending until they add me back. */
export interface Connection extends RecordModel {
  from: string
  to: string
  /** only present on my own side */
  label?: ConnectionLabel
  status: "pending" | "accepted"
  expand?: { from?: User; to?: User }
}

export interface GroupRequest extends RecordModel {
  group: string
  user: string
  kind: "request" | "invite"
  invited_by: string
  expand?: { group?: Calendar; user?: User; invited_by?: User }
}

export interface CalEvent extends RecordModel {
  calendar: string
  title: string
  description: string
  location: string
  start: string
  end: string
  all_day: boolean
  created_by: string
  audience: Audience
  /** groups this was posted to (audience = "groups") */
  groups: string[]
  /** resolved by the server from audience; who besides the author can see it */
  audience_users: string[]
  guests: string[]
  expand?: { created_by?: User; groups?: Calendar[] }
}

/** A time block from someone else's "busy" event (no details). */
export interface BusyBlock {
  id: string
  user: string
  start: string
  end: string
  all_day: boolean
}

export type RsvpStatus = "invited" | "going" | "maybe" | "no"
export interface Rsvp extends RecordModel {
  event: string
  user: string
  status: RsvpStatus
  invited_by: string
  message: string
  expand?: { user?: User; invited_by?: User; event?: CalEvent }
}

export interface Note extends RecordModel {
  calendar: string
  title: string
  content: string
  date: string
  pinned: boolean
  created_by: string
  updated: string
  expand?: { created_by?: User }
}

export interface Reminder extends RecordModel {
  user: string
  event: string
  title: string
  remind_at: string
  offset_minutes: number
  sent: boolean
  expand?: { event?: CalEvent }
}

export interface AppNotification extends RecordModel {
  user: string
  title: string
  body: string
  url: string
  kind: string
  read: boolean
  created: string
}

export function avatarUrl(user: User | undefined | null) {
  if (!user?.avatar) return undefined
  return pb.files.getURL(user, user.avatar, { thumb: "100x100" })
}

export function displayName(user: User | undefined | null) {
  return user?.name || user?.email?.split("@")[0] || "Someone"
}

/** Pulls a readable message out of a PocketBase ClientResponseError. */
export function errorMessage(err: unknown): string {
  const e = err as { response?: { message?: string; data?: Record<string, { message?: string }> }; message?: string }
  const fieldErrors = e?.response?.data
  if (fieldErrors && Object.keys(fieldErrors).length) {
    return Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v?.message}`).join("\n")
  }
  return e?.response?.message || e?.message || "Something went wrong"
}
