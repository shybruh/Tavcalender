// DM delivery + the "ping them in the channel instead" fallback, with a fake Discord client.
import { test } from "node:test"
import assert from "node:assert/strict"
import { deliverDm } from "../src/deliver.js"

const refused = Object.assign(new Error("Cannot send messages to this user"), { code: 50007 })

function fakeClient({ dmWorks }) {
  const sent = { dms: [], channel: [] }
  return {
    sent,
    users: { fetch: async (id) => ({ id, send: async (m) => { if (!dmWorks) throw refused; sent.dms.push(m) } }) },
    channels: { fetch: async (id) => ({ id, isTextBased: () => true, send: async (m) => sent.channel.push(m) }) },
  }
}

const reminder = { discord_id: "111", kind: "reminder", title: "⏰ Buy cake", body: "", url: "https://cal.example.com/reminders" }

test("DMs when it can", async () => {
  const c = fakeClient({ dmWorks: true })
  assert.equal(await deliverDm(c, { ...reminder, channel_id: "999" }), "dm")
  assert.equal(c.sent.dms.length, 1)
  assert.equal(c.sent.channel.length, 0)
  assert.match(c.sent.dms[0].embeds[0].toJSON().title, /Buy cake/)
})

test("falls back to pinging in the reminder's channel when DMs are refused", async () => {
  const c = fakeClient({ dmWorks: false })
  const logs = []
  assert.equal(await deliverDm(c, { ...reminder, channel_id: "999" }, (m) => logs.push(m)), "channel")
  const msg = c.sent.channel[0]
  assert.match(msg.content, /^<@111>/)
  assert.deepEqual(msg.allowedMentions, { users: ["111"] }, "pings only that person")
  assert.match(msg.embeds[0].toJSON().title, /Buy cake/)
  assert.match(logs[0], /pinged in channel 999/)
})

test("still fails loudly when there's no channel to fall back to", async () => {
  const c = fakeClient({ dmWorks: false })
  await assert.rejects(deliverDm(c, { ...reminder, channel_id: "" }), /Cannot send messages/)
})

test("invites keep their Going / Maybe / Can't go buttons", async () => {
  const c = fakeClient({ dmWorks: true })
  await deliverDm(c, { discord_id: "111", kind: "invite", title: "Sam invited you", event_id: "abc", url: "https://x/event/abc" })
  const ids = c.sent.dms[0].components[0].toJSON().components.map((b) => b.custom_id).filter(Boolean)
  assert.deepEqual(ids, ["rsvp:abc:going", "rsvp:abc:maybe", "rsvp:abc:no"])
})
