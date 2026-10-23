import { GlobeIcon, HeartIcon, HomeIcon, LockIcon, StarIcon, UsersIcon } from "lucide-react"
import type { Audience, ConnectionLabel } from "./pb"

export const AUDIENCES: { value: Audience; label: string; hint: string; icon: typeof LockIcon }[] = [
  { value: "private", label: "Private", hint: "Only you", icon: LockIcon },
  { value: "partner", label: "Partner", hint: "People you've marked as partner", icon: HeartIcon },
  { value: "close_friends", label: "Close friends", hint: "People you've marked as close friends", icon: StarIcon },
  { value: "family", label: "Family", hint: "People you've marked as family", icon: HomeIcon },
  { value: "friends", label: "Friends", hint: "Everyone you're connected with", icon: GlobeIcon },
  { value: "groups", label: "Groups", hint: "Members of the groups you pick", icon: UsersIcon },
]

export const audienceInfo = (a: Audience | "" | undefined) => AUDIENCES.find((x) => x.value === a) ?? AUDIENCES[0]

export const LABELS: { value: ConnectionLabel; label: string }[] = [
  { value: "friend", label: "Friend" },
  { value: "close_friend", label: "Close friend" },
  { value: "family", label: "Family" },
  { value: "partner", label: "Partner" },
]

export const labelName = (l: ConnectionLabel | undefined) => LABELS.find((x) => x.value === l)?.label ?? "Friend"
