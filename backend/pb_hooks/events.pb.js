/// <reference path="../pb_data/types.d.ts" />

// Event notifications, invites, busy times, and keeping event-linked reminders in sync.

onRecordCreateRequest((e) => {
  e.next()

  // only group posts ping people; friends/family events just show up on their calendars
  const u = require(`${__hooks}/utils.js`)
  const ev = e.record
  if (ev.getString("audience") !== "groups") return
  const when = u.fmtDate(ev.getDateTime("start"), ev.getBool("all_day"))
  for (const gid of ev.getStringSlice("groups")) {
    const g = e.app.findRecordById("calendars", gid)
    u.notify(e.app, g.getStringSlice("members"), {
      title: `${u.nameOf(e.auth)} posted “${ev.getString("title")}”`,
      body: `${g.getString("name")} · ${when}`,
      url: `/event/${ev.id}`,
      kind: "event",
    }, e.auth ? e.auth.id : "")

    // announce in Discord channels connected to this group, if the owner allowed it
    for (const ch of e.app.findRecordsByFilter("discord_channels", "group = {:g} && announce = true", "", 0, 0, { g: gid })) {
      u.botPost(e.app, "/announce", {
        channel_id: ch.getString("channel_id"),
        event_id: ev.id,
        title: ev.getString("title"),
        when,
        where: ev.getString("location"),
        by: u.nameOf(e.auth),
        group: g.getString("name"),
        url: `${u.appUrl(e.app)}/event/${ev.id}`,
      })
    }
  }
}, "events")

onRecordUpdateRequest((e) => {
  const old = e.record.original()
  const before = {
    start: old.getString("start"),
    title: old.getString("title"),
    location: old.getString("location"),
  }

  e.next()

  const u = require(`${__hooks}/utils.js`)
  const ev = e.record
  const changed = before.start !== ev.getString("start") ||
    before.title !== ev.getString("title") ||
    before.location !== ev.getString("location")
  if (!changed) return

  // tell the people who said they're going / maybe, and anyone still deciding on an invite
  const rsvps = e.app.findRecordsByFilter(
    "rsvps", "event = {:event} && status != 'no'", "", 0, 0, { event: ev.id },
  )
  const who = e.auth ? (e.auth.getString("name") || "Someone") : "Someone"
  u.notify(e.app, rsvps.map((r) => r.getString("user")), {
    title: `“${ev.getString("title")}” was updated`,
    body: `${who} changed it · ${u.fmtDate(ev.getDateTime("start"), ev.getBool("all_day"))}`,
    url: `/event/${ev.id}`,
    kind: "event",
  }, e.auth ? e.auth.id : "")
}, "events")

// whenever an event's start moves, shift its unsent offset-based reminders
onRecordAfterUpdateSuccess((e) => {
  if (e.record.original().getString("start") === e.record.getString("start")) {
    return e.next()
  }
  const start = e.record.getDateTime("start")
  const reminders = e.app.findRecordsByFilter(
    "reminders", "event = {:event} && sent = false && offset_minutes > 0", "", 0, 0, { event: e.record.id },
  )
  for (const r of reminders) {
    r.set("remind_at", start.add(-r.getInt("offset_minutes") * 60 * 1000 * 1000 * 1000))
    e.app.save(r)
  }
  e.next()
}, "events")

// RSVP -> let the event creator know
onRecordCreateRequest((e) => {
  e.next()

  const u = require(`${__hooks}/utils.js`)
  const ev = e.app.findRecordById("events", e.record.getString("event"))
  const who = e.auth ? (e.auth.getString("name") || "Someone") : "Someone"
  u.notify(e.app, [ev.getString("created_by")], {
    title: `${who} ${u.RSVP_LABEL[e.record.getString("status")]} “${ev.getString("title")}”`,
    url: `/event/${ev.id}`,
    kind: "rsvp",
  }, e.auth ? e.auth.id : "")
}, "rsvps")

// answering an invite (or changing an answer) -> tell whoever invited you, or the creator
onRecordUpdateRequest((e) => {
  const before = e.record.original().getString("status")
  e.next()

  const after = e.record.getString("status")
  if (before === after) return
  const u = require(`${__hooks}/utils.js`)
  const ev = e.app.findRecordById("events", e.record.getString("event"))
  const who = e.auth ? (e.auth.getString("name") || "Someone") : "Someone"
  u.notify(e.app, [e.record.getString("invited_by") || ev.getString("created_by")], {
    title: `${who} ${u.RSVP_LABEL[after]} “${ev.getString("title")}”`,
    url: `/event/${ev.id}`,
    kind: "rsvp",
  }, e.auth ? e.auth.id : "")
}, "rsvps")

