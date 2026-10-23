// Drives the real command handlers with simulated Discord interactions against a running
// PocketBase (dev). Needs PB_URL, BOT_SECRET and TEST_* logins in the environment.
//
//   PB_URL=http://127.0.0.1:8090 BOT_SECRET=... TEST_BOB=email:pass TEST_CAROL=email:pass node --test test/
import { test } from "node:test"
import assert from "node:assert/strict"
import { Collection } from "discord.js"

const { PB_URL, BOT_SECRET, TEST_BOB, TEST_CAROL } = process.env
const run = PB_URL && BOT_SECRET && TEST_BOB && TEST_CAROL
const BOB = "551000000000000001"
const CAROL = "551000000000000002"
const STRANGER = "551000000000000009"
const CHANNEL = "551000000000000100"

async function pb(path, { method = "GET", body, token, bot } = {}) {
  const r = await fetch(PB_URL + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}), ...(bot ? { "x-bot-secret": BOT_SECRET } : {}) },
    body: body && JSON.stringify(body),
  })
  const t = await r.text()
  return t ? JSON.parse(t) : null
}
const login = async (cred) => {
  const [identity, password] = cred.split(":")
  return pb("/api/collections/users/auth-with-password", { method: "POST", body: { identity, password } })
}
async function link(discordId, name, token) {
  const l = await pb("/api/tav/bot/link", { method: "POST", body: { discord_id: discordId, discord_name: name }, bot: true })
  await pb("/api/tav/discord/claim", { method: "POST", body: { token: new URL(l.url).searchParams.get("t") }, token })
}

/** Checks a message payload against Discord's limits by serialising every builder. */
function validate(payload) {
  const components = (payload.components ?? []).map((c) => (c.toJSON ? c.toJSON() : c))
  assert.ok(components.length <= 5, "max 5 rows")
  for (const row of components) {
    assert.ok(row.components.length >= 1 && row.components.length <= 5, "1-5 items per row")
    for (const c of row.components) {
      if (c.options) assert.ok(c.options.length <= 25, `select ${c.custom_id} has ${c.options.length} options`)
      if (c.custom_id) assert.ok(c.custom_id.length <= 100)
      if (c.label) assert.ok(c.label.length <= 80)
    }
  }
  for (const e of payload.embeds ?? []) (e.toJSON ? e.toJSON() : e)
  if (payload.content) assert.ok(payload.content.length <= 2000)
  return components
}

/** A minimal stand-in for discord.js interactions; records what the bot sends back. */
function fake(kind, { user = BOB, customId, values, options = {}, fields = {} } = {}) {
  const out = { replies: [], updates: [], modals: [], channelPosts: [] }
  const i = {
    out,
    user: { id: user, username: user === BOB ? "bob" : "carol", globalName: user === BOB ? "Bob" : "Carol", bot: false, displayName: "Bob", displayAvatarURL: () => undefined },
    channelId: CHANNEL,
    guildId: "551000000000000200",
    channel: { name: "plans", type: 0, send: async (m) => { validate(m); out.channelPosts.push(m) } },
    customId,
    values,
    users: new Collection((values ?? []).map((v) => [v, { id: v, bot: false }])),
    commandName: options.command,
    deferred: false,
    replied: false,
    options: {
      getString: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
      getUser: (n) => (options[n] ? { id: options[n], toString: () => `<@${options[n]}>` } : null),
      getSubcommand: () => options.sub,
      getFocused: () => options.focused ?? "",
    },
    fields: { getTextInputValue: (k) => fields[k] ?? "" },
    isModalSubmit: () => kind === "modal",
    isAutocomplete: () => kind === "autocomplete",
    isChatInputCommand: () => kind === "command",
    reply: async (p) => { validate(p); i.replied = true; out.replies.push(p) },
    followUp: async (p) => { out.replies.push(p) },
    update: async (p) => { validate(p); out.updates.push(p) },
    deferUpdate: async () => { i.deferred = true },
    editReply: async (p) => { validate(p); out.updates.push(p) },
    showModal: async (m) => { out.modals.push(m.toJSON()) },
    respond: async (choices) => { out.choices = choices },
  }
  return i
}

const lastPanel = (i) => i.out.updates.at(-1) ?? i.out.replies.at(-1)
const row = (payload, n) => (payload.components[n].toJSON ? payload.components[n].toJSON() : payload.components[n]).components

