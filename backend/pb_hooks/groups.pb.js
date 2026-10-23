/// <reference path="../pb_data/types.d.ts" />

// Groups are calendars with personal = false. Anyone can create one and owns it.
// Membership only changes through the routes below (the members field is server-only).

onRecordCreate((e) => {
  if (!e.record.getBool("personal")) e.record.set("members", [e.record.getString("owner")])
  e.next()
}, "calendars")

// deleting a group: whatever was posted only there falls back to the author's private calendar
onRecordDelete((e) => {
  const affected = e.app.findRecordsByFilter("events", "groups.id ?= {:g}", "", 0, 0, { g: e.record.id }).map((r) => r.id)
  e.next()
  for (const id of affected) {
    try { e.app.save(e.app.findRecordById("events", id)) } catch (_) { /* gone */ }
  }
}, "calendars")

// Ask to join a group (the owner decides).
routerAdd("POST", "/api/tav/groups/{id}/join", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const g = e.app.findRecordById("calendars", e.request.pathValue("id"))
  if (g.getBool("personal")) throw new NotFoundError("Group not found")
  if (g.getStringSlice("members").indexOf(e.auth.id) !== -1) throw new BadRequestError("Already a member")

  let existing = null
  try {
    existing = e.app.findFirstRecordByFilter("group_requests", "group = {:g} && user = {:u}", { g: g.id, u: e.auth.id })
  } catch (_) { /* none */ }
  if (existing) {
    // they were invited already: asking to join just accepts the invite
    if (existing.getString("kind") === "invite") {
      g.set("members", [...g.getStringSlice("members"), e.auth.id])
      e.app.save(g)
      e.app.delete(existing)
      u.refreshAudiences(e.app, "groups.id ?= {:g}", { g: g.id })
      return e.json(200, { joined: true })
    }
    return e.json(200, { requested: true })
  }

  const r = new Record(e.app.findCollectionByNameOrId("group_requests"))
  r.set("group", g.id)
  r.set("user", e.auth.id)
  r.set("kind", "request")
  e.app.save(r)
  u.notify(e.app, [g.getString("owner")], {
    title: `${u.nameOf(e.auth)} asked to join “${g.getString("name")}”`,
    url: `/groups/${g.id}`,
    kind: "group",
  })
  return e.json(200, { requested: true })
}, $apis.requireAuth("users"))

// Members invite people (the invitee decides).
routerAdd("POST", "/api/tav/groups/{id}/invite", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const g = e.app.findRecordById("calendars", e.request.pathValue("id"))
  if (g.getBool("personal")) throw new NotFoundError("Group not found")
  const members = g.getStringSlice("members")
  if (members.indexOf(e.auth.id) === -1) throw new ForbiddenError("Only members can invite")

  const body = e.requestInfo().body
  const ids = Array.isArray(body.users) ? body.users.map(String) : []
  const col = e.app.findCollectionByNameOrId("group_requests")
  let invited = 0
  for (const id of ids) {
    if (members.indexOf(id) !== -1) continue
    let user
    try { user = e.app.findRecordById("users", id) } catch (_) { continue }
    if (user.getString("status") !== "approved") continue

    let existing = null
    try {
      existing = e.app.findFirstRecordByFilter("group_requests", "group = {:g} && user = {:u}", { g: g.id, u: id })
    } catch (_) { /* none */ }
    if (existing) {
      // they had asked to join and a member is inviting them: let them straight in
      if (existing.getString("kind") === "request") {
        members.push(id)
        e.app.delete(existing)
        invited++
      }
      continue
    }
    const r = new Record(col)
    r.set("group", g.id)
    r.set("user", id)
    r.set("kind", "invite")
    r.set("invited_by", e.auth.id)
    e.app.save(r)
    u.notify(e.app, [id], {
      title: `${u.nameOf(e.auth)} invited you to “${g.getString("name")}”`,
      body: "Join to see and post plans in this group.",
      url: "/people?tab=groups",
      kind: "group",
    })
    invited++
  }
  if (members.length !== g.getStringSlice("members").length) {
    g.set("members", members)
    e.app.save(g)
    u.refreshAudiences(e.app, "groups.id ?= {:g}", { g: g.id })
  }
  return e.json(200, { invited })
}, $apis.requireAuth("users"))

