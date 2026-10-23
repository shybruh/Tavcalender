import { pb } from "./pb"

export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on"

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true

export async function getPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iOS only exposes web push to apps added to the home screen
    return isIos() && !isStandalone() ? "needs-install" : "unsupported"
  }
  if (Notification.permission === "denied") return "denied"
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? "on" : "off"
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== "granted") throw new Error("Notifications were not allowed")

  const { publicKey } = await pb.send<{ publicKey: string }>("/api/tav/push-key", {})
  if (!publicKey) throw new Error("Push isn't configured on the server (missing VAPID_PUBLIC_KEY)")

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  const json = sub.toJSON()

  // upsert by endpoint (a device may have been used by another account before)
  const existing = await pb.collection("push_subscriptions").getFirstListItem(pb.filter("endpoint = {:e}", { e: json.endpoint })).catch(() => null)
  if (!existing) {
    await pb.collection("push_subscriptions").create({
      user: pb.authStore.record!.id,
      endpoint: json.endpoint,
      keys: json.keys,
      user_agent: navigator.userAgent.slice(0, 300),
    })
  }
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  const existing = await pb.collection("push_subscriptions").getFirstListItem(pb.filter("endpoint = {:e}", { e: sub.endpoint })).catch(() => null)
  if (existing) await pb.collection("push_subscriptions").delete(existing.id)
  await sub.unsubscribe()
}

/** Called on logout so the next person on this device doesn't get our pushes. */
export async function forgetPushSubscription() {
  try {
    await disablePush()
  } catch {
    /* ignore */
  }
}
