/// <reference path="../pb_data/types.d.ts" />

// Reminders set with /remind remember the Discord channel they were made in, so if the bot
// can't DM the person (no shared server / DMs closed) it pings them in that channel instead.
migrate((app) => {
  for (const name of ["reminders", "notifications"]) {
    const c = app.findCollectionByNameOrId(name)
    c.fields.add(new TextField({ name: "discord_channel", max: 30 }))
    app.save(c)
  }
}, (app) => {
  for (const name of ["reminders", "notifications"]) {
    const c = app.findCollectionByNameOrId(name)
    c.fields.removeByName("discord_channel")
    app.save(c)
  }
})
