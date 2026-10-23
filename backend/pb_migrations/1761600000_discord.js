/// <reference path="../pb_data/types.d.ts" />

// Discord integration.
//
//  users.discord_*      the Discord account a user linked (set only by /api/tav/discord/claim)
//  discord_links        one-time links the bot hands out from /register (expire after 30 min)
//  app_settings         single row the admins edit in Admin -> Discord: bot credentials + links.
//                       The token is a hidden field: only the bot (via BOT_SECRET) can read it.
//  discord_channels     a Discord channel connected to a group (default group for /plan there,
//                       optionally announces new group posts if the group owner allows it)

const APPROVED = '@request.auth.status = "approved"'
const ADMIN = '@request.auth.role = "admin"'
const ME = "@request.auth.id"

const timestamps = [
  { type: "autodate", name: "created", onCreate: true, onUpdate: false },
  { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
]

migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const calendars = app.findCollectionByNameOrId("calendars")

  users.fields.add(new TextField({ name: "discord_id", max: 30 }))
  users.fields.add(new TextField({ name: "discord_name", max: 100 }))
  // DMs are on unless muted
  users.fields.add(new BoolField({ name: "discord_mute_invites" }))
  users.fields.add(new BoolField({ name: "discord_mute_reminders" }))
  users.indexes = [...users.indexes, "CREATE UNIQUE INDEX idx_users_discord_id ON users (discord_id) WHERE discord_id != ''"]
  const lockDiscord = "@request.body.discord_id:isset = false && @request.body.discord_name:isset = false"
  users.updateRule = `${ADMIN} || (id = ${ME} && @request.body.role:isset = false && @request.body.status:isset = false && ${lockDiscord})`
  users.createRule = `@request.body.role:isset = false && @request.body.status:isset = false && ${lockDiscord}`
  app.save(users)

  const links = new Collection({
    type: "base",
    name: "discord_links",
    fields: [
      { type: "text", name: "token", required: true, max: 64 },
      { type: "text", name: "discord_id", required: true, max: 30 },
      { type: "text", name: "discord_name", max: 100 },
      { type: "date", name: "expires", required: true },
      ...timestamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_discord_links_token ON discord_links (token)"],
  })
  // no API access at all; only the hook routes touch it
  links.listRule = null
  links.viewRule = null
  links.createRule = null
  links.updateRule = null
  links.deleteRule = null
  app.save(links)

  const settings = new Collection({
    type: "base",
    name: "app_settings",
    fields: [
      { type: "text", name: "app_url", max: 300 },
      { type: "text", name: "discord_app_id", max: 30 },
      { type: "text", name: "discord_token", max: 200, hidden: true },
      { type: "url", name: "discord_server_invite" },
      // written by the bot's heartbeat
      { type: "text", name: "discord_bot_name", max: 100 },
      { type: "date", name: "discord_last_seen" },
      { type: "number", name: "discord_guilds", onlyInt: true },
      { type: "text", name: "discord_error", max: 500 },
      ...timestamps,
    ],
  })
  settings.listRule = APPROVED
  settings.viewRule = APPROVED
  settings.createRule = null
  settings.updateRule = `${ADMIN} && @request.body.discord_bot_name:isset = false && @request.body.discord_last_seen:isset = false && @request.body.discord_guilds:isset = false`
  settings.deleteRule = null
  app.save(settings)
  app.save(new Record(settings)) // the single settings row

  const channels = new Collection({
    type: "base",
    name: "discord_channels",
    fields: [
      { type: "text", name: "channel_id", required: true, max: 30 },
      { type: "text", name: "channel_name", max: 100 },
      { type: "text", name: "guild_id", max: 30 },
      { type: "relation", name: "group", collectionId: calendars.id, maxSelect: 1, required: true, cascadeDelete: true },
      { type: "bool", name: "announce" },
      { type: "relation", name: "created_by", collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      ...timestamps,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_discord_channels_channel ON discord_channels (channel_id)"],
  })
  const member = `(${APPROVED} && group.members.id ?= ${ME})`
  channels.listRule = member
  channels.viewRule = member
  // any member can connect a channel, but only the owner can switch announcements on
  channels.createRule = `${member} && created_by = ${ME} && (announce = false || group.owner = ${ME})`
  channels.updateRule = `group.owner = ${ME} && @request.body.group:isset = false && @request.body.channel_id:isset = false`
  channels.deleteRule = `group.owner = ${ME} || created_by = ${ME}`
  app.save(channels)
}, (app) => {
  for (const name of ["discord_channels", "app_settings", "discord_links"]) app.delete(app.findCollectionByNameOrId(name))
  const users = app.findCollectionByNameOrId("users")
  for (const f of ["discord_id", "discord_name", "discord_mute_invites", "discord_mute_reminders"]) users.fields.removeByName(f)
  users.indexes = users.indexes.filter((i) => !i.includes("idx_users_discord_id"))
  app.save(users)
})
