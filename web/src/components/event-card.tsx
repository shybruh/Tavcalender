import type { ReactNode } from "react"
import { Link } from "react-router"
import { MapPinIcon } from "lucide-react"
import type { Audience, CalEvent } from "@/lib/pb"
import { audienceInfo } from "@/lib/audience"
import { formatEventTime } from "@/lib/dates"
import { cn } from "@/lib/utils"

/** "Private", "Family", "Groups"… with its icon. */
export function AudienceBadge({ audience, className }: { audience: Audience | ""; className?: string }) {
  const info = audienceInfo(audience)
  const Icon = info.icon
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)} title={info.hint}>
      <Icon className="size-3" /> {info.label}
    </span>
  )
}

/** A tappable event row. `label` is the person/group line, `badge` an extra status pill. */
export function EventCard({ event, color, label, badge, showDate, showAudience }: {
  event: CalEvent
  color?: string
  label?: ReactNode
  badge?: ReactNode
  showDate?: boolean
  /** show who it's shared with (useful on your own events) */
  showAudience?: boolean
}) {
  return (
    <Link
      to={`/event/${event.id}`}
      className="flex gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/50"
    >
      <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: color || "var(--primary)" }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 truncate font-medium">{event.title}</div>
          {badge}
        </div>
        <div className="text-sm text-muted-foreground">{formatEventTime(event, { withDate: showDate })}</div>
        {event.location && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <MapPinIcon className="size-3.5 shrink-0" /> {event.location}
          </div>
        )}
        {(label || showAudience) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {label}
            {showAudience && <AudienceBadge audience={event.audience} />}
          </div>
        )}
      </div>
    </Link>
  )
}

/** Small pill used for "Invited", "Going" etc. */
export function StatusPill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" | "warn" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "primary" && "bg-primary/15 text-primary",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "warn" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
      )}
    >
      {children}
    </span>
  )
}
