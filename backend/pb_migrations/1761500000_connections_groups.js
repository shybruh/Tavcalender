/// <reference path="../pb_data/types.d.ts" />

// Friends & groups model.
//
//  connections     A -> B with A's own label for B (friend / close_friend / family / partner).
//                  A request is pending until B adds A back; then both sides are "accepted".
//  calendars       personal = true: one per user, holds all of that user's events.
//                  personal = false: a *group*. Anyone can create one and becomes its owner.
//                  `members` can post; only the owner approves join requests, removes posts,
//                  edits or deletes the group (membership changes go through /api/tav/groups/*).
//  events          always live on the author's personal calendar. `audience` picks who sees them:
//                  private / partner / close_friends / family / friends / groups (+ `groups`).
//                  The server resolves that into `audience_users` (pb_hooks/audience.pb.js);
//                  everyone connected to the author who can't see it gets a busy block instead.
//  group_requests  "request" (someone asks to join, owner decides) or "invite" (a member invites,
//                  the invitee decides).

const APPROVED = '@request.auth.status = "approved"'
const ME = "@request.auth.id"

/** Who may see an event; `p` is the path prefix to the event ("" or "event."). */
const eventView = (p) =>
  `(${APPROVED} && (${p}created_by = ${ME} || ${p}audience_users.id ?= ${ME} || ${p}guests.id ?= ${ME}))`

const groupMember = (c) => `(${c}.personal = false && ${c}.members.id ?= ${ME})`
const ownCal = (c) => `(${c}.personal = true && ${c}.owner = ${ME})`

