/// <reference path="../pb_data/types.d.ts" />

// Event-linked reminders ("30 min before") derive remind_at from the event start.
onRecordCreate((e) => require(`${__hooks}/utils.js`).syncRemindAt(e), "reminders")
onRecordUpdate((e) => {
  // re-arm a reminder whose time was moved into the future
  if (e.record.getString("remind_at") !== e.record.original().getString("remind_at")) {
    e.record.set("sent", false)
  }
  require(`${__hooks}/utils.js`).syncRemindAt(e)
}, "reminders")

// Every minute: turn due reminders into notifications (which also push).
cronAdd("tav_reminders", "* * * * *", () => {
  const u = require(`${__hooks}/utils.js`)
  const due = $app.findRecordsByFilter("reminders", "sent = false && remind_at <= @now", "remind_at", 200, 0)
  for (const r of due) {
    const eventId = r.getString("event")
    let body = ""
    if (eventId) {
      try {
        const ev = $app.findRecordById("events", eventId)
        body = u.fmtDate(ev.getDateTime("start"), ev.getBool("all_day"))
        if (ev.getString("location")) body += ` · ${ev.getString("location")}`
      } catch (_) { /* event gone */ }
    }
    u.notify($app, [r.getString("user")], {
      title: `⏰ ${r.getString("title")}`,
      body,
      url: eventId ? `/event/${eventId}` : "/reminders",
      kind: "reminder",
      discord_channel: r.getString("discord_channel"),
    })
    r.set("sent", true)
    $app.save(r)
  }
})
