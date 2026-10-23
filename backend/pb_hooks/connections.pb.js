/// <reference path="../pb_data/types.d.ts" />

// Friend connections. A -> B is A's side (with A's label for B). It's "pending" until
// B adds A back, which flips both sides to "accepted". Removing either side removes both.

onRecordCreate((e) => {
  let reverse = null
  try {
    reverse = e.app.findFirstRecordByFilter("connections", "from = {:to} && to = {:from}", {
      to: e.record.getString("to"), from: e.record.getString("from"),
    })
  } catch (_) { /* no reverse yet */ }
  e.record.set("status", reverse ? "accepted" : "pending")
  e.next()
}, "connections")

onRecordAfterCreateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  const fromId = e.record.getString("from")
  const toId = e.record.getString("to")
  const from = e.app.findRecordById("users", fromId)

  if (e.record.getString("status") === "accepted") {
    // this was B accepting A's request
    const reverse = e.app.findFirstRecordByFilter("connections", "from = {:to} && to = {:from}", { to: toId, from: fromId })
    if (reverse.getString("status") !== "accepted") {
      reverse.set("status", "accepted")
      e.app.save(reverse)
    }
    u.notify(e.app, [toId], {
      title: `${u.nameOf(from)} accepted your friend request`,
      url: "/people",
      kind: "friend",
    })
    u.refreshUserAudiences(e.app, fromId)
    u.refreshUserAudiences(e.app, toId)
  } else {
    u.notify(e.app, [toId], {
      title: `${u.nameOf(from)} wants to add you`,
      body: "Accept to see each other's plans.",
      url: "/people",
      kind: "friend",
    })
  }
  e.next()
}, "connections")

// a new label changes what that person can see of your events
onRecordAfterUpdateSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  if (e.record.original().getString("label") !== e.record.getString("label")) {
    u.refreshUserAudiences(e.app, e.record.getString("from"))
  }
  e.next()
}, "connections")

onRecordAfterDeleteSuccess((e) => {
  const u = require(`${__hooks}/utils.js`)
  const fromId = e.record.getString("from")
  const toId = e.record.getString("to")
  try {
    const reverse = e.app.findFirstRecordByFilter("connections", "from = {:to} && to = {:from}", { to: toId, from: fromId })
    e.app.delete(reverse) // re-enters this hook, finds nothing, stops
  } catch (_) { /* already gone */ }
  u.refreshUserAudiences(e.app, fromId)
  u.refreshUserAudiences(e.app, toId)
  e.next()
}, "connections")

// Your label for someone is yours alone: hide it from the other person.
onRecordEnrich((e) => {
  const auth = e.requestInfo && e.requestInfo.auth
  if (!auth || auth.id !== e.record.getString("from")) e.record.hide("label")
  e.next()
}, "connections")
