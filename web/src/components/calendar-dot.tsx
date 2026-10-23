import { cn } from "@/lib/utils"

export function CalendarDot({ color, className }: { color?: string; className?: string }) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: color || "var(--primary)" }} />
}
