// Shared helpers for the *.pb.js hooks.
// Hook handlers run in isolated VMs, so they must `require` this file inside the handler.

/** Returns the ids of all admin users. */
function adminIds(app) {
  return app.findRecordsByFilter("users", 'role = "admin"', "", 0, 0).map((r) => r.id)
}

/** Display name for notification text. */
function nameOf(user) {
  return user ? (user.getString("name") || "Someone") : "Someone"
}

/**
 * Creates an in-app notification for each user id (skipping `exceptId`).
 * Creating the record triggers a web push via notifications.pb.js.
 */
function notify(app, userIds, data, exceptId) {
  const col = app.findCollectionByNameOrId("notifications")
  const seen = {}
  for (const id of userIds) {
    if (!id || id === exceptId || seen[id]) continue
    seen[id] = true
    const rec = new Record(col)
    rec.set("user", id)
    rec.set("title", data.title)
    rec.set("body", data.body || "")
    rec.set("url", data.url || "/")
    rec.set("kind", data.kind || "info")
    rec.set("read", false)
    try {
      app.save(rec)
    } catch (err) {
      app.logger().error("notify failed", "user", id, "error", String(err))
    }
  }
}

/** Sends a web push for a notification record to all of its user's subscriptions. */
function sendPush(app, notification) {
  const pushUrl = $os.getenv("PUSH_URL") || "http://127.0.0.1:8091/send"
  const subs = app.findRecordsByFilter(
    "push_subscriptions", "user = {:user}", "", 0, 0, { user: notification.get("user") },
  )
  if (!subs.length) return

  try {
    const res = $http.send({
      url: pushUrl,
      method: "POST",
      timeout: 5,
      headers: {
        "content-type": "application/json",
        "x-push-secret": $os.getenv("PUSH_SECRET") || "",
      },
      body: JSON.stringify({
        subscriptions: subs.map((s) => ({ endpoint: s.get("endpoint"), keys: s.get("keys") })),
        payload: {
          title: notification.get("title"),
          body: notification.get("body"),
          url: notification.get("url") || "/",
          tag: notification.id,
        },
      }),
    })
    if (res.statusCode !== 200) {
      app.logger().warn("push service error", "status", res.statusCode, "body", res.raw)
      return
    }
    // drop subscriptions the push service reported as gone
    const expired = (res.json && res.json.expired) || []
    for (const s of subs) {
      if (expired.indexOf(s.get("endpoint")) !== -1) app.delete(s)
    }
  } catch (err) {
    app.logger().warn("push service unreachable", "error", String(err))
  }
}

/**
 * Short human readable date for notification bodies, in the server's local
 * timezone (set the TZ env var on the server, e.g. TZ=Europe/London).
 */
function fmtDate(dt, allDay) {
  if (!dt || dt.isZero()) return ""
  return dt.time().local().format(allDay ? "Mon 2 Jan" : "Mon 2 Jan, 15:04")
}

/** Record hook helper: keeps remind_at = event.start - offset_minutes for event reminders. */
function syncRemindAt(e) {
  const eventId = e.record.getString("event")
  const offset = e.record.getInt("offset_minutes")
  if (eventId && offset > 0) {
    const ev = e.app.findRecordById("events", eventId)
    e.record.set("remind_at", ev.getDateTime("start").add(-offset * 60 * 1000 * 1000 * 1000))
  }
  e.next()
}

/** Creates the user's personal calendar if they don't have one yet. */
function ensurePersonalCalendar(app, user) {
  try {
    app.findFirstRecordByFilter("calendars", "personal = true && owner = {:u}", { u: user.id })
    return
  } catch (_) { /* none yet */ }
  const cal = new Record(app.findCollectionByNameOrId("calendars"))
  cal.set("name", user.getString("name") || "My calendar")
  cal.set("color", user.getString("color"))
  cal.set("personal", true)
  cal.set("owner", user.id)
  cal.set("members", [user.id])
  app.save(cal)
}

const RSVP_LABEL = { going: "is going to", maybe: "might go to", no: "can't make" }

// audience -> connection label it is limited to ("friends" = every accepted connection)
const AUDIENCE_LABEL = { partner: "partner", close_friends: "close_friend", family: "family" }

/**
 * Who besides the author may see an event, from its audience.
 * Also drops any groups the author isn't a member of. Keep in sync with the copy in
 * pb_migrations/1761500000_connections_groups.js.
 */
