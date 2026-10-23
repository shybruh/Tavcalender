import { useNavigate } from "react-router"
import { formatDistanceToNow } from "date-fns"
import { AlarmClockIcon, BellIcon, CalendarPlusIcon, CheckCheckIcon, MailIcon, PartyPopperIcon, UserPlusIcon, UsersIcon } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { pb, type AppNotification } from "@/lib/pb"
import { parsePb } from "@/lib/dates"
import { useMarkAllRead, useNotifications } from "@/hooks/queries"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/empty-state"
import { PushPrompt } from "@/components/push-prompt"

const ICONS: Record<string, typeof BellIcon> = {
  signup: UserPlusIcon,
  approved: PartyPopperIcon,
  access: UsersIcon,
  event: CalendarPlusIcon,
  rsvp: UsersIcon,
  reminder: AlarmClockIcon,
  invite: MailIcon,
  friend: UserPlusIcon,
  group: UsersIcon,
}

export function NotificationsPage() {
  const { data, isLoading } = useNotifications()
  const markAll = useMarkAllRead()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const unread = data?.filter((n) => !n.read).length ?? 0

  async function open(n: AppNotification) {
    if (!n.read) {
      await pb.collection("notifications").update(n.id, { read: true }).catch(() => {})
      qc.invalidateQueries({ queryKey: ["notifications"] })
    }
    if (n.url) navigate(n.url)
  }

  return (
    <div className="mx-auto max-w-2xl p-3 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Notifications</h1>
        <div className="flex-1" />
        {unread > 0 && (
          <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            <CheckCheckIcon /> Mark all read
          </Button>
        )}
      </div>
      <PushPrompt className="mb-4" />
      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
      ) : !data?.length ? (
        <EmptyState icon={<BellIcon className="size-6" />} title="All quiet" description="New events, RSVPs and reminders will show up here." />
      ) : (
        <div className="flex flex-col overflow-hidden rounded-xl border bg-card">
          {data.map((n) => {
            const Icon = ICONS[n.kind] ?? BellIcon
            const at = parsePb(n.created)
            return (
              <button
                key={n.id}
                onClick={() => open(n)}
                className={cn("flex items-start gap-3 border-b p-3 text-left transition-colors last:border-b-0 hover:bg-accent/50", !n.read && "bg-primary/5")}
              >
                <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", n.read ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary")}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm", !n.read && "font-medium")}>{n.title}</div>
                  {n.body && <div className="text-sm text-muted-foreground">{n.body}</div>}
                  {at && <div className="mt-0.5 text-xs text-muted-foreground">{formatDistanceToNow(at, { addSuffix: true })}</div>}
                </div>
                {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
