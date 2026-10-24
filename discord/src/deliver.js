import { EmbedBuilder } from "discord.js"
import { linkButton, rsvpButtons } from "./ui.js"

const EMOJI = { invite: "✉️", reminder: "⏰" }

/**
 * DMs a notification. If Discord refuses the DM (no shared server, or the person turned off
 * DMs from server members) and we know a channel for it, pings them there instead.
 * Returns "dm" or "channel"; throws if neither worked.
 */
export async function deliverDm(client, body, log = () => {}) {
  const user = await client.users.fetch(body.discord_id)
  const embed = new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle(`${EMOJI[body.kind] ?? "🔔"} ${body.title}`.slice(0, 256))
  if (body.body) embed.setDescription(body.body.slice(0, 2000))
  const components = body.kind === "invite" && body.event_id
    ? [rsvpButtons(body.event_id, body.url)]
    : body.url ? [linkButton("Open", body.url)] : []
  try {
    await user.send({ embeds: [embed], components })
    return "dm"
  } catch (err) {
    // DMs refused (no shared server, or "allow DMs from server members" is off):
    // ping them in the channel the reminder was made in, if we know it
    if (!body.channel_id) throw err
    const channel = await client.channels.fetch(body.channel_id)
    if (!channel?.isTextBased()) throw err
    await channel.send({
      content: `<@${body.discord_id}> (I couldn't DM you, so here it is)`,
      embeds: [embed],
      components,
      allowedMentions: { users: [body.discord_id] },
    })
    log(`/dm to ${body.discord_id} refused (${err.message}); pinged in channel ${body.channel_id} instead`)
    return "channel"
  }
}