function resolveAudience(app, ev) {
  const author = ev.getString("created_by")
  const audience = ev.getString("audience")
  const out = new Set()
  if (audience === "groups") {
    const keep = []
    for (const gid of ev.getStringSlice("groups")) {
      try {
        const g = app.findRecordById("calendars", gid)
        const members = g.getStringSlice("members")
        if (g.getBool("personal") || members.indexOf(author) === -1) continue
        keep.push(gid)
        for (const m of members) out.add(m)
      } catch (_) { /* group gone */ }
    }
    ev.set("groups", keep)
  } else {
    ev.set("groups", [])
    if (audience && audience !== "private") {
      const label = AUDIENCE_LABEL[audience]
      const filter = label
        ? "from = {:a} && status = 'accepted' && label = {:l}"
        : "from = {:a} && status = 'accepted'"
      for (const c of app.findRecordsByFilter("connections", filter, "", 0, 0, { a: author, l: label || "" })) {
        out.add(c.getString("to"))
      }
    }
  }
  out.delete(author)
  return [...out]
}

/** Re-saves events matching a filter so their audience_users is recalculated. */
function refreshAudiences(app, filter, params) {
  for (const ev of app.findRecordsByFilter("events", filter, "", 0, 0, params || {})) {
    app.save(ev) // pb_hooks/audience.pb.js recalculates on every save
  }
}

/** Refresh everything that depends on a user's connections. */
function refreshUserAudiences(app, userId) {
  refreshAudiences(app, "created_by = {:u} && audience != 'private' && audience != 'groups'", { u: userId })
}

/** Route helper: the group from the {id} path param, for an approved caller. */
function loadGroup(e) {
  const g = e.app.findRecordById("calendars", e.request.pathValue("id"))
  if (g.getBool("personal")) throw new NotFoundError("Group not found")
  if (e.auth.getString("status") !== "approved") throw new ForbiddenError("Not approved")
  return g
}

// ---- Discord -----------------------------------------------------------------------

/** Throws unless the request carries the shared bot secret. */
function requireBot(e) {
  const secret = $os.getenv("BOT_SECRET")
  if (!secret || e.request.header.get("x-bot-secret") !== secret) throw new UnauthorizedError("bot only")
}

function appSettings(app) {
  return app.findRecordsByFilter("app_settings", "", "created", 1, 0)[0]
}

/** Public URL of the app (Admin -> Discord saves it; APP_URL env as a fallback). */
function appUrl(app) {
  let url = ""
  try { url = appSettings(app).getString("app_url") } catch (_) { /* no settings row */ }
  return (url || $os.getenv("APP_URL") || "").replace(/\/+$/, "")
}

/** Fire-and-forget POST to the Discord bot service; never breaks the caller. */
function botPost(app, path, body) {
  const secret = $os.getenv("BOT_SECRET")
  const base = $os.getenv("BOT_URL")
  if (!secret || !base) return
  try {
    $http.send({
      url: base.replace(/\/+$/, "") + path,
      method: "POST",
      timeout: 5,
      headers: { "content-type": "application/json", "x-bot-secret": secret },
      body: JSON.stringify(body),
    })
  } catch (err) {
    app.logger().warn("discord bot unreachable", "path", path, "error", String(err))
  }
}

// which notification kinds may be sent as Discord DMs, and the user setting that mutes them
const DISCORD_DM_KINDS = { invite: "discord_mute_invites", reminder: "discord_mute_reminders" }

/** DMs a notification on Discord if the user linked an account and didn't mute that kind. */
function sendDiscord(app, notification) {
  const mute = DISCORD_DM_KINDS[notification.getString("kind")]
  if (!mute) return
  let user
  try { user = app.findRecordById("users", notification.getString("user")) } catch (_) { return }
  const discordId = user.getString("discord_id")
  if (!discordId || user.getBool(mute)) return
  const path = notification.getString("url") || "/"
  const m = path.match(/^\/event\/([a-z0-9]+)/)
  botPost(app, "/dm", {
    discord_id: discordId,
    kind: notification.getString("kind"),
    title: notification.getString("title"),
    body: notification.getString("body"),
    url: appUrl(app) + path,
    event_id: m ? m[1] : "",
  })
}

const LABELS = { friend: "friend", close_friend: "close friend", family: "family", partner: "partner" }

module.exports = {
  adminIds, nameOf, notify, sendPush, fmtDate, syncRemindAt, ensurePersonalCalendar, RSVP_LABEL,
  resolveAudience, refreshAudiences, refreshUserAudiences, loadGroup, LABELS,
  requireBot, appSettings, appUrl, botPost, sendDiscord,
}
