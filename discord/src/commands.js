import { ChannelType, EmbedBuilder, SlashCommandBuilder, MessageFlags } from "discord.js"
import { asUser, bot, pbStr, parsePb, toPb } from "./api.js"
import { startPlan } from "./plan.js"
import { describeEvent, dayLabel, discordTime, parseDay, parseWhen, timeLabel, ymd, zoned } from "./time.js"
import { linkButton } from "./ui.js"

export const definitions = [
  new SlashCommandBuilder().setName("register").setDescription("Link your Discord to your Tav Calendar account"),
  new SlashCommandBuilder()
    .setName("plan")
    .setDescription("Make a plan (pick the day, time and people next)")
    .addStringOption((o) => o.setName("title").setDescription("What's the plan?").setRequired(true).setMaxLength(200)),
  new SlashCommandBuilder()
    .setName("remind")
    .setDescription("Set yourself a reminder")
    .addStringOption((o) => o.setName("when").setDescription("e.g. in 2 hours, tomorrow 9am, fri 6pm").setRequired(true))
    .addStringOption((o) => o.setName("what").setDescription("What to remind you about").setRequired(true).setMaxLength(200)),
  new SlashCommandBuilder().setName("today").setDescription("Your plans for today"),
  new SlashCommandBuilder().setName("week").setDescription("Your plans for the next 7 days"),
  new SlashCommandBuilder()
    .setName("free")
    .setDescription("Is someone free?")
    .addUserOption((o) => o.setName("who").setDescription("Who to check").setRequired(true))
    .addStringOption((o) => o.setName("day").setDescription("e.g. today, sat, 14 nov (default: today)")),
  new SlashCommandBuilder()
    .setName("group")
    .setDescription("Connect this channel to one of your groups")
    .addSubcommand((s) =>
      s.setName("connect")
        .setDescription("Plans made here default to this group")
        .addStringOption((o) => o.setName("group").setDescription("Which group").setRequired(true).setAutocomplete(true))
        .addBooleanOption((o) => o.setName("announce").setDescription("Post new group plans here (group owner only)")))
    .addSubcommand((s) => s.setName("disconnect").setDescription("Disconnect this channel from its group"))
    .addSubcommand((s) => s.setName("status").setDescription("Which group is this channel connected to?")),
].map((c) => c.toJSON())

// ---- handlers ---------------------------------------------------------------------------

export async function onCommand(interaction) {
  switch (interaction.commandName) {
    case "register": return register(interaction)
    case "plan": return startPlan(interaction)
    case "remind": return remind(interaction)
    case "today": return listPlans(interaction, 1)
    case "week": return listPlans(interaction, 7)
    case "free": return free(interaction)
    case "group": return group(interaction)
  }
}

async function register(interaction) {
  const u = interaction.user
  const link = await bot.link(u.id, u.globalName || u.username)
  if (link.linked) {
    const state = link.status === "approved" ? "" : link.status === "pending" ? " (waiting for admin approval)" : " (not approved)"
    return interaction.reply({
      content: `You're already linked as **${link.name}**${state}. To link a different account, use the button (expires in 30 minutes).`,
      components: [linkButton("Link a different account", link.url)],
      flags: MessageFlags.Ephemeral,
    })
  }
  return interaction.reply({
    content: "Tap the button to connect your account. If you're new, you'll make one and an admin approves it. The link only works for you and expires in 30 minutes.",
    components: [linkButton("Connect my account", link.url)],
    flags: MessageFlags.Ephemeral,
  })
}

async function remind(interaction) {
  const api = await asUser(interaction.user.id)
  const text = interaction.options.getString("when", true)
  const when = parseWhen(text)
  if (!when) return interaction.reply({ content: `Couldn't work out when “${text}” is. Try “in 2 hours” or “fri 6pm”.`, flags: MessageFlags.Ephemeral })
  if (when < new Date(Date.now() - 60000)) return interaction.reply({ content: "That's in the past.", flags: MessageFlags.Ephemeral })
  const what = interaction.options.getString("what", true)
  await api.create("reminders", { user: api.user.id, title: what, remind_at: toPb(when) })
  return interaction.reply({ content: `⏰ Got it. I'll remind you ${discordTime(when, "F")} (${discordTime(when, "R")}): **${what}**`, flags: MessageFlags.Ephemeral })
}