const timestamps = [
  { type: "autodate", name: "created", onCreate: true, onUpdate: false },
  { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
]

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const calendars = app.findCollectionByNameOrId("calendars")
  const events = app.findCollectionByNameOrId("events")

  // ---- calendars: members replace viewers/editors ------------------------------------
  calendars.fields.add(new RelationField({ name: "members", collectionId: users.id, maxSelect: 999 }))
  app.save(calendars)

  const firstAdmin = app.findRecordsByFilter("users", 'role = "admin"', "created", 1, 0)[0]
  for (const cal of app.findRecordsByFilter("calendars", "", "", 0, 0)) {
    const members = new Set([...cal.getStringSlice("viewers"), ...cal.getStringSlice("editors")])
    if (cal.getBool("personal")) {
      cal.set("members", [cal.getString("owner")])
    } else {
      const owner = cal.getString("owner") || (firstAdmin ? firstAdmin.id : "")
      if (owner) members.add(owner)
      cal.set("owner", owner)
      cal.set("members", [...members])
    }
    app.save(cal)
  }

  // ---- connections: everyone already approved starts out as mutual friends -------------
  const connections = new Collection({
    type: "base",
    name: "connections",
    fields: [
      { type: "relation", name: "from", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "to", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "select", name: "label", values: ["friend", "close_friend", "family", "partner"], maxSelect: 1, required: true },
      { type: "select", name: "status", values: ["pending", "accepted"], maxSelect: 1 },
      ...timestamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_connections_pair ON connections (`from`, `to`)"],
  })
  connections.listRule = `from = ${ME} || to = ${ME}`
  connections.viewRule = connections.listRule
  connections.createRule = `${APPROVED} && from = ${ME} && to != ${ME} && to.status = "approved" && @request.body.status:isset = false`
  connections.updateRule = `from = ${ME} && @request.body.status:isset = false && @request.body.from:isset = false && @request.body.to:isset = false`
  connections.deleteRule = `from = ${ME} || to = ${ME}`
  app.save(connections)

  const approved = app.findRecordsByFilter("users", 'status = "approved"', "", 0, 0)
  for (const a of approved) {
    for (const b of approved) {
      if (a.id === b.id) continue
      const c = new Record(connections)
      c.set("from", a.id)
      c.set("to", b.id)
      c.set("label", "friend")
      c.set("status", "accepted")
      app.save(c)
    }
  }

  // ---- group requests / invites --------------------------------------------------------
  const groupRequests = new Collection({
    type: "base",
    name: "group_requests",
    fields: [
      { type: "relation", name: "group", collectionId: calendars.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "select", name: "kind", values: ["request", "invite"], maxSelect: 1, required: true },
      { type: "relation", name: "invited_by", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      ...timestamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_group_requests_pair ON group_requests (`group`, `user`)"],
  })
  groupRequests.listRule = `user = ${ME} || group.owner = ${ME} || invited_by = ${ME}`
  groupRequests.viewRule = groupRequests.listRule
  groupRequests.createRule = null // via /api/tav/groups/*
  groupRequests.updateRule = null
  groupRequests.deleteRule = `user = ${ME} || group.owner = ${ME}`
  app.save(groupRequests)

  // ---- events: audience instead of calendar/visibility ---------------------------------
  events.fields.add(new SelectField({
    name: "audience", maxSelect: 1,
    values: ["private", "partner", "close_friends", "family", "friends", "groups"],
  }))
  events.fields.add(new RelationField({ name: "groups", collectionId: calendars.id, maxSelect: 99 }))
  events.fields.add(new RelationField({ name: "audience_users", collectionId: users.id, maxSelect: 9999 }))
  app.save(events)

  // move every event onto its author's personal calendar
  const personalOf = {}
  for (const c of app.findRecordsByFilter("calendars", "personal = true", "", 0, 0)) personalOf[c.getString("owner")] = c.id
  for (const ev of app.findRecordsByFilter("events", "", "", 0, 0)) {
    const cal = app.findRecordById("calendars", ev.getString("calendar"))
    const author = ev.getString("created_by")
    if (cal.getBool("personal")) {
      const vis = ev.getString("visibility")
      ev.set("audience", vis === "public" ? "friends" : "private")
    } else {
      ev.set("audience", "groups")
      ev.set("groups", [cal.id])
      if (personalOf[author]) ev.set("calendar", personalOf[author])
    }
    // audience_users is filled in by the hooks the first time the event is saved through the app;
    // resolve it here too so nothing disappears right after the upgrade
    ev.set("audience_users", resolveAudience(app, ev))
    app.save(ev)
  }

  // ---- rules ------------------------------------------------------------------------------
  calendars.listRule = `(personal = true && owner = ${ME}) || (personal = false && ${APPROVED})`
  calendars.viewRule = calendars.listRule
  calendars.createRule = `${APPROVED} && personal = false && owner = ${ME}`
  calendars.updateRule = `owner = ${ME} && @request.body.personal:isset = false && @request.body.owner:isset = false && @request.body.members:isset = false`
  calendars.deleteRule = `personal = false && owner = ${ME}`
  app.save(calendars)

  events.listRule = eventView("")
  events.viewRule = eventView("")
  const noServerFields = "@request.body.audience_users:isset = false && @request.body.guests:isset = false"
  events.createRule = `${APPROVED} && created_by = ${ME} && ${ownCal("calendar")} && ${noServerFields}`
  events.updateRule = `created_by = ${ME} && @request.body.created_by:isset = false && @request.body.calendar:isset = false && ${noServerFields}`
  events.deleteRule = `created_by = ${ME}`
  app.save(events)

  const rsvps = app.findCollectionByNameOrId("rsvps")
  rsvps.listRule = `user = ${ME} || ${eventView("event.")}`
  rsvps.viewRule = rsvps.listRule
  rsvps.createRule = `user = ${ME} && status != "invited" && @request.body.invited_by:isset = false && ${eventView("event.")}`
  app.save(rsvps)

  const reminders = app.findCollectionByNameOrId("reminders")
  reminders.createRule = `${APPROVED} && user = ${ME} && (event = "" || ${eventView("event.")})`
  app.save(reminders)

  const notes = app.findCollectionByNameOrId("notes")
  notes.listRule = `${APPROVED} && (${ownCal("calendar")} || ${groupMember("calendar")})`
  notes.viewRule = notes.listRule
  notes.createRule = `${APPROVED} && created_by = ${ME} && (${ownCal("calendar")} || ${groupMember("calendar")})`
  notes.updateRule = `created_by = ${ME} && @request.body.created_by:isset = false && @request.body.calendar:isset = false`
  notes.deleteRule = `created_by = ${ME} || (calendar.personal = false && calendar.owner = ${ME})`
  app.save(notes)

  // ---- drop the old access fields ---------------------------------------------------------
  calendars.fields.removeByName("viewers")
  calendars.fields.removeByName("editors")
  app.save(calendars)
  events.fields.removeByName("visibility")
  app.save(events)
}, (app) => {
  throw new Error("1761500000_connections_groups can't be rolled back automatically; restore a backup instead")
})

/** Same logic as pb_hooks/utils.js resolveAudience (migrations can't load hook files). */
function resolveAudience(app, ev) {
  const author = ev.getString("created_by")
  const audience = ev.getString("audience")
  const out = new Set()
  if (audience === "groups") {
    for (const gid of ev.getStringSlice("groups")) {
      try {
        const g = app.findRecordById("calendars", gid)
        for (const m of g.getStringSlice("members")) out.add(m)
      } catch (_) { /* gone */ }
    }
  } else if (audience && audience !== "private") {
    const label = { partner: "partner", close_friends: "close_friend", family: "family" }[audience]
    const filter = label
      ? "from = {:a} && status = 'accepted' && label = {:l}"
      : "from = {:a} && status = 'accepted'"
    for (const c of app.findRecordsByFilter("connections", filter, "", 0, 0, { a: author, l: label || "" })) {
      out.add(c.getString("to"))
    }
  }
  out.delete(author)
  return [...out]
}
