import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/push"
import { errorMessage } from "@/lib/pb"

export function usePush() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => getPushState().then(setState), [])
  useEffect(() => { refresh() }, [refresh])

  const enable = useCallback(async () => {
    setBusy(true)
    try {
      await enablePush()
      toast.success("Notifications enabled on this device")
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
      refresh()
    }
  }, [refresh])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      await disablePush()
    } finally {
      setBusy(false)
      refresh()
    }
  }, [refresh])

  return { state, busy, enable, disable }
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const installListeners = new Set<() => void>()
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault()
  deferredPrompt = e as BeforeInstallPromptEvent
  installListeners.forEach((l) => l())
})

/** Exposes the browser's "Install app" prompt (Chrome/Edge/Android). */
export function useInstallPrompt() {
  const [available, setAvailable] = useState(!!deferredPrompt)
  useEffect(() => {
    const l = () => setAvailable(!!deferredPrompt)
    installListeners.add(l)
    return () => { installListeners.delete(l) }
  }, [])

  const install = useCallback(async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    setAvailable(false)
  }, [])

  return { available, install }
}
