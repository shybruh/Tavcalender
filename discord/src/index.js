// Tav Calendar Discord bot.
//
// The bot token and application id are set by an admin in the app (Admin -> Discord);
// this process polls PocketBase for them and (re)connects whenever they change.
// It also runs a small internal HTTP server that PocketBase calls to DM people and
// announce group plans:
//
//   POST /dm        { discord_id, kind, title, body, url, event_id }
//   POST /announce  { channel_id, event_id, title, when, where, by, group, url }
//
// Env: PB_URL, BOT_SECRET (shared with PocketBase), BOT_PORT (default 8092), HOST, TZ
import http from "node:http"
import { Client, EmbedBuilder, Events, GatewayIntentBits, REST, Routes, MessageFlags } from "discord.js"
import { ApiError, NotLinkedError, bot } from "./api.js"
import { definitions, onAutocomplete, onCommand, onRsvpButton } from "./commands.js"
import { handlePlanInteraction, postedByBot } from "./plan.js"
import { TZ } from "./time.js"
import { linkButton, notLinkedMessage, rsvpButtons } from "./ui.js"

const { BOT_SECRET = "", BOT_PORT = "8092", HOST = "127.0.0.1" } = process.env
if (!BOT_SECRET) {
  console.error("BOT_SECRET is not set")
  process.exit(1)
}

let client = null
let current = null // last config we started with; null = not checked yet
let lastError = ""

const log = (...a) => console.log(new Date().toISOString(), ...a)

// ---- connect / reconnect when the admin changes settings -------------------------------

async function syncConfig() {
  let cfg
  try {
    cfg = await bot.config()
  } catch (err) {
    lastError = `can't reach PocketBase: ${err.message}`
    return
  }
  if (current && cfg.token === current.token && cfg.app_id === current.app_id) return
  current = { token: cfg.token, app_id: cfg.app_id }
  if (client) {
    log("settings changed, disconnecting")
    await client.destroy().catch(() => {})
    client = null
  }
  if (!cfg.token || !cfg.app_id) {
    lastError = "Add the bot token and application ID in Admin → Discord."
    log(lastError)
    return
  }
  await start(cfg)
}

async function start(cfg) {
  const c = new Client({ intents: [GatewayIntentBits.Guilds] })
  c.once(Events.ClientReady, async (ready) => {
    log(`logged in as ${ready.user.tag} in ${ready.guilds.cache.size} server(s), timezone ${TZ}`)
    lastError = ""
    try {
      await new REST().setToken(cfg.token).put(Routes.applicationCommands(cfg.app_id), { body: definitions })
      log(`registered ${definitions.length} slash commands`)
    } catch (err) {
      lastError = `couldn't register commands: ${err.message}`
      log(lastError)
    }
    heartbeat()
  })
  c.on(Events.InteractionCreate, onInteraction)
  c.on(Events.GuildCreate, heartbeat)
  c.on(Events.GuildDelete, heartbeat)
  c.on(Events.Error, (err) => log("client error", err.message))
  try {
    await c.login(cfg.token)
    client = c
  } catch (err) {
    lastError = err.code === "TokenInvalid" ? "The bot token is invalid. Reset it in the Discord developer portal and paste it again." : `login failed: ${err.message}`
    log(lastError)
    await c.destroy().catch(() => {})
  }
}

async function heartbeat() {
  await bot.heartbeat({
    bot_name: client?.user?.tag ?? "",
    guilds: client?.guilds?.cache?.size ?? 0,
    error: lastError,
  }).catch(() => {})
}

// ---- interactions -----------------------------------------------------------------------

async function onInteraction(interaction) {
  try {
    if (interaction.isAutocomplete()) return await onAutocomplete(interaction)
    if (interaction.isChatInputCommand()) return await onCommand(interaction)
    if ("customId" in interaction) {
      if (interaction.customId.startsWith("plan:")) return await handlePlanInteraction(interaction)
      if (interaction.customId.startsWith("rsvp:")) return await onRsvpButton(interaction)
    }
  } catch (err) {
    const content = err instanceof NotLinkedError
      ? notLinkedMessage(err.reason)
      : err instanceof ApiError
        ? `Something went wrong: ${err.body?.message || err.message}`
        : `Something went wrong: ${err.message}`
    if (!(err instanceof NotLinkedError)) log("interaction error", interaction.commandName ?? interaction.customId, err)
    if (interaction.isAutocomplete()) return
    const payload = { content, flags: MessageFlags.Ephemeral }
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload)
      else await interaction.reply(payload)
    } catch { /* interaction expired */ }
  }
}

// ---- internal HTTP API for PocketBase -----------------------------------------------------

const EMOJI = { invite: "✉️", reminder: "⏰" }

async function dm(body) {
  const user = await client.users.fetch(body.discord_id)
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`${EMOJI[body.kind] ?? "🔔"} ${body.title}`.slice(0, 256))
  if (body.body) embed.setDescription(body.body.slice(0, 2000))
  const components = body.kind === "invite" && body.event_id
    ? [rsvpButtons(body.event_id, body.url)]
    : body.url ? [linkButton("Open", body.url)] : []
  await user.send({ embeds: [embed], components })
}

async function announce(body) {
  if (postedByBot.has(body.event_id)) return // already posted by /plan in this channel
  const channel = await client.channels.fetch(body.channel_id)
  if (!channel?.isTextBased()) return
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(body.title)
    .setDescription([`📅 ${body.when}`, body.where && `📍 ${body.where}`].filter(Boolean).join("\n"))
    .setFooter({ text: `👥 ${body.group} · posted by ${body.by}` })
  await channel.send({ embeds: [embed], components: [rsvpButtons(body.event_id, body.url)] })
}

http.createServer((req, res) => {
  const reply = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(data))
  }
  if (req.method === "GET" && req.url === "/health") return reply(200, { ok: true, connected: !!client?.isReady() })
  if (req.headers["x-bot-secret"] !== BOT_SECRET) return reply(401, { error: "unauthorized" })
  let raw = ""
  req.on("data", (c) => { raw += c; if (raw.length > 100_000) req.destroy() })
  req.on("end", async () => {
    let body
    try { body = JSON.parse(raw || "{}") } catch { return reply(400, { error: "invalid json" }) }
    if (!client?.isReady()) return reply(503, { error: "bot not connected" })
    try {
      if (req.url === "/dm") await dm(body)
      else if (req.url === "/announce") await announce(body)
      else return reply(404, { error: "not found" })
      reply(200, { ok: true })
    } catch (err) {
      // e.g. the user has DMs from server members turned off
      log(`${req.url} failed`, err.message)
      reply(502, { error: err.message })
    }
  })
}).listen(Number(BOT_PORT), HOST, () => log(`internal API on http://${HOST}:${BOT_PORT}`))

await syncConfig()
setInterval(syncConfig, 30_000)
setInterval(heartbeat, 60_000)
heartbeat()
