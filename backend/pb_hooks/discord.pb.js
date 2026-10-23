/// <reference path="../pb_data/types.d.ts" />

// Discord integration routes.
//
// User-facing (logged in):
//   GET  /api/tav/discord/link-info?t=   who a /register link belongs to (for the link page)
//   POST /api/tav/discord/claim          link the Discord account from a /register link
//   POST /api/tav/discord/unlink
//
// Bot-only (header x-bot-secret = BOT_SECRET):
//   GET  /api/tav/bot/config             token + app id + urls the bot runs with
//   POST /api/tav/bot/heartbeat          bot status shown in Admin -> Discord
//   POST /api/tav/bot/link               make a one-time /register link for a Discord user
//   POST /api/tav/bot/session            short-lived app login for a linked Discord user, so the
//                                        bot acts *as them* and every normal access rule applies
//   POST /api/tav/bot/resolve            Discord ids -> app user ids (approved, linked users)

routerAdd("GET", "/api/tav/discord/link-info", (e) => {
  const t = e.request.url.query().get("t")
  try {
    const link = e.app.findFirstRecordByFilter("discord_links", "token = {:t} && expires > @now", { t })
    return e.json(200, { valid: true, discord_name: link.getString("discord_name") })
  } catch (_) {
    return e.json(200, { valid: false })
  }
})

routerAdd("POST", "/api/tav/discord/claim", (e) => {
  const t = String(e.requestInfo().body.token || "")
  let link
  try {
    link = e.app.findFirstRecordByFilter("discord_links", "token = {:t} && expires > @now", { t })
  } catch (_) {
    throw new BadRequestError("This link has expired. Type /register in Discord again.")
  }
  const discordId = link.getString("discord_id")
  // a Discord account can only be linked to one app account
  for (const other of e.app.findRecordsByFilter("users", "discord_id = {:d} && id != {:me}", "", 0, 0, { d: discordId, me: e.auth.id })) {
    other.set("discord_id", "")
    other.set("discord_name", "")
    e.app.save(other)
  }
  const user = e.app.findRecordById("users", e.auth.id)
  user.set("discord_id", discordId)
  user.set("discord_name", link.getString("discord_name"))
  e.app.save(user)
  e.app.delete(link)
  return e.json(200, { linked: true, discord_name: user.getString("discord_name") })
}, $apis.requireAuth("users"))

routerAdd("POST", "/api/tav/discord/unlink", (e) => {
  const user = e.app.findRecordById("users", e.auth.id)
  user.set("discord_id", "")
  user.set("discord_name", "")
  e.app.save(user)
  return e.json(200, { linked: false })
}, $apis.requireAuth("users"))

// ---- bot-only ------------------------------------------------------------------------

routerAdd("GET", "/api/tav/bot/config", (e) => {
  const u = require(`${__hooks}/utils.js`)
  u.requireBot(e)
  const s = u.appSettings(e.app)
  return e.json(200, {
    token: s.getString("discord_token"),
    app_id: s.getString("discord_app_id"),
    app_url: u.appUrl(e.app),
    server_invite: s.getString("discord_server_invite"),
  })
})

routerAdd("POST", "/api/tav/bot/heartbeat", (e) => {
  const u = require(`${__hooks}/utils.js`)
  u.requireBot(e)
  const body = e.requestInfo().body
  const s = u.appSettings(e.app)
  s.set("discord_bot_name", String(body.bot_name || "").slice(0, 100))
  s.set("discord_guilds", Number(body.guilds) || 0)
  s.set("discord_error", String(body.error || "").slice(0, 500))
  s.set("discord_last_seen", new DateTime())
  e.app.save(s)
  return e.json(200, { ok: true })
})

routerAdd("POST", "/api/tav/bot/link", (e) => {
  const u = require(`${__hooks}/utils.js`)
  u.requireBot(e)
  const body = e.requestInfo().body
  const discordId = String(body.discord_id || "")
  if (!/^\d{5,30}$/.test(discordId)) throw new BadRequestError("bad discord_id")

  let linked = null
  try { linked = e.app.findFirstRecordByFilter("users", "discord_id = {:d}", { d: discordId }) } catch (_) { /* not yet */ }

  // drop this person's older links, then make a fresh one
  for (const old of e.app.findRecordsByFilter("discord_links", "discord_id = {:d} || expires < @now", "", 0, 0, { d: discordId })) {
    e.app.delete(old)
  }
  const token = $security.randomString(40)
  const rec = new Record(e.app.findCollectionByNameOrId("discord_links"))
  rec.set("token", token)
  rec.set("discord_id", discordId)
  rec.set("discord_name", String(body.discord_name || "").slice(0, 100))
  rec.set("expires", new DateTime().add(30 * 60 * 1000 * 1000 * 1000))
  e.app.save(rec)

  return e.json(200, {
    url: `${u.appUrl(e.app)}/link/discord?t=${token}`,
    linked: !!linked,
    name: linked ? linked.getString("name") : "",
    status: linked ? linked.getString("status") : "",
  })
})

routerAdd("POST", "/api/tav/bot/session", (e) => {
  const u = require(`${__hooks}/utils.js`)
  u.requireBot(e)
  const discordId = String(e.requestInfo().body.discord_id || "")
  let user
  try {
    user = e.app.findFirstRecordByFilter("users", "discord_id = {:d} && discord_id != ''", { d: discordId })
  } catch (_) {
    return e.json(404, { error: "not_linked" })
  }
  if (user.getString("status") !== "approved") return e.json(403, { error: user.getString("status") || "pending" })
  return e.json(200, {
    token: user.newStaticAuthToken(30 * 60 * 1000 * 1000 * 1000),
    user: { id: user.id, name: user.getString("name"), color: user.getString("color") },
  })
})

routerAdd("POST", "/api/tav/bot/resolve", (e) => {
  const u = require(`${__hooks}/utils.js`)
  u.requireBot(e)
  const ids = (e.requestInfo().body.discord_ids || []).map(String).filter((x) => /^\d{5,30}$/.test(x)).slice(0, 50)
  const out = {}
  for (const d of ids) {
    try {
      const user = e.app.findFirstRecordByFilter("users", "discord_id = {:d} && status = 'approved'", { d })
      out[d] = { id: user.id, name: user.getString("name") }
    } catch (_) { /* not linked */ }
  }
  return e.json(200, out)
})

// Admins set the bot token here (it's a hidden field, so the normal API can't write it,
// and it's never sent back to the browser). Empty string clears it.
routerAdd("POST", "/api/tav/admin/discord-token", (e) => {
  const u = require(`${__hooks}/utils.js`)
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only")
  const token = String(e.requestInfo().body.token || "").trim()
  if (token && !/^[\w.-]{50,100}$/.test(token)) throw new BadRequestError("That doesn't look like a Discord bot token")
  const s = u.appSettings(e.app)
  s.set("discord_token", token)
  e.app.save(s)
  return e.json(200, { has_token: !!token })
}, $apis.requireAuth("users"))

// Whether a bot token is saved (without revealing it).
routerAdd("GET", "/api/tav/admin/discord-token", (e) => {
  const u = require(`${__hooks}/utils.js`)
  if (e.auth.getString("role") !== "admin") throw new ForbiddenError("Admins only")
  return e.json(200, { has_token: !!u.appSettings(e.app).getString("discord_token") })
}, $apis.requireAuth("users"))