/** Your own plans: what you made, what you're invited to, and what you said yes/maybe to. */
async function listPlans(interaction, days) {
  const api = await asUser(interaction.user.id)
  const today = ymd(new Date())
  const from = zoned(today, "00:00")
  const to = new Date(from.getTime() + days * 864e5)
  const me = pbStr(api.user.id)
  const range = `start >= ${pbStr(toPb(new Date(from.getTime() - 864e5)))} && start < ${pbStr(toPb(to))}`
  const [own, rsvps] = await Promise.all([
    api.list("events", { filter: `${range} && (created_by = ${me} || guests.id ?= ${me})`, sort: "start", expand: "created_by" }),
    api.list("rsvps", { filter: `user = ${me}`, expand: "event" }),
  ])
  const status = new Map(rsvps.map((r) => [r.event, r.status]))
  const byId = new Map(own.map((e) => [e.id, e]))
  for (const r of rsvps) {
    const ev = r.expand?.event
    if (ev && (r.status === "going" || r.status === "maybe") && parsePb(ev.start) < to) byId.set(ev.id, ev)
  }
  const events = [...byId.values()]
    .filter((e) => status.get(e.id) !== "no" && (parsePb(e.end) ?? parsePb(e.start)) >= from)
    .sort((a, b) => a.start.localeCompare(b.start))

  if (!events.length) return interaction.reply({ content: days === 1 ? "Nothing planned today. 🌴" : "Nothing planned this week. Time to `/plan` something!", flags: MessageFlags.Ephemeral })

  const cfg = await bot.config().catch(() => ({}))
  const lines = events.slice(0, 25).map((e) => {
    const tag = status.get(e.id) === "invited" ? " · ✉️ invited" : status.get(e.id) === "maybe" ? " · 🤔 maybe" : e.created_by !== api.user.id && status.get(e.id) === "going" ? " · ✅ going" : ""
    const title = cfg.app_url ? `[${e.title}](${cfg.app_url}/event/${e.id})` : e.title
    return `**${title}**\n${describeEvent(e)}${e.location ? ` · 📍 ${e.location}` : ""}${tag}`
  })
  const embed = new EmbedBuilder().setTitle(days === 1 ? "Today" : "Next 7 days").setColor(0x8b5cf6).setDescription(lines.join("\n\n"))
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral })
}

async function free(interaction) {
  const api = await asUser(interaction.user.id)
  const who = interaction.options.getUser("who", true)
  const dayText = interaction.options.getString("day")
  const day = dayText ? parseDay(dayText) : ymd(new Date())
  if (!day) return interaction.reply({ content: `Couldn't read “${dayText}” as a day.`, flags: MessageFlags.Ephemeral })

  const target = (await bot.resolve([who.id]))[who.id]
  if (!target) return interaction.reply({ content: `${who} hasn't linked their account yet, so I can't check.`, flags: MessageFlags.Ephemeral })

  const start = zoned(day, "00:00")
  const end = new Date(start.getTime() + 864e5)
  const from = toPb(new Date(start.getTime() - 31 * 864e5))
  const to = toPb(end)
  const [events, busy] = await Promise.all([
    api.list("events", { filter: `created_by = ${pbStr(target.id)} && start >= ${pbStr(from)} && start < ${pbStr(to)}`, sort: "start" }),
    api.send(`/api/tav/busy?${new URLSearchParams({ from, to })}`),
  ])
  const overlaps = (s, e) => s && (e ?? s) >= start && s < end
  const slots = [
    ...events.filter((e) => overlaps(parsePb(e.start), parsePb(e.end))).map((e) => ({ s: parsePb(e.start), e: parsePb(e.end), allDay: e.all_day, what: e.title })),
    ...busy.filter((b) => b.user === target.id && overlaps(parsePb(b.start), parsePb(b.end))).map((b) => ({ s: parsePb(b.start), e: parsePb(b.end), allDay: b.all_day })),
  ].sort((a, b) => a.s - b.s)

  const label = dayLabel(zoned(day, "12:00"))
  if (!slots.length) return interaction.reply({ content: `🟢 **${target.name}** looks free on ${label}.`, flags: MessageFlags.Ephemeral })
  const lines = slots.map((x) => `• ${x.allDay ? "All day" : `${timeLabel(x.s)}${x.e ? `–${timeLabel(x.e)}` : ""}`}: ${x.what ? `**${x.what}**` : "busy"}`)
  return interaction.reply({ content: `🟠 **${target.name}** on ${label}:\n${lines.join("\n")}`, flags: MessageFlags.Ephemeral })
}

