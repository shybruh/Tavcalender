// Talks to PocketBase. Two kinds of calls:
//  - bot routes (/api/tav/bot/*), authenticated with the shared BOT_SECRET
//  - normal API calls *as a linked user*, using a short-lived session token, so the
//    bot can only ever see and do what that person could in the app

const PB_URL = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/+$/, "")
const BOT_SECRET = process.env.BOT_SECRET || ""

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

async function call(path, { method = "GET", body, token, bot } = {}) {
  const res = await fetch(PB_URL + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: token } : {}),
      ...(bot ? { "x-bot-secret": BOT_SECRET } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { message: text } }
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export const bot = {
  config: () => call("/api/tav/bot/config", { bot: true }),
  heartbeat: (body) => call("/api/tav/bot/heartbeat", { method: "POST", body, bot: true }),
  link: (discord_id, discord_name) => call("/api/tav/bot/link", { method: "POST", body: { discord_id, discord_name }, bot: true }),
  resolve: (discord_ids) => call("/api/tav/bot/resolve", { method: "POST", body: { discord_ids }, bot: true }),
}

// ---- sessions -------------------------------------------------------------------------

/** Thrown when a Discord user can't act in the app (not linked / not approved). */
export class NotLinkedError extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason // "not_linked" | "pending" | "rejected"
  }
}

const sessions = new Map() // discord id -> { token, user, expires }

export async function session(discordId) {
  const cached = sessions.get(discordId)
  if (cached && cached.expires > Date.now()) return cached
  try {
    const s = await call("/api/tav/bot/session", { method: "POST", body: { discord_id: discordId }, bot: true })
    const entry = { ...s, expires: Date.now() + 25 * 60 * 1000 } // tokens last 30 min
    sessions.set(discordId, entry)
    return entry
  } catch (err) {
    if (err.status === 404) throw new NotLinkedError("not_linked")
    if (err.status === 403) throw new NotLinkedError(err.body?.error || "pending")
    throw err
  }
}

/** A tiny PocketBase client acting as one linked user. */
export async function asUser(discordId) {
  const s = await session(discordId)
  const q = (params) => (params ? "?" + new URLSearchParams(params).toString() : "")
  return {
    user: s.user,
    list: (collection, params) =>
      call(`/api/collections/${collection}/records${q({ perPage: "500", skipTotal: "1", ...params })}`, { token: s.token }).then((r) => r.items),
    get: (collection, id, params) => call(`/api/collections/${collection}/records/${id}${q(params)}`, { token: s.token }),
    create: (collection, body) => call(`/api/collections/${collection}/records`, { method: "POST", body, token: s.token }),
    update: (collection, id, body) => call(`/api/collections/${collection}/records/${id}`, { method: "PATCH", body, token: s.token }),
    remove: (collection, id) => call(`/api/collections/${collection}/records/${id}`, { method: "DELETE", token: s.token }),
    send: (path, opts = {}) => call(path, { ...opts, token: s.token }),
  }
}

/** PocketBase filter string escaping for values we interpolate. */
export const pbStr = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

/** PocketBase stores dates as "2026-10-23 11:13:22.171Z". */
export const toPb = (d) => d.toISOString().replace("T", " ")
export const parsePb = (s) => (s ? new Date(s.replace(" ", "T")) : null)
