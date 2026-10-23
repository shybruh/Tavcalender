# Deploying Tav Calendar

This folder is everything the VPS needs. The app answers on **port 3007**; point your
Cloudflare Tunnel's public hostname at `http://localhost:3007`.

```
tavcal/
  docker-compose.yml
  .env                 secrets (push keys etc.). Keep it private, keep it the same across updates
  pocketbase/          the app: PocketBase + built website + server logic
  push/                small service that sends push notifications
  discord/             the Discord bot (optional; does nothing until you set it up in the app)
  pb_data/             created on first start: the database + uploads (back this up)
```

## First time

1. Upload the `tavcal` folder to the VPS (e.g. `~/tavcal`).
2. Set your timezone in `.env` (`TZ=Europe/London`, etc.). It's used for times in notification text.
3. Start it:
   ```bash
   cd ~/tavcal
   docker compose up -d --build
   docker compose ps          # all three should be "running"; tavcal-web becomes "healthy"
   ```
4. Create the dashboard login (the PocketBase admin panel at `https://your-domain/_/`):
   ```bash
   docker compose exec pocketbase /pb/pocketbase superuser upsert you@example.com 'a-long-password' --dir /pb/pb_data
   ```
5. Open the site and **sign up first**. The first account becomes the app admin.
6. In the dashboard (`/_/`):
   - **Settings → Application → User IP proxy headers**: add `CF-Connecting-IP` so rate limits see real visitor IPs, not Cloudflare's.
   - **Settings → Rate limits**: enable.
   - **Settings → Backups**: turn on a daily automatic backup.
   - Optional, **Settings → Mail settings**: add SMTP for password-reset emails.

## Discord bot (optional)

Everything is set up from the app; there's nothing to edit on the VPS.

1. Log in as the admin and open **Admin → Discord**.
2. Follow the steps there: create an application at discord.com/developers, paste its
   **Application ID** and **Bot token**, and save.
3. Within 30 seconds the status turns green. Click **Add bot to a server**.
4. Everyone types `/register` in Discord to link their account.

The bot only connects out to Discord, so the tunnel doesn't need any changes.
`docker compose logs -f discord` shows what it's doing.

## Updating

Upload the new bundle over the old folder **without** deleting `pb_data/` (and keep your `.env`), then:

```bash
cd ~/tavcal
docker compose up -d --build
```

Database changes apply automatically on start. Back up `pb_data/` first to be safe.

## Notes

- If `cloudflared` runs directly on the VPS, you can make the app reachable only through the tunnel
  by changing the port line to `"127.0.0.1:3007:8090"`.
- Push notifications need the site to be opened over HTTPS (the tunnel URL), not `http://ip:3007`.
- Logs: `docker compose logs -f pocketbase` / `push` / `discord`.
- If your `.env` predates the Discord bot, add a `BOT_SECRET=` line with any long random string
  (newer bundles include it).
