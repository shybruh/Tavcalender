/// <reference path="../pb_data/types.d.ts" />

// Signup approval flow:
//  - the very first user becomes an approved admin
//  - everyone else starts as a pending member and the admins get notified
//  - the user is notified once an admin approves them

onRecordCreate((e) => {
  const isFirst = e.app.countRecords("users") === 0
  if (isFirst) {
    e.record.set("role", "admin")
    e.record.set("status", "approved")
  } else {
    if (!e.record.getString("role")) e.record.set("role", "member")
    if (!e.record.getString("status")) e.record.set("status", "pending")
  }
  if (!e.record.getString("color")) {
    const palette = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899"]
    e.record.set("color", palette[Math.floor(Math.random() * palette.length)])
  }
  e.next()
}, "users")

onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  if (e.record.getString("status") === "approved") u.ensurePersonalCalendar(e.app, e.record)
  if (e.record.getString("status") === "pending") {
    const name = e.record.getString("name") || e.record.getString("email")
    u.notify(e.app, u.adminIds(e.app), {
      title: "New signup waiting",
      body: `${name} wants to join. Tap to review.`,
      url: "/admin",
      kind: "signup",
    })
  }
  e.next()
}, "users")

onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  const before = e.record.original().getString("status")
  const after = e.record.getString("status")
  if (before !== "approved" && after === "approved") {
    u.ensurePersonalCalendar(e.app, e.record)
    u.notify(e.app, [e.record.id], {
      title: "You're in!",
      body: "Your account was approved. Welcome aboard.",
      url: "/",
      kind: "approved",
    })
  }
  e.next()
}, "users")

// Admins need to see emails to review signups (PocketBase hides them by default).
onRecordEnrich((e) => {
  const auth = e.requestInfo && e.requestInfo.auth
  if (auth && auth.getString("role") === "admin") {
    e.record.ignoreEmailVisibility(true)
  }
  e.next()
}, "users")
