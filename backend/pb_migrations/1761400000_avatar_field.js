/// <reference path="../pb_data/types.d.ts" />

// Avatars: the app shrinks photos before upload, so cap the size, drop SVG
// (it can carry scripts) and pre-define the thumbnail sizes the UI asks for.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const avatar = users.fields.getByName("avatar")
  avatar.maxSize = 2 * 1024 * 1024
  avatar.mimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]
  avatar.thumbs = ["100x100", "200x200"]
  app.save(users)
}, (app) => {
  const users = app.findCollectionByNameOrId("users")
  const avatar = users.fields.getByName("avatar")
  avatar.maxSize = 0
  avatar.mimeTypes = ["image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"]
  avatar.thumbs = []
  app.save(users)
})
