// /remind end to end against a running PocketBase, with a fake bot service on BOT_URL's port:
// the reminder remembers its channel, and when due PocketBase asks the bot to DM with that channel
// as the fallback. Needs PB_URL, BOT_SECRET, TEST_BOB and FAKE_BOT_PORT (nothing else on it).
import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"

const { PB_URL, BOT_SECRET, TEST_BOB, FAKE_BOT_PORT } = process.env
const run = PB_URL && BOT_SECRET && TEST_BOB && FAKE_BOT_PORT
const BOB = "556000000000000001"
const CHANNEL = "556000000000000100"

async function pb(path, { method = "GET", body, token, bot } = {}) {
  const r = await fetch(PB_URL + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}), ...(bot ? { "x-bot-secret": BOT_SECRET } : {}) },
    body: body && JSON.stringify(body),
  })
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

test("/remind made in a channel pings there if the DM fails", { skip: !run && "set PB_URL, BOT_SECRET, TEST_BOB, FAKE_BOT_PORT", timeout: 120_000 }, async () => {
  const { onCommand } = await import("../src/commands.js")
  const [identity, password] = TEST_BOB.split(":")
  const bob = await pb("/api/collections/users/auth-with-password", { method: "POST", body: { identity, password } })
  const l = await pb("/api/tav/bot/link", { method: "POST", body: { discord_id: BOB, discord_name: "bob" }, bot: true })
  await pb("/api/tav/discord/claim", { method: "POST", body: { token: new URL(l.url).searchParams.get("t") }, token: bob.token })

  const received = []
  const fakeBot = http.createServer((req, res) => {
    let d = ""
    req.on("data", (c) => (d += c))
    req.on("end", () => { received.push({ path: req.url, secret: req.headers["x-bot-secret"], body: JSON.parse(d || "{}") }); res.end('{"ok":true}') })
  }).listen(Number(FAKE_BOT_PORT), "127.0.0.1")

  try {
    const replies = []
    await onCommand({
      commandName: "remind",
      user: { id: BOB },
      guildId: "556000000000000200",
      channelId: CHANNEL,
      options: { getString: (n) => ({ when: "in 1 second", what: "remind test" })[n] },
      reply: async (p) => replies.push(p),
    })
    assert.match(replies[0].content, /ping you in this channel if I can't/)

    const r = (await pb(`/api/collections/reminders/records?filter=${encodeURIComponent('title="remind test"')}`, { token: bob.token })).items[0]
    assert.equal(r.discord_channel, CHANNEL, "reminder remembers the channel")

    // the reminder job runs every minute
    for (let i = 0; i < 70 && !received.some((x) => x.path === "/dm"); i++) await new Promise((res) => setTimeout(res, 1000))
    const dm = received.find((x) => x.path === "/dm")
    assert.ok(dm, "PocketBase asked the bot to deliver it")
    assert.equal(dm.secret, BOT_SECRET)
    assert.equal(dm.body.discord_id, BOB)
    assert.equal(dm.body.kind, "reminder")
    assert.equal(dm.body.channel_id, CHANNEL, "with the channel to fall back to")
    assert.match(dm.body.title, /remind test/)

    await pb(`/api/collections/reminders/records/${r.id}`, { method: "DELETE", token: bob.token })
  } finally {
    fakeBot.close()
    await pb("/api/tav/discord/unlink", { method: "POST", token: bob.token })
  }
})
