// /plan: an interactive, private (ephemeral) panel built from dropdowns and buttons.
//
//   row 1  Day        (next 14 days + "Other date…")
//   row 2  Time       (All day, 07:00–23:00, "Other time…")
//   row 3  Who sees   (Private / Partner / Close friends / Family / Friends / each group / all groups)
//   row 4  Invite     (Discord's own member picker)
//   row 5  [Details…] [⏱ length] [📣 Post here] [Ask if free] [Create]
//
// Each change re-renders the panel. Nothing is saved until Create.
import crypto from "node:crypto"
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  MessageFlags,
} from "discord.js"
import { asUser, bot, pbStr, toPb, parsePb } from "./api.js"
import { HOURS, dayLabel, describeEvent, floatingDay, nextDays, nextHour, parseDay, parseTime, timeLabel, ymd, zoned } from "./time.js"
import { rsvpButtons } from "./ui.js"

const AUDIENCES = [
  { value: "private", label: "Private", emoji: "🔒", hint: "Only you (and who you invite)" },
  { value: "partner", label: "Partner", emoji: "❤️", hint: "People you marked as partner" },
  { value: "close_friends", label: "Close friends", emoji: "⭐", hint: "People you marked as close friends" },
  { value: "family", label: "Family", emoji: "🏠", hint: "People you marked as family" },
  { value: "friends", label: "Friends", emoji: "🌍", hint: "Everyone you're connected with" },
]
// these never get posted publicly in a channel
const NEVER_PUBLIC = new Set(["private", "partner", "close_friends", "family"])
const LENGTHS = [60, 120, 180, 240, 30]

const panels = new Map() // id -> state
const PANEL_TTL = 30 * 60 * 1000

/** Event ids the bot posted itself, so the app's group announcement doesn't double-post. */
export const postedByBot = new Set()

function newPanel(state) {
  const id = crypto.randomBytes(6).toString("hex")
  panels.set(id, { ...state, id, created: Date.now() })
  for (const [k, v] of panels) if (Date.now() - v.created > PANEL_TTL) panels.delete(k)
  return panels.get(id)
}

const cid = (p, field) => `plan:${p.id}:${field}`

// ---- start ------------------------------------------------------------------------------

export async function startPlan(interaction) {
  const api = await asUser(interaction.user.id)
  const groups = (await api.list("calendars", { filter: `personal = false && members.id ?= ${pbStr(api.user.id)}`, sort: "name" }))
  // a channel connected to a group makes that group the default
  let channelGroup = null
  if (interaction.channelId) {
    const ch = (await api.list("discord_channels", { filter: `channel_id = ${pbStr(interaction.channelId)}` }))[0]
    if (ch && groups.some((g) => g.id === ch.group)) channelGroup = ch.group
  }
  const p = newPanel({
    owner: interaction.user.id,
    me: api.user,
    title: interaction.options.getString("title", true).slice(0, 200),
    day: ymd(new Date()),
    time: nextHour(),
    length: 60,
    audience: channelGroup ? "group" : "friends",
    groups: channelGroup ? [channelGroup] : [],
    allGroups: groups,
    invitees: [], // discord ids
    linked: {}, // discord id -> { id, name }
    clashes: {}, // discord id -> title or "" (busy, no details)
    askFree: false,
    location: "",
    details: "",
    post: false,
    channelId: interaction.channelId,
    inGuild: !!interaction.guildId,
  })
  await interaction.reply({ ...render(p), flags: MessageFlags.Ephemeral })
  return p
}

// ---- render -----------------------------------------------------------------------------

function audienceValue(p) {
  if (p.audience !== "group") return p.audience
  if (p.allGroups.length > 1 && p.groups.length === p.allGroups.length) return "allgroups"
  return `group:${p.groups[0]}`
}

function canPost(p) {
  return p.inGuild && !NEVER_PUBLIC.has(p.audience)
}

function range(p) {
  if (p.time === "allday") return { start: zoned(p.day, "00:00"), end: zoned(p.day, "23:59"), allDay: true }
  const start = zoned(p.day, p.time)
  return { start, end: new Date(start.getTime() + p.length * 60000), allDay: false }
}