test("discord bot flows", { skip: !run && "set PB_URL, BOT_SECRET, TEST_BOB, TEST_CAROL" }, async (t) => {
  const { startPlan, handlePlanInteraction } = await import("../src/plan.js")
  const { onCommand, onRsvpButton, onAutocomplete, definitions } = await import("../src/commands.js")
  const { NotLinkedError } = await import("../src/api.js")

  const bob = await login(TEST_BOB)
  const carol = await login(TEST_CAROL)
  await link(BOB, "bob", bob.token)
  await link(CAROL, "carol", carol.token)
  const created = []

  await t.test("slash command definitions are valid", () => {
    assert.deepEqual(definitions.map((d) => d.name).sort(), ["free", "group", "plan", "register", "remind", "today", "week"])
  })

  await t.test("/register for a linked user says so and offers a relink link", async () => {
    const i = fake("command", { options: { command: "register" } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /already linked as \*\*Bob\*\*/)
    assert.ok(i.out.replies[0].flags, "private reply")
  })

  await t.test("/register for a stranger gives a connect link", async () => {
    const i = fake("command", { user: STRANGER, options: { command: "register" } })
    await onCommand(i)
    const btn = row(i.out.replies[0], 0)[0]
    assert.equal(btn.label, "Connect my account")
    assert.match(btn.url, /\/link\/discord\?t=/)
  })

  await t.test("stranger can't /plan", async () => {
    const i = fake("command", { user: STRANGER, options: { command: "plan", title: "x" } })
    await assert.rejects(onCommand(i), NotLinkedError)
  })

  let eventId
  await t.test("/plan panel: pick day, time, audience, invite carol, details, create", async () => {
    const start = fake("command", { options: { command: "plan", title: "Bot test bowling" } })
    const p = await startPlan(start)
    const panel = start.out.replies[0]
    assert.equal(panel.components.length, 5)
    assert.match(panel.content, /Bot test bowling/)

    const days = row(panel, 0)[0].options
    const day = days[2].value // the day after tomorrow
    let i = fake("select", { customId: `plan:${p.id}:day`, values: [day] })
    await handlePlanInteraction(i)
    assert.equal(p.day, day)

    i = fake("select", { customId: `plan:${p.id}:time`, values: ["19:00"] })
    await handlePlanInteraction(i)
    assert.equal(p.time, "19:00")

    i = fake("select", { customId: `plan:${p.id}:time`, values: ["other"] })
    await handlePlanInteraction(i)
    assert.equal(i.out.modals[0].title, "Pick a time")
    i = fake("modal", { customId: `plan:${p.id}:m-time`, fields: { time: "7.30pm" } })
    await handlePlanInteraction(i)
    assert.equal(p.time, "19:30")

    i = fake("button", { customId: `plan:${p.id}:length` })
    await handlePlanInteraction(i)
    assert.equal(p.length, 120)

    i = fake("select", { customId: `plan:${p.id}:audience`, values: ["family"] })
    await handlePlanInteraction(i)
    assert.equal(p.audience, "family")
    i = fake("button", { customId: `plan:${p.id}:post` })
    await handlePlanInteraction(i)
    assert.equal(p.post, false, "family plans can't be posted publicly")
    assert.equal(row(lastPanel(i), 4).find((b) => b.custom_id.endsWith(":post")).disabled, true)

    i = fake("select", { customId: `plan:${p.id}:audience`, values: ["friends"] })
    await handlePlanInteraction(i)
    i = fake("button", { customId: `plan:${p.id}:post` })
    await handlePlanInteraction(i)
    assert.equal(p.post, true)

    i = fake("select", { customId: `plan:${p.id}:invite`, values: [CAROL, STRANGER] })
    await handlePlanInteraction(i)
    assert.ok(p.linked[CAROL] && !p.linked[STRANGER])
    assert.match(lastPanel(i).content, /Not linked yet: <@551000000000000009>/)

    i = fake("modal", { customId: `plan:${p.id}:m-details`, fields: { title: "Bot test bowling", location: "Strike Lanes", details: "Bring socks" } })
    await handlePlanInteraction(i)
    assert.equal(p.location, "Strike Lanes")

    const other = fake("button", { user: CAROL, customId: `plan:${p.id}:create` })
    await handlePlanInteraction(other)
    assert.match(other.out.replies[0].content, /isn't your plan panel/)

    i = fake("button", { customId: `plan:${p.id}:create` })
    await handlePlanInteraction(i)
    const done = lastPanel(i)
    assert.match(done.content, /is on your calendar/)
    assert.match(done.content, /Invited 1 person/)
    assert.match(done.content, /aren't linked yet|isn't linked yet/)
    assert.equal(i.out.channelPosts.length, 1, "posted in channel")
    eventId = row(i.out.channelPosts[0], 0)[0].custom_id.split(":")[1]
    created.push(eventId)

    const ev = await pb(`/api/collections/events/records/${eventId}`, { token: bob.token })
    assert.equal(ev.title, "Bot test bowling")
    assert.equal(ev.audience, "friends")
    assert.equal(ev.location, "Strike Lanes")
    assert.deepEqual(ev.guests, [carol.record.id])
    const mins = (new Date(ev.end.replace(" ", "T")) - new Date(ev.start.replace(" ", "T"))) / 60000
    assert.equal(mins, 120)

    const expired = fake("button", { customId: `plan:${p.id}:create` })
    await handlePlanInteraction(expired)
    assert.match(expired.out.replies[0].content, /expired/)
  })

  await t.test("carol RSVPs with the channel button", async () => {
    const i = fake("button", { user: CAROL, customId: `rsvp:${eventId}:going` })
    await onRsvpButton(i)
    assert.match(i.out.replies[0].content, /You're going/)
    const rs = await pb(`/api/collections/rsvps/records?filter=${encodeURIComponent(`event="${eventId}" && user="${carol.record.id}"`)}`, { token: carol.token })
    assert.equal(rs.items[0].status, "going")
  })

  await t.test("/today and /week list it", async () => {
    const i = fake("command", { options: { command: "week" } })
    await onCommand(i)
    assert.match(i.out.replies[0].embeds[0].toJSON().description, /Bot test bowling/)
  })

  await t.test("/free shows bob's plan to carol", async () => {
    const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)
    const i = fake("command", { user: CAROL, options: { command: "free", who: BOB, day } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /Bot test bowling|busy/)
  })

  await t.test("/remind creates a reminder", async () => {
    const i = fake("command", { options: { command: "remind", when: "in 3 hours", what: "bot test reminder" } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /I'll remind you/)
    const r = await pb(`/api/collections/reminders/records?filter=${encodeURIComponent('title="bot test reminder"')}`, { token: bob.token })
    assert.equal(r.items.length, 1)
    const at = new Date(r.items[0].remind_at.replace(" ", "T"))
    assert.ok(Math.abs(at - Date.now() - 3 * 3600e3) < 120e3, "about 3h from now")
    await pb(`/api/collections/reminders/records/${r.items[0].id}`, { method: "DELETE", token: bob.token })
  })

  await t.test("/group connect + plan defaults to that group + announce rules", async () => {
    const g = await pb("/api/collections/calendars/records", { method: "POST", body: { name: "Bot test group", owner: bob.record.id }, token: bob.token })
    created.push(["group", g.id])
    const ac = fake("autocomplete", { options: { focused: "bot test" } })
    await onAutocomplete(ac)
    assert.ok(ac.out.choices.some((c) => c.value === g.id))

    let i = fake("command", { user: CAROL, options: { command: "group", sub: "connect", group: g.id } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /Pick one of your groups/, "carol isn't a member")

    i = fake("command", { options: { command: "group", sub: "connect", group: g.id, announce: true } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /now connected to \*\*Bot test group\*\*/)

    i = fake("command", { options: { command: "group", sub: "status" } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /announced here/)

    const start = fake("command", { options: { command: "plan", title: "Group default test" } })
    const p = await startPlan(start)
    assert.equal(p.audience, "group")
    assert.deepEqual(p.groups, [g.id])

    i = fake("command", { options: { command: "group", sub: "disconnect" } })
    await onCommand(i)
    assert.match(i.out.replies[0].content, /Disconnected/)
  })

  await t.test("panel stays within Discord limits with many groups", async () => {
    const extra = []
    for (let n = 0; n < 22; n++) extra.push(await pb("/api/collections/calendars/records", { method: "POST", body: { name: `Limit ${n}`, owner: bob.record.id }, token: bob.token }))
    const start = fake("command", { options: { command: "plan", title: "Limits" } })
    await startPlan(start) // validate() asserts the 25-option cap
    for (const g of extra) await pb(`/api/collections/calendars/records/${g.id}`, { method: "DELETE", token: bob.token })
  })

  // cleanup
  for (const c of created) {
    if (Array.isArray(c)) await pb(`/api/collections/calendars/records/${c[1]}`, { method: "DELETE", token: bob.token })
    else await pb(`/api/collections/events/records/${c}`, { method: "DELETE", token: bob.token })
  }
  await pb("/api/tav/discord/unlink", { method: "POST", token: bob.token })
  await pb("/api/tav/discord/unlink", { method: "POST", token: carol.token })
})
