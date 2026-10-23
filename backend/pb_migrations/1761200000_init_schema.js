/// <reference path="../pb_data/types.d.ts" />

// Initial Tavcalender schema.
//
// Access model:
//  - users.status gates everything: only "approved" users can read/write data.
//  - users.role = "admin" can manage users + calendars and sees everything.
//  - each calendar has `viewers` and `editors` (relations to users) that the admin controls.

const APPROVED = '@request.auth.status = "approved"'
const ADMIN = '@request.auth.role = "admin"'
// rule fragment: auth user may view a record whose calendar is reachable via `path`
const canView = (path) =>
  `(${ADMIN} || (${APPROVED} && (${path}.viewers.id ?= @request.auth.id || ${path}.editors.id ?= @request.auth.id)))`
const canEdit = (path) =>
  `(${ADMIN} || (${APPROVED} && ${path}.editors.id ?= @request.auth.id))`

const timestamps = [
  { type: "autodate", name: "created", onCreate: true, onUpdate: false },
  { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
]

migrate((app) => {
  // ---- users: add role + status ---------------------------------------------
  const users = app.findCollectionByNameOrId("users")
  users.fields.add(new SelectField({
    name: "role", values: ["member", "admin"], maxSelect: 1,
  }))
  users.fields.add(new SelectField({
    name: "status", values: ["pending", "approved", "rejected"], maxSelect: 1,
  }))
  users.fields.add(new TextField({ name: "color", max: 20 }))

  const selfOrAdmin = `id = @request.auth.id || ${ADMIN}`
  users.listRule = `${selfOrAdmin} || (${APPROVED} && status = "approved")`
  users.viewRule = users.listRule
  // public signup, but role/status are server controlled (see pb_hooks/users.pb.js)
  users.createRule = '@request.body.role:isset = false && @request.body.status:isset = false'
  users.updateRule = `${ADMIN} || (id = @request.auth.id && @request.body.role:isset = false && @request.body.status:isset = false)`
  users.deleteRule = `${ADMIN} || id = @request.auth.id`
  app.save(users)

  // ---- calendars --------------------------------------------------------------
  const calendars = new Collection({
    type: "base",
    name: "calendars",
    fields: [
      { type: "text", name: "name", required: true, max: 80 },
      { type: "text", name: "description", max: 500 },
      { type: "text", name: "color", max: 20 },
      { type: "relation", name: "viewers", collectionId: users.id, maxSelect: 999 },
      { type: "relation", name: "editors", collectionId: users.id, maxSelect: 999 },
      ...timestamps,
    ],
  })
  calendars.listRule = `${ADMIN} || (${APPROVED} && (viewers.id ?= @request.auth.id || editors.id ?= @request.auth.id))`
  calendars.viewRule = calendars.listRule
  calendars.createRule = ADMIN
  calendars.updateRule = ADMIN
  calendars.deleteRule = ADMIN
  app.save(calendars)

  // ---- events -----------------------------------------------------------------
  const events = new Collection({
    type: "base",
    name: "events",
    fields: [
      { type: "relation", name: "calendar", collectionId: calendars.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "text", name: "title", required: true, max: 200 },
      { type: "text", name: "description", max: 5000 },
      { type: "text", name: "location", max: 300 },
      { type: "date", name: "start", required: true },
      { type: "date", name: "end" },
      { type: "bool", name: "all_day" },
      { type: "relation", name: "created_by", collectionId: users.id, maxSelect: 1 },
      ...timestamps,
    ],
    indexes: ["CREATE INDEX idx_events_start ON events (start)"],
  })
  events.listRule = canView("calendar")
  events.viewRule = canView("calendar")
  events.createRule = `${canEdit("calendar")} && created_by = @request.auth.id`
  events.updateRule = `${canEdit("calendar")} && @request.body.created_by:isset = false`
  events.deleteRule = canEdit("calendar")
  app.save(events)

  // ---- rsvps --------------------------------------------------------------------
  const rsvps = new Collection({
    type: "base",
    name: "rsvps",
    fields: [
      { type: "relation", name: "event", collectionId: events.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "select", name: "status", values: ["going", "maybe", "no"], maxSelect: 1, required: true },
      ...timestamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_rsvps_event_user ON rsvps (event, user)"],
  })
  rsvps.listRule = canView("event.calendar")
  rsvps.viewRule = canView("event.calendar")
  rsvps.createRule = `user = @request.auth.id && ${canView("event.calendar")}`
  rsvps.updateRule = `user = @request.auth.id && @request.body.user:isset = false && @request.body.event:isset = false`
  rsvps.deleteRule = "user = @request.auth.id"
  app.save(rsvps)

  // ---- notes ------------------------------------------------------------------
  const notes = new Collection({
    type: "base",
    name: "notes",
    fields: [
      { type: "relation", name: "calendar", collectionId: calendars.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "text", name: "title", required: true, max: 200 },
      { type: "text", name: "content", max: 20000 },
      { type: "date", name: "date" }, // optional: pin a note to a day
      { type: "bool", name: "pinned" },
      { type: "relation", name: "created_by", collectionId: users.id, maxSelect: 1 },
      ...timestamps,
    ],
  })
  notes.listRule = canView("calendar")
  notes.viewRule = canView("calendar")
  notes.createRule = `${canEdit("calendar")} && created_by = @request.auth.id`
  notes.updateRule = `${canEdit("calendar")} && @request.body.created_by:isset = false`
  notes.deleteRule = canEdit("calendar")
  app.save(notes)

  // ---- reminders (personal) ---------------------------------------------------
  const reminders = new Collection({
    type: "base",
    name: "reminders",
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "relation", name: "event", collectionId: events.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "title", required: true, max: 200 },
      { type: "date", name: "remind_at", required: true },
      // when set together with `event`, remind_at is kept at event.start - offset (see pb_hooks)
      { type: "number", name: "offset_minutes", onlyInt: true, min: 0 },
      { type: "bool", name: "sent" },
      ...timestamps,
    ],
    indexes: ["CREATE INDEX idx_reminders_due ON reminders (sent, remind_at)"],
  })
  const own = `${APPROVED} && user = @request.auth.id`
  reminders.listRule = own
  reminders.viewRule = own
  reminders.createRule = `${own} && (event = "" || ${canView("event.calendar")})`
  reminders.updateRule = `${own} && @request.body.user:isset = false`
  reminders.deleteRule = own
  app.save(reminders)

  // ---- notifications (in-app inbox, written only by server hooks) ------------
  const notifications = new Collection({
    type: "base",
    name: "notifications",
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "text", name: "title", required: true, max: 200 },
      { type: "text", name: "body", max: 1000 },
      { type: "text", name: "url", max: 500 },
      { type: "text", name: "kind", max: 40 },
      { type: "bool", name: "read" },
      ...timestamps,
    ],
  })
  notifications.listRule = "user = @request.auth.id"
  notifications.viewRule = "user = @request.auth.id"
  notifications.createRule = null
  notifications.updateRule = "user = @request.auth.id && @request.body.user:isset = false"
  notifications.deleteRule = "user = @request.auth.id"
  app.save(notifications)

  // ---- web push subscriptions -------------------------------------------------
  const subs = new Collection({
    type: "base",
    name: "push_subscriptions",
    fields: [
      { type: "relation", name: "user", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "text", name: "endpoint", required: true, max: 1000 },
      { type: "json", name: "keys", required: true, maxSize: 2000 },
      { type: "text", name: "user_agent", max: 300 },
      ...timestamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_push_endpoint ON push_subscriptions (endpoint)"],
  })
  subs.listRule = "user = @request.auth.id"
  subs.viewRule = "user = @request.auth.id"
  subs.createRule = "user = @request.auth.id"
  subs.updateRule = null
  subs.deleteRule = "user = @request.auth.id"
  app.save(subs)
}, (app) => {
  for (const name of ["push_subscriptions", "notifications", "reminders", "notes", "rsvps", "events", "calendars"]) {
    app.delete(app.findCollectionByNameOrId(name))
  }
  const users = app.findCollectionByNameOrId("users")
  users.fields.removeByName("role")
  users.fields.removeByName("status")
  users.fields.removeByName("color")
  app.save(users)
})
