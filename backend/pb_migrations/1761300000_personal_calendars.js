/// <reference path="../pb_data/types.d.ts" />

// Personal calendars, event visibility and invites.
//
//  - every approved user owns one personal calendar (calendars.personal = true, owner = user);
//    only the owner can write to it, admins get no special access to it
//  - events on a personal calendar have a visibility:
//      private -> only the owner (and invited guests)
//      busy    -> others only see a time block (served by GET /api/tav/busy, never the record)
//      public  -> every approved member sees the full event
//  - events.guests are invited users; they can always see the event. Their answer lives in rsvps
//    (status "invited" until they reply). Invites are created through POST /api/tav/invite.

const APPROVED = '@request.auth.status = "approved"'
const ADMIN = '@request.auth.role = "admin"'
const ME = "@request.auth.id"

const sharedView = (c) =>
  `(${c}.personal = false && (${ADMIN} || (${APPROVED} && (${c}.viewers.id ?= ${ME} || ${c}.editors.id ?= ${ME}))))`
const sharedEdit = (c) =>
  `(${c}.personal = false && (${ADMIN} || (${APPROVED} && ${c}.editors.id ?= ${ME})))`
const ownCal = (c) => `(${c}.personal = true && ${c}.owner = ${ME})`

/** Who may see an event; `p` is the path prefix to the event ("" or "event."). */
const eventView = (p) =>
  `(${sharedView(p + "calendar")} || ${ownCal(p + "calendar")}` +
  ` || (${APPROVED} && ${p}calendar.personal = true && ${p}visibility = "public")` +
  ` || (${APPROVED} && ${p}guests.id ?= ${ME}))`
const eventEdit = (p) => `(${sharedEdit(p + "calendar")} || ${ownCal(p + "calendar")})`

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")

  // ---- calendars -----------------------------------------------------------------
  const calendars = app.findCollectionByNameOrId("calendars")
  calendars.fields.add(new BoolField({ name: "personal" }))
  calendars.fields.add(new RelationField({ name: "owner", collectionId: users.id, maxSelect: 1, cascadeDelete: true }))
  calendars.indexes = [...calendars.indexes, "CREATE UNIQUE INDEX idx_calendars_personal_owner ON calendars (owner) WHERE personal = 1"]
  calendars.listRule =
    `(personal = false && (${ADMIN} || (${APPROVED} && (viewers.id ?= ${ME} || editors.id ?= ${ME}))))` +
    ` || (personal = true && ${APPROVED})`
  calendars.viewRule = calendars.listRule
  calendars.createRule = `${ADMIN} && personal = false`
  // admins manage shared calendars; owners may only rename/recolor their personal one
  calendars.updateRule =
    `(${ADMIN} && personal = false && @request.body.personal:isset = false && @request.body.owner:isset = false)` +
    ` || (personal = true && owner = ${ME} && @request.body.personal:isset = false && @request.body.owner:isset = false` +
    ` && @request.body.viewers:isset = false && @request.body.editors:isset = false)`
  calendars.deleteRule = `${ADMIN} && personal = false`
  app.save(calendars)

  // ---- events --------------------------------------------------------------------
  const events = app.findCollectionByNameOrId("events")
  events.fields.add(new SelectField({ name: "visibility", values: ["private", "busy", "public"], maxSelect: 1 }))
  events.fields.add(new RelationField({ name: "guests", collectionId: users.id, maxSelect: 999 }))
  events.listRule = eventView("")
  events.viewRule = eventView("")
  events.createRule = `${eventEdit("")} && created_by = ${ME} && @request.body.guests:isset = false`
  events.updateRule = `${eventEdit("")} && @request.body.created_by:isset = false && @request.body.guests:isset = false`
  events.deleteRule = eventEdit("")
  app.save(events)

  // ---- rsvps / invites -----------------------------------------------------------
  const rsvps = app.findCollectionByNameOrId("rsvps")
  const status = rsvps.fields.getByName("status")
  status.values = ["invited", "going", "maybe", "no"]
  rsvps.fields.add(new RelationField({ name: "invited_by", collectionId: users.id, maxSelect: 1 }))
  rsvps.fields.add(new TextField({ name: "message", max: 500 }))
  rsvps.listRule = `user = ${ME} || ${eventView("event.")}`
  rsvps.viewRule = rsvps.listRule
  rsvps.createRule = `user = ${ME} && status != "invited" && @request.body.invited_by:isset = false && ${eventView("event.")}`
  rsvps.updateRule = `user = ${ME} && @request.body.user:isset = false && @request.body.event:isset = false` +
    ` && @request.body.invited_by:isset = false && @request.body.status != "invited"`
  app.save(rsvps)

  // ---- notes on personal calendars are private to the owner -----------------------
  const notes = app.findCollectionByNameOrId("notes")
  notes.listRule = `${sharedView("calendar")} || ${ownCal("calendar")}`
  notes.viewRule = notes.listRule
  notes.createRule = `(${sharedEdit("calendar")} || ${ownCal("calendar")}) && created_by = ${ME}`
  notes.updateRule = `(${sharedEdit("calendar")} || ${ownCal("calendar")}) && @request.body.created_by:isset = false`
  notes.deleteRule = `${sharedEdit("calendar")} || ${ownCal("calendar")}`
  app.save(notes)

  const reminders = app.findCollectionByNameOrId("reminders")
  reminders.createRule = `${APPROVED} && user = ${ME} && (event = "" || ${eventView("event.")})`
  app.save(reminders)

  // ---- personal calendars for everyone already approved --------------------------
  for (const u of app.findRecordsByFilter("users", 'status = "approved"', "", 0, 0)) {
    const cal = new Record(calendars)
    cal.set("name", u.getString("name") || "My calendar")
    cal.set("color", u.getString("color"))
    cal.set("personal", true)
    cal.set("owner", u.id)
    cal.set("editors", [u.id])
    app.save(cal)
  }
}, (app) => {
  for (const c of app.findRecordsByFilter("calendars", "personal = true", "", 0, 0)) app.delete(c)
  const calendars = app.findCollectionByNameOrId("calendars")
  calendars.fields.removeByName("personal")
  calendars.fields.removeByName("owner")
  calendars.indexes = calendars.indexes.filter((i) => !i.includes("idx_calendars_personal_owner"))
  app.save(calendars)
  const events = app.findCollectionByNameOrId("events")
  events.fields.removeByName("visibility")
  events.fields.removeByName("guests")
  app.save(events)
  const rsvps = app.findCollectionByNameOrId("rsvps")
  rsvps.fields.removeByName("invited_by")
  rsvps.fields.removeByName("message")
  app.save(rsvps)
})