// Accept / decline a request (owner) or an invite (invitee).
routerAdd("POST", "/api/tav/group-requests/{id}/respond", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const r = e.app.findRecordById("group_requests", e.request.pathValue("id"))
  const g = e.app.findRecordById("calendars", r.getString("group"))
  const kind = r.getString("kind")
  const userId = r.getString("user")
  const allowed = kind === "request" ? g.getString("owner") === e.auth.id : userId === e.auth.id
  if (!allowed) throw new ForbiddenError("Not yours to answer")

  const accept = !!e.requestInfo().body.accept
  e.app.delete(r)
  if (accept) {
    const members = g.getStringSlice("members")
    if (members.indexOf(userId) === -1) {
      g.set("members", [...members, userId])
      e.app.save(g)
      u.refreshAudiences(e.app, "groups.id ?= {:g}", { g: g.id })
    }
    if (kind === "request") {
      u.notify(e.app, [userId], {
        title: `You're in “${g.getString("name")}”`,
        url: `/groups/${g.id}`,
        kind: "group",
      })
    } else {
      u.notify(e.app, [r.getString("invited_by")], {
        title: `${u.nameOf(e.auth)} joined “${g.getString("name")}”`,
        url: `/groups/${g.id}`,
        kind: "group",
      })
    }
  }
  return e.json(200, { accepted: accept })
}, $apis.requireAuth("users"))

// Leave a group (owners delete it instead).
routerAdd("POST", "/api/tav/groups/{id}/leave", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const g = u.loadGroup(e)
  if (g.getString("owner") === e.auth.id) throw new BadRequestError("Owners can't leave; delete the group instead")
  g.set("members", g.getStringSlice("members").filter((m) => m !== e.auth.id))
  e.app.save(g)
  u.refreshAudiences(e.app, "groups.id ?= {:g}", { g: g.id })
  return e.json(200, { left: true })
}, $apis.requireAuth("users"))

// Owner removes a member.
routerAdd("POST", "/api/tav/groups/{id}/remove-member", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const g = u.loadGroup(e)
  if (g.getString("owner") !== e.auth.id) throw new ForbiddenError("Only the owner can remove members")
  const target = String(e.requestInfo().body.user || "")
  if (target === e.auth.id) throw new BadRequestError("You can't remove yourself")
  g.set("members", g.getStringSlice("members").filter((m) => m !== target))
  e.app.save(g)
  u.refreshAudiences(e.app, "groups.id ?= {:g}", { g: g.id })
  return e.json(200, { removed: true })
}, $apis.requireAuth("users"))

// Owner takes a post off the group (it stays on the author's own calendar).
routerAdd("POST", "/api/tav/groups/{id}/remove-post", (e) => {
  const u = require(`${__hooks}/utils.js`)
  const g = u.loadGroup(e)
  if (g.getString("owner") !== e.auth.id) throw new ForbiddenError("Only the owner can remove posts")
  const ev = e.app.findRecordById("events", String(e.requestInfo().body.event || ""))
  const groups = ev.getStringSlice("groups")
  if (groups.indexOf(g.id) === -1) throw new BadRequestError("That post isn't in this group")

  const left = groups.filter((id) => id !== g.id)
  ev.set("groups", left)
  if (!left.length) ev.set("audience", "private")
  e.app.save(ev)
  u.notify(e.app, [ev.getString("created_by")], {
    title: `“${ev.getString("title")}” was removed from “${g.getString("name")}”`,
    body: "It's still on your own calendar.",
    url: `/event/${ev.id}`,
    kind: "group",
  }, e.auth.id)
  return e.json(200, { removed: true })
}, $apis.requireAuth("users"))
