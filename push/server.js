// Tiny web-push sender used by PocketBase hooks (pb_hooks/utils.js -> sendPush).
// PocketBase's JS runtime can't do the push encryption itself, so it POSTs here.
//
// POST /send  { subscriptions: [{endpoint, keys}], payload: {title, body, url, tag} }
//   -> { sent: n, expired: [endpoint, ...] }
//
// Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com),
//      PUSH_SECRET (shared with PocketBase), PUSH_PORT (default 8091), HOST (default 127.0.0.1)

import http from "node:http"
import webpush from "web-push"

const {
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
  VAPID_SUBJECT = "mailto:admin@example.com",
  PUSH_SECRET = "",
  PUSH_PORT = "8091",
  HOST = "127.0.0.1",
} = process.env

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("Missing VAPID keys. Generate with: npx web-push generate-vapid-keys")
  process.exit(1)
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ""
    req.on("data", (c) => {
      data += c
      if (data.length > 1_000_000) reject(new Error("body too large"))
    })
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")) } catch (err) { reject(err) }
    })
    req.on("error", reject)
  })
}

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true })
  if (req.method !== "POST" || req.url !== "/send") return reply(res, 404, { error: "not found" })
  if (PUSH_SECRET && req.headers["x-push-secret"] !== PUSH_SECRET) {
    return reply(res, 401, { error: "unauthorized" })
  }

  let body
  try {
    body = await readJson(req)
  } catch {
    return reply(res, 400, { error: "invalid json" })
  }

  const subs = Array.isArray(body.subscriptions) ? body.subscriptions : []
  const payload = JSON.stringify(body.payload || {})
  const expired = []
  let sent = 0

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 * 60 * 24 })
      sent++
    } catch (err) {
      // 404/410 = subscription is gone, tell PocketBase to delete it
      if (err.statusCode === 404 || err.statusCode === 410) expired.push(sub.endpoint)
      else console.warn("push failed", err.statusCode, err.body || err.message)
    }
  }))

  reply(res, 200, { sent, expired })
})

server.listen(Number(PUSH_PORT), HOST, () => {
  console.log(`tav-push listening on http://${HOST}:${PUSH_PORT}`)
})
