import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"

/** Going / Maybe / Can't go buttons (+ an "Open" link) for a plan. */
export function rsvpButtons(eventId, url) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rsvp:${eventId}:going`).setLabel("Going").setStyle(ButtonStyle.Success).setEmoji("✅"),
    new ButtonBuilder().setCustomId(`rsvp:${eventId}:maybe`).setLabel("Maybe").setStyle(ButtonStyle.Secondary).setEmoji("🤔"),
    new ButtonBuilder().setCustomId(`rsvp:${eventId}:no`).setLabel("Can't go").setStyle(ButtonStyle.Secondary).setEmoji("❌"),
  )
  if (url) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Open").setURL(url))
  return row
}

export function linkButton(label, url) {
  return new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url))
}

/** Friendly reply when someone can't act in the app yet. */
export function notLinkedMessage(reason) {
  if (reason === "pending") return "Your account is waiting for an admin to approve it. You'll be able to use this once you're in."
  if (reason === "rejected") return "Your account wasn't approved, so I can't do that."
  return "You haven't linked your account yet. Type `/register` to connect it (takes a few seconds)."
}