function summary(p) {
  const { start, end, allDay } = range(p)
  const lines = [`**${p.title}**`, allDay ? `📅 ${dayLabel(start)} · All day` : `📅 ${dayLabel(start)} · ${timeLabel(start)}–${timeLabel(end)}`]
  if (p.location) lines.push(`📍 ${p.location}`)
  if (p.details) lines.push(`📝 ${p.details.length > 120 ? p.details.slice(0, 120) + "…" : p.details}`)

  const unlinked = p.invitees.filter((id) => !p.linked[id])
  const busy = p.invitees.filter((id) => p.linked[id] && id in p.clashes)
  for (const id of busy) {
    const what = p.clashes[id]
    lines.push(`⚠️ <@${id}> is busy ${what ? `with **${what}**` : "then"}.${p.askFree ? " They'll be asked if they're free." : " Ask if they're free?"}`)
  }
  if (unlinked.length) lines.push(`🔗 Not linked yet: ${unlinked.map((id) => `<@${id}>`).join(" ")}. They can type \`/register\`.`)
  if (p.post) lines.push("📣 Will be posted in this channel.")
  return lines.join("\n")
}

export function render(p) {
  const days = nextDays()
  const customDay = !days.some((d) => d.value === p.day)
  const day = new StringSelectMenuBuilder().setCustomId(cid(p, "day")).setPlaceholder("Day").addOptions(
    ...(customDay ? [{ label: dayLabel(zoned(p.day, "12:00")), value: p.day, default: true }] : []),
    ...days.map((d) => ({ label: d.label, value: d.value, default: d.value === p.day })),
    { label: "Other date…", value: "other", emoji: "🗓️" },
  )

  const customTime = p.time !== "allday" && !HOURS.includes(p.time)
  const time = new StringSelectMenuBuilder().setCustomId(cid(p, "time")).setPlaceholder("Time").addOptions(
    { label: "All day", value: "allday", default: p.time === "allday" },
    ...(customTime ? [{ label: p.time, value: p.time, default: true }] : []),
    ...HOURS.map((h) => ({ label: h, value: h, default: h === p.time })),
    { label: "Other time…", value: "other", emoji: "🕒" },
  )

  const current = audienceValue(p)
  const audience = new StringSelectMenuBuilder().setCustomId(cid(p, "audience")).setPlaceholder("Who can see it").addOptions(
    ...AUDIENCES.map((a) => ({ label: a.label, value: a.value, description: a.hint, emoji: a.emoji, default: current === a.value })),
    ...p.allGroups.slice(0, 18).map((g) => ({ label: `Group: ${g.name}`.slice(0, 100), value: `group:${g.id}`, emoji: "👥", default: current === `group:${g.id}` })),
    ...(p.allGroups.length > 1 ? [{ label: "All my groups", value: "allgroups", emoji: "👥", default: current === "allgroups" }] : []),
  )

  const invite = new UserSelectMenuBuilder()
    .setCustomId(cid(p, "invite"))
    .setPlaceholder("Invite people (optional)")
    .setMinValues(0)
    .setMaxValues(10)
  if (p.invitees.length) invite.setDefaultUsers(p.invitees)

  const hasClash = p.invitees.some((id) => p.linked[id] && id in p.clashes)
  const buttons = [
    new ButtonBuilder().setCustomId(cid(p, "details")).setLabel(p.location || p.details ? "Edit details" : "Add place / details").setStyle(ButtonStyle.Secondary).setEmoji("📝"),
    new ButtonBuilder().setCustomId(cid(p, "length")).setLabel(p.length < 60 ? `${p.length} min` : `${p.length / 60} h`).setStyle(ButtonStyle.Secondary).setEmoji("⏱️").setDisabled(p.time === "allday"),
    new ButtonBuilder().setCustomId(cid(p, "post")).setLabel(p.post ? "Post here: on" : "Post here: off").setStyle(p.post ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji("📣").setDisabled(!canPost(p)),
    ...(hasClash ? [new ButtonBuilder().setCustomId(cid(p, "askfree")).setLabel(p.askFree ? "Asking if free ✓" : "Ask if free").setStyle(p.askFree ? ButtonStyle.Primary : ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setCustomId(cid(p, "create")).setLabel("Create").setStyle(ButtonStyle.Success).setEmoji("✅"),
  ]

  return {
    content: summary(p),
    components: [
      new ActionRowBuilder().addComponents(day),
      new ActionRowBuilder().addComponents(time),
      new ActionRowBuilder().addComponents(audience),
      new ActionRowBuilder().addComponents(invite),
      new ActionRowBuilder().addComponents(...buttons),
    ],
  }
}

// ---- interactions -----------------------------------------------------------------------

/** Handles every plan:* component and modal. Returns true if it was ours. */
export async function handlePlanInteraction(interaction) {
  if (!interaction.customId.startsWith("plan:")) return false
  const [, id, field] = interaction.customId.split(":")
  const p = panels.get(id)
  if (!p) {
    await interaction.reply({ content: "This plan panel expired. Start again with `/plan`.", flags: MessageFlags.Ephemeral })
    return true
  }
  if (interaction.user.id !== p.owner) {
    await interaction.reply({ content: "That isn't your plan panel.", flags: MessageFlags.Ephemeral })
    return true
  }

  if (interaction.isModalSubmit()) return onModal(interaction, p, field)

  switch (field) {
    case "day": {
      const v = interaction.values[0]
      if (v === "other") return interaction.showModal(dateModal(p))
      p.day = v
      break
    }
    case "time": {
      const v = interaction.values[0]
      if (v === "other") return interaction.showModal(timeModal(p))
      p.time = v
      break
    }
    case "audience": {
      const v = interaction.values[0]
      if (v === "allgroups") {
        p.audience = "group"
        p.groups = p.allGroups.map((g) => g.id)
      } else if (v.startsWith("group:")) {
        p.audience = "group"
        p.groups = [v.slice(6)]
      } else {
        p.audience = v
        p.groups = []
      }
      if (!canPost(p)) p.post = false
      break
    }
    case "invite":
      p.invitees = interaction.values.filter((uid) => uid !== p.owner && !interaction.users.get(uid)?.bot)
      await interaction.deferUpdate()
      await refreshInvitees(p)
      return interaction.editReply(render(p))
    case "details":
      return interaction.showModal(detailsModal(p))
    case "length":
      p.length = LENGTHS[(LENGTHS.indexOf(p.length) + 1) % LENGTHS.length]
      break
    case "post":
      p.post = canPost(p) && !p.post
      break
    case "askfree":
      p.askFree = !p.askFree
      break
    case "create":
      return create(interaction, p)
  }
  // times changed -> re-check who's busy
  if (["day", "time", "length"].includes(field) && p.invitees.length) {
    await interaction.deferUpdate()
    await refreshInvitees(p)
    return interaction.editReply(render(p))
  }
  return interaction.update(render(p))
}

function modal(p, field, title, inputs) {
  return new ModalBuilder()
    .setCustomId(cid(p, field))
    .setTitle(title)
    .addComponents(...inputs.map((i) => new ActionRowBuilder().addComponents(i)))
}

const dateModal = (p) => modal(p, "m-date", "Pick a date", [
  new TextInputBuilder().setCustomId("date").setLabel("Date").setPlaceholder("e.g. 14 Nov, next friday, 2026-11-14").setStyle(TextInputStyle.Short).setRequired(true),
])
const timeModal = (p) => modal(p, "m-time", "Pick a time", [
  new TextInputBuilder().setCustomId("time").setLabel("Start time").setPlaceholder("e.g. 19:30 or 7.30pm").setStyle(TextInputStyle.Short).setRequired(true),
])
const detailsModal = (p) => modal(p, "m-details", "Details", [
  new TextInputBuilder().setCustomId("title").setLabel("Title").setStyle(TextInputStyle.Short).setValue(p.title).setMaxLength(200).setRequired(true),
  new TextInputBuilder().setCustomId("location").setLabel("Where").setStyle(TextInputStyle.Short).setValue(p.location).setMaxLength(300).setRequired(false),
  new TextInputBuilder().setCustomId("details").setLabel("Details").setStyle(TextInputStyle.Paragraph).setValue(p.details).setMaxLength(2000).setRequired(false),
])

async function onModal(interaction, p, field) {
  const f = (k) => interaction.fields.getTextInputValue(k)
  if (field === "m-date") {
    const day = parseDay(f("date"))
    if (!day) return interaction.reply({ content: `Couldn't read “${f("date")}” as a date. Try “14 Nov” or “next friday”.`, flags: MessageFlags.Ephemeral })
    p.day = day
  } else if (field === "m-time") {
    const time = parseTime(f("time"))
    if (!time) return interaction.reply({ content: `Couldn't read “${f("time")}” as a time. Try “19:30” or “7pm”.`, flags: MessageFlags.Ephemeral })
    p.time = time
  } else if (field === "m-details") {
    p.title = f("title").trim() || p.title
    p.location = f("location").trim()
    p.details = f("details").trim()
  }
  await interaction.deferUpdate()
  if (field !== "m-details" && p.invitees.length) await refreshInvitees(p)
  return interaction.editReply(render(p))
}

/** Resolves invitees to app users and checks whether they look busy at the chosen time. */
async function refreshInvitees(p) {
  p.linked = p.invitees.length ? await bot.resolve(p.invitees) : {}
  p.clashes = {}
  const ids = Object.values(p.linked).map((u) => u.id)
  if (!ids.length) return
  const api = await asUser(p.owner)
  const { start, end } = range(p)
  const from = toPb(new Date(start.getTime() - 31 * 864e5))
  const to = toPb(new Date(end.getTime() + 864e5))
  const who = ids.map((id) => `created_by = ${pbStr(id)}`).join(" || ")
  const [events, busy] = await Promise.all([
    api.list("events", { filter: `(${who}) && start >= ${pbStr(from)} && start < ${pbStr(to)}` }),
    api.send(`/api/tav/busy?${new URLSearchParams({ from, to })}`),
  ])
  const overlaps = (s, e) => s && e && s < end && e > start
  for (const [discordId, u] of Object.entries(p.linked)) {
    const ev = events.find((x) => x.created_by === u.id && overlaps(parsePb(x.start), parsePb(x.end) ?? parsePb(x.start)))
    if (ev) { p.clashes[discordId] = ev.title; continue }
    if (busy.some((b) => b.user === u.id && overlaps(parsePb(b.start), parsePb(b.end) ?? parsePb(b.start)))) p.clashes[discordId] = ""
  }
}

async function create(interaction, p) {
  await interaction.deferUpdate()
  const api = await asUser(p.owner)
  const mine = (await api.list("calendars", { filter: `personal = true && owner = ${pbStr(api.user.id)}` }))[0]
  if (!mine) return interaction.editReply({ content: "Your calendar isn't set up yet. Open the app once, then try again.", components: [] })

  const { start, end, allDay } = range(p)
  const ev = await api.create("events", {
    calendar: mine.id,
    created_by: api.user.id,
    title: p.title,
    location: p.location,
    description: p.details,
    all_day: allDay,
    start: toPb(allDay ? floatingDay(p.day) : start),
    end: toPb(allDay ? floatingDay(p.day) : end),
    audience: p.audience === "group" ? "groups" : p.audience,
    groups: p.audience === "group" ? p.groups : [],
  })

  const linkedIds = Object.values(p.linked).map((u) => u.id)
  const askFree = p.askFree ? Object.entries(p.linked).filter(([d]) => d in p.clashes).map(([, u]) => u.id) : []
  if (linkedIds.length) await api.send("/api/tav/invite", { method: "POST", body: { event: ev.id, users: linkedIds, ask_free: askFree } })

  const cfg = await bot.config().catch(() => ({}))
  const url = cfg.app_url ? `${cfg.app_url}/event/${ev.id}` : null

  if (p.post && canPost(p) && interaction.channel) {
    postedByBot.add(ev.id)
    setTimeout(() => postedByBot.delete(ev.id), 10 * 60 * 1000).unref()
    const groupNames = p.groups.map((g) => p.allGroups.find((x) => x.id === g)?.name).filter(Boolean)
    await interaction.channel.send({
      content: p.invitees.length ? p.invitees.map((id) => `<@${id}>`).join(" ") : undefined,
      embeds: [planEmbed({ ...ev, by: interaction.user, groupNames })],
      components: [rsvpButtons(ev.id, url)],
      allowedMentions: { users: p.invitees },
    })
  }

  panels.delete(p.id)
  const unlinked = p.invitees.filter((id) => !p.linked[id])
  const lines = [`✅ **${ev.title}** is on your calendar · ${describeEvent(ev)}`]
  if (linkedIds.length) lines.push(`📨 Invited ${linkedIds.length} ${linkedIds.length === 1 ? "person" : "people"}.`)
  if (unlinked.length) lines.push(`🔗 ${unlinked.map((id) => `<@${id}>`).join(" ")} ${unlinked.length === 1 ? "isn't" : "aren't"} linked yet, so they weren't invited. They can type \`/register\`.`)
  return interaction.editReply({
    content: lines.join("\n"),
    components: url ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open in app").setURL(url))] : [],
  })
}

/** The public card for a plan (channel posts and announcements). */
export function planEmbed(ev) {
  const e = new EmbedBuilder().setTitle(ev.title).setColor(0x8b5cf6).setDescription(
    [`📅 ${describeEvent(ev)}`, ev.location && `📍 ${ev.location}`, ev.description && `\n${ev.description.slice(0, 500)}`].filter(Boolean).join("\n"),
  )
  if (ev.by) e.setAuthor({ name: ev.by.displayName ?? ev.by.username ?? String(ev.by), iconURL: ev.by.displayAvatarURL?.() })
  if (ev.groupNames?.length) e.setFooter({ text: `👥 ${ev.groupNames.join(", ")}` })
  return e
}
