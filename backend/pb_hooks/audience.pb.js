/// <reference path="../pb_data/types.d.ts" />

// Every time an event is saved, resolve its audience (private / partner / ... / groups)
// into the concrete list of users allowed to see it (events.audience_users).
// Access rules only ever look at audience_users, so this is the single source of truth.

onRecordCreate((e) => {
  const u = require(`${__hooks}/utils.js`)
  if (!e.record.getString("audience")) e.record.set("audience", "private")
  e.record.set("audience_users", u.resolveAudience(e.app, e.record))
  e.next()
}, "events")

onRecordUpdate((e) => {
  const u = require(`${__hooks}/utils.js`)
  if (!e.record.getString("audience")) e.record.set("audience", "private")
  e.record.set("audience_users", u.resolveAudience(e.app, e.record))
  e.next()
}, "events")
