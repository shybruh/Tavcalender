import { useEffect, useSyncExternalStore } from "react"
import { pb, type User } from "@/lib/pb"
import { forgetPushSubscription } from "@/lib/push"

// LocalAuthStore re-parses localStorage on every `.record` read, so cache the
// record and only replace it when the store reports a change.
let cached = pb.authStore.record as User | null
pb.authStore.onChange(() => {
  cached = pb.authStore.record as User | null
})

function subscribe(cb: () => void) {
  return pb.authStore.onChange(cb)
}
function snapshot() {
  return cached
}

export function useAuth() {
  const user = useSyncExternalStore(subscribe, snapshot)
  return {
    user,
    isAdmin: user?.role === "admin",
    isApproved: user?.status === "approved",
  }
}

/**
 * Keeps the signed-in user's record fresh: refreshes the token on load and
 * listens for changes (e.g. the admin approving them) via realtime.
 */
export function useAuthSync() {
  const userId = useSyncExternalStore(subscribe, () => cached?.id ?? null)

  useEffect(() => {
    if (!userId) return
    pb.collection("users").authRefresh().catch(() => pb.authStore.clear())

    let unsub: (() => void) | undefined
    pb.collection("users")
      .subscribe(userId, (e) => {
        if (e.action === "delete") return pb.authStore.clear()
        pb.authStore.save(pb.authStore.token, e.record)
      })
      .then((u) => (unsub = u))
      .catch(() => {})
    return () => unsub?.()
  }, [userId])
}

export async function logout() {
  // drop this device's push subscription so the next person here doesn't get our pings
  await forgetPushSubscription()
  pb.realtime.unsubscribe()
  pb.authStore.clear()
}
