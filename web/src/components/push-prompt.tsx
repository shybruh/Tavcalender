import { useState } from "react"
import { BellRingIcon, XIcon } from "lucide-react"
import { usePush } from "@/hooks/use-push"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** Inline nudge to turn on push notifications; hides itself once on/unsupported/dismissed. */
export function PushPrompt({ className }: { className?: string }) {
  const { state, busy, enable } = usePush()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("tav:push-dismissed") === "1" } catch { return false }
  })
  if (dismissed || !state || state === "on" || state === "unsupported" || state === "denied") return null

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem("tav:push-dismissed", "1") } catch { /* ignore */ }
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3", className)}>
      <BellRingIcon className="size-5 shrink-0 text-primary" />
      <div className="flex-1 text-sm">
        {state === "needs-install"
          ? <>To get notifications on iPhone, tap <b>Share → Add to Home Screen</b>, then open the app from there.</>
          : "Get a ping on this device for reminders, new plans and RSVPs."}
      </div>
      {state === "off" && <Button size="sm" onClick={enable} disabled={busy}>Turn on</Button>}
      <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Dismiss"><XIcon /></Button>
    </div>
  )
}
