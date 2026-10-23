/// <reference path="../pb_data/types.d.ts" />

// Every in-app notification is also sent as a web push (if the user subscribed),
// and invites/reminders as a Discord DM for users who linked Discord.
onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  u.sendPush(e.app, e.record)
  u.sendDiscord(e.app, e.record)
  e.next()
}, "notifications")

// Public VAPID key so the frontend can subscribe to push.
routerAdd("GET", "/api/tav/push-key", (e) => {
  return e.json(200, { publicKey: $os.getenv("VAPID_PUBLIC_KEY") || "" })
})

// Lets a signed-in user send themselves a test notification.
routerAdd("POST", "/api/tav/test-push", (e) => {
  const u = require(`${__hooks}/utils.js`)
  u.notify(e.app, [e.auth.id], {
    title: "Test notification",
    body: "Notifications are working 🎉",
    url: "/settings",
    kind: "test",
  })
  return e.json(200, { ok: true })
}, $apis.requireAuth("users"))

// Marks all of the signed-in user's notifications as read.
routerAdd("POST", "/api/tav/notifications/read-all", (e) => {
  const unread = e.app.findRecordsByFilter(
    "notifications", "user = {:user} && read = false", "", 0, 0, { user: e.auth.id },
  )
  for (const n of unread) {
    n.set("read", true)
    e.app.save(n)
  }
  return e.json(200, { updated: unread.length })
}, $apis.requireAuth("users"))