async function group(interaction) {
  const sub = interaction.options.getSubcommand()
  if (!interaction.guildId || interaction.channel?.type === ChannelType.DM) {
    return interaction.reply({ content: "Use this in a server channel.", flags: MessageFlags.Ephemeral })
  }
  const api = await asUser(interaction.user.id)
  const existing = (await api.list("discord_channels", { filter: `channel_id = ${pbStr(interaction.channelId)}`, expand: "group" }))[0]

  if (sub === "status") {
    if (!existing) return interaction.reply({ content: "This channel isn't connected to a group (or you're not in it).", flags: MessageFlags.Ephemeral })
    return interaction.reply({
      content: `This channel is connected to **${existing.expand?.group?.name}**. ${existing.announce ? "New group plans are announced here." : "New group plans are not announced here."}`,
      flags: MessageFlags.Ephemeral,
    })
  }

  if (sub === "disconnect") {
    if (!existing) return interaction.reply({ content: "This channel isn't connected to a group you're in.", flags: MessageFlags.Ephemeral })
    await api.remove("discord_channels", existing.id).catch(() => {
      throw new Error("Only the group owner or whoever connected it can disconnect it.")
    })
    return interaction.reply({ content: `Disconnected from **${existing.expand?.group?.name}**.`, flags: MessageFlags.Ephemeral })
  }

  // connect
  const groupId = interaction.options.getString("group", true)
  const announce = interaction.options.getBoolean("announce") ?? false
  const g = await api.get("calendars", groupId).catch(() => null)
  if (!g || g.personal || !g.members.includes(api.user.id)) return interaction.reply({ content: "Pick one of your groups from the list.", flags: MessageFlags.Ephemeral })
  if (announce && g.owner !== api.user.id) return interaction.reply({ content: "Only the group's owner can turn announcements on. Connect without it, or ask them.", flags: MessageFlags.Ephemeral })

  const data = { channel_id: interaction.channelId, channel_name: interaction.channel?.name ?? "", guild_id: interaction.guildId, group: g.id, announce, created_by: api.user.id }
  if (existing) await api.remove("discord_channels", existing.id)
  await api.create("discord_channels", data)
  return interaction.reply({
    content: `🔗 This channel is now connected to **${g.name}**. \`/plan\` here posts to that group by default${announce ? ", and new plans in the group get announced here." : "."}`,
    flags: MessageFlags.Ephemeral,
  })
}

/** Autocomplete for /group connect: your groups. */
export async function onAutocomplete(interaction) {
  try {
    const api = await asUser(interaction.user.id)
    const typed = interaction.options.getFocused().toLowerCase()
    const groups = await api.list("calendars", { filter: `personal = false && members.id ?= ${pbStr(api.user.id)}`, sort: "name" })
    await interaction.respond(groups.filter((g) => g.name.toLowerCase().includes(typed)).slice(0, 25).map((g) => ({ name: g.name, value: g.id })))
  } catch {
    await interaction.respond([])
  }
}

/** Going / Maybe / Can't go buttons on channel posts and DMs. */
export async function onRsvpButton(interaction) {
  const [, eventId, status] = interaction.customId.split(":")
  const api = await asUser(interaction.user.id)
  let ev
  try {
    ev = await api.get("events", eventId)
  } catch {
    return interaction.reply({ content: "You can't see this plan (it might be private, or it was deleted).", flags: MessageFlags.Ephemeral })
  }
  const mine = (await api.list("rsvps", { filter: `event = ${pbStr(eventId)} && user = ${pbStr(api.user.id)}` }))[0]
  if (mine) await api.update("rsvps", mine.id, { status })
  else await api.create("rsvps", { event: eventId, user: api.user.id, status })
  const label = { going: "✅ You're going", maybe: "🤔 Marked as maybe", no: "❌ You can't make it" }[status]
  return interaction.reply({ content: `${label}: **${ev.title}** (${describeEvent(ev)})`, flags: MessageFlags.Ephemeral })
}
