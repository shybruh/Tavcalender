/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { clientsClaim } from "workbox-core"

declare const self: ServiceWorkerGlobalScope

self.skipWaiting()
clientsClaim()

// app shell (offline-capable); API calls always go to the network
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/_\//],
  }),
)

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { title: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Tav Calendar", {
      body: data.body || "",
      icon: "/pwa-192x192.png",
      badge: "/badge-96x96.png",
      tag: data.tag,
      data: { url: data.url || "/" },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      // reuse an open tab if there is one
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          await client.focus()
          return (client as WindowClient).navigate(url)
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