// POST /api/tav/invite { event, users: [id], message }
// The event's creator invites friends to it. `ask_free` lists invitees who look busy then,
// so their notification asks whether they're free instead of a plain invite.
routerAdd("POST", "/api/tav/invite", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const auth = e.auth
  if (auth.getString("status") !== "approved") throw new ForbiddenError("Not approved")

  const body = e.requestInfo().body
  const ev = e.app.findRecordById("events", String(body.event || ""))
  if (ev.getString("created_by") !== auth.id) throw new ForbiddenError("Only the organiser can invite people")
  const askFree = Array.isArray(body.ask_free) ? body.ask_free.map(String) : []

  const message = String(body.message || "").slice(0, 500)
  const ids = Array.isArray(body.users) ? body.users.map(String) : []
  const guests = ev.getStringSlice("guests")
  const rsvpCol = e.app.findCollectionByNameOrId("rsvps")
  const invited = []

  for (const id of ids) {
    if (id === auth.id || guests.indexOf(id) !== -1) continue
    let user
    try { user = e.app.findRecordById("users", id) } catch (_) { continue }
    if (user.getString("status") !== "approved") continue

    guests.push(id)
    let existing = null
    try {
      existing = e.app.findFirstRecordByFilter("rsvps", "event = {:e} && user = {:u}", { e: ev.id, u: id })
    } catch (_) { /* none */ }
    if (!existing) {
      const r = new Record(rsvpCol)
      r.set("event", ev.id)
      r.set("user", id)
      r.set("status", "invited")
      r.set("invited_by", auth.id)
      r.set("message", message)
      e.app.save(r)
    }
    invited.push(id)
  }

  if (invited.length) {
    ev.set("guests", guests)
    e.app.save(ev)
    const who = auth.getString("name") || "Someone"
    const when = u.fmtDate(ev.getDateTime("start"), ev.getBool("all_day"))
    const plain = invited.filter((id) => askFree.indexOf(id) === -1)
    const asking = invited.filter((id) => askFree.indexOf(id) !== -1)
    u.notify(e.app, plain, {
      title: `${who} invited you to “${ev.getString("title")}”`,
      body: message ? `${when} · “${message}”` : when,
      url: `/event/${ev.id}`,
      kind: "invite",
    })
    u.notify(e.app, asking, {
      title: `${who} is asking if you're free for “${ev.getString("title")}”`,
      body: `You have something on ${when}${message ? ` · “${message}”` : ""}`,
      url: `/event/${ev.id}`,
      kind: "invite",
    })
  }
  return e.json(200, { invited: invited.length })
}, $apis.requireAuth("users"))

// GET /api/tav/busy?from=...&to=...
// Time blocks (no titles or details) for events of people you're connected with that you
// aren't allowed to see. Events you *can* see come through the normal events API.
routerAdd("GET", "/api/tav/busy", (e) => {
  if (e.auth.getString("status") !== "approved") throw new ForbiddenError("Not approved")
  const from = e.request.url.query().get("from")
  const to = e.request.url.query().get("to")
  if (!from || !to) throw new BadRequestError("from and to are required")

  const friends = e.app.findRecordsByFilter(
    "connections", "to = {:me} && status = 'accepted'", "", 0, 0, { me: e.auth.id },
  ).map((c) => c.getString("from"))
  if (!friends.length) return e.json(200, [])

  const params = { me: e.auth.id, from, to }
  const who = friends.map((id, i) => { params["u" + i] = id; return `created_by = {:u${i}}` }).join(" || ")
  const rows = e.app.findRecordsByFilter(
    "events",
    `(${who}) && start < {:to} && (end >= {:from} || start >= {:from})` +
      " && audience_users.id != {:me} && guests.id != {:me}",
    "start", 5000, 0, params,
  )
  return e.json(200, rows.map((r) => ({
    id: r.id,
    user: r.getString("created_by"),
    start: r.getString("start"),
    end: r.getString("end"),
    all_day: r.getBool("all_day"),
  })))
}, $apis.requireAuth("users"))
