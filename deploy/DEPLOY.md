# Deploying Tav Calendar

The VPS runs the app from a git checkout of this repo with Docker. Updates are one command.
The app answers on **port 3007**; point your Cloudflare Tunnel at `http://localhost:3007`.

## First time

1. Clone the repo on the VPS. It's private, so use a GitHub
   [personal access token](https://github.com/settings/tokens) (read-only "Contents" access to
   this repo is enough) as the password, or set up an SSH deploy key:
   ```bash
   git clone https://github.com/shybruh/Tavcalender.git ~/tavcal
   cd ~/tavcal
   ```
2. Create `.env` from the example and fill it in (or copy over your existing one):
   ```bash
   cp .env.example .env && nano .env
   ```
   Generate the values with `docker run --rm node:22-alpine npx -y web-push generate-vapid-keys`
   and `openssl rand -hex 24` (twice: `PUSH_SECRET` and `BOT_SECRET`). Set `TZ=Indian/Maldives`.
3. Start it:
   ```bash
   bash update.sh --force
   ```
4. Create the dashboard login (PocketBase admin panel at `https://your-domain/_/`):
   ```bash
   docker compose exec pocketbase /pb/pocketbase superuser upsert you@example.com 'a-long-password' --dir /pb/pb_data
   ```
5. Open the site and **sign up first**. The first account becomes the app admin.
6. In the dashboard (`/_/`):
   - **Settings → Application → User IP proxy headers**: add `CF-Connecting-IP`.
   - **Settings → Rate limits**: enable.
   - **Settings → Backups**: turn on a daily automatic backup.
   - Optional, **Settings → Mail settings**: SMTP for password-reset emails.
7. Discord (optional): **Admin → Discord** in the app; the steps are on that page.

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

## Switching over from the zip upload

If you already ran the zip version in another folder: stop it (`docker compose down` there),
clone the repo as above, then move that folder's `pb_data/` and `.env` into `~/tavcal` and run
`bash update.sh --force`. Same container names and port, so the tunnel keeps working.

## Notes

- If `cloudflared` runs directly on the VPS you can make the app reachable only through the
  tunnel by changing the port line in `docker-compose.yml` to `"127.0.0.1:3007:8090"`.
  (Do that in a local commit, or `git pull` may complain; or ask for it to be made the default.)
- Push notifications need the site opened over HTTPS (the tunnel URL), not `http://ip:3007`.
- Logs: `docker compose logs -f pocketbase` / `push` / `discord`.
- `.env`, `pb_data/` and `backups/` are git-ignored: updates never touch them.
