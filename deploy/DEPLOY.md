# Self-hosting Tav Calendar

You need a server (any Linux VPS) with **Docker** and **git**, and a way to reach it over **HTTPS**:
a domain behind a reverse proxy (Caddy, nginx, Traefik…) or a Cloudflare Tunnel.
HTTPS is required for installing the app on phones and for push notifications.

The app runs from a git checkout with Docker Compose and answers on **port 3007**.
Point your reverse proxy / tunnel at `http://localhost:3007`.

## First time

1. Clone the repo (or your fork) on the server:
   ```bash
   git clone https://github.com/<you>/Tavcalender.git ~/tavcal
   cd ~/tavcal
   ```
   For a private fork, use an SSH [deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
   (read-only) and clone with `git@github.com:<you>/Tavcalender.git`.
2. Create `.env` from the example and fill it in:
   ```bash
   cp .env.example .env && nano .env
   ```
   - Push keys: `docker run --rm node:22-alpine npx -y web-push generate-vapid-keys`
   - `PUSH_SECRET` and `BOT_SECRET`: `openssl rand -hex 24` (one each)
   - `TZ`: your timezone, e.g. `Europe/London`
   - `ADMIN_EMAIL` (recommended): the email you'll sign up with. Only that address can become
     the first admin, so nobody else can claim a fresh install before you do.
3. Start it:
   ```bash
   bash update.sh --force
   ```
4. Create the dashboard login (PocketBase admin panel at `https://your-domain/_/`):
   ```bash
   docker compose exec pocketbase /pb/pocketbase superuser upsert you@example.com 'a-long-password' --dir /pb/pb_data
   ```
5. Open the site and **sign up** with your `ADMIN_EMAIL` (or, if you didn't set one, sign up
   before anyone else: the first account becomes the app admin).
6. In the dashboard (`/_/`):
   - **Settings → Application → User IP proxy headers**: add your proxy's real-IP header
     (`CF-Connecting-IP` for Cloudflare, usually `X-Forwarded-For` otherwise).
   - **Settings → Rate limits**: enable.
   - **Settings → Backups**: turn on a daily automatic backup (ideally to S3-compatible storage).
   - Optional, **Settings → Mail settings**: SMTP for password-reset emails.
7. Discord bot (optional): in the app, **Admin → Discord**. You create your own bot in the
   Discord developer portal and paste its ID and token there; the steps are on that page.

## Updating

```bash
cd ~/tavcal
bash update.sh
```

It pulls the latest commit, backs up `pb_data/` into `backups/` (keeps the last 10),
rebuilds the containers and restarts them. Database migrations run automatically on start.

### Rolling back

```bash
git log --oneline            # find the commit you want
git checkout <commit>        # go back to it
docker compose up -d --build
```
If a migration changed data, restore a backup too: `docker compose down`,
replace `pb_data/` with one from `backups/`, `docker compose up -d`. Return to the latest code later with
`git checkout main`.

## Notes

- If your proxy / tunnel runs on the same machine, you can make the app reachable only through it
  by changing the port line in `docker-compose.yml` to `"127.0.0.1:3007:8090"`
  (keep that as a local commit, or `git pull` may complain).
- Push notifications need the site opened over HTTPS, not `http://ip:3007`.
- Logs: `docker compose logs -f pocketbase` / `push` / `discord`.
- `.env`, `pb_data/` and `backups/` are git-ignored: updates never touch them.
