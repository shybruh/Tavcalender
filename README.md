# Tav Calendar

A self-hosted shared calendar for a group of friends. People sign up and an admin lets them in; then everyone has their own calendar, adds friends (labelled friend / close friend / family / partner), makes groups, and chooses per plan who can see it. Everyone else just sees you as busy. Invites with "are you free?", RSVPs, shared notes, personal reminders, and an optional Discord bot for making plans without opening the app. Mobile-first, installable as a PWA, with push notifications.

**Stack:** React + Vite + shadcn/ui (Base UI) + Tailwind v4 · PocketBase (auth, DB, realtime, JS hooks, cron) · a tiny Node service for Web Push.

```
web/       React app (builds into backend/pb_public, served by PocketBase)
backend/   PocketBase migrations (schema + access rules) and hooks
push/      Web Push sender (PocketBase's JS runtime can't do push encryption)
discord/   Discord bot (discord.js); `npm test` drives its commands against a running dev server
deploy/    Dockerfiles + self-hosting guide
```

## How it works

- **Signup → approval.** The first admin is whoever signs up with `ADMIN_EMAIL` (set in `.env`), or, if that's empty, the very first account. Everyone after that starts as `pending`; admins get a notification and approve them in **Admin → Sign-ups**. The pending screen flips to the app live once approved. That's the admin's only job: they have no access to anyone's plans, friends or groups.
- **Your calendar.** Everyone gets their own calendar automatically, and every event lives there. When you add one you choose who sees it:
  **Private** · **Partner** · **Close friends** · **Family** · **Friends** (everyone you're connected with) · **Groups** (tick one or more, or "Select all").
  Anyone you're connected with who isn't in that audience just sees you as **busy** for that time, with no details.
- **Friends (People → Friends).** Add people and pick what they are to you: friend, close friend, family or partner. It's a request until they add you back (with their own label for you). Your labels are private, and they decide which of your plans each person sees.
- **Groups (People → Groups).** Anyone can create a group (a friend circle, family, just you and your partner…) and owns it. Others can ask to join (the owner approves) or be invited by any member. Members post plans and notes. Only the author can edit or delete a post; the owner can remove a post from the group (it stays on the author's own calendar) and remove members.
- **Home.** Your own week: your events (private included), invites waiting for an answer, events you're going to, and today's reminders.
- **Calendar.** One month view of everything you can see: your plans, friends' plans shared with you, group posts, and friends' busy blocks. Filter by person or group. The list icon switches to an agenda view.
- **Invites.** Invite friends to your event. If someone looks busy then, you'll see *"Sam is busy with Gym. Ask if they're free?"* (or just "busy" when you can't see the details), and saying yes sends them an "are you free?" request instead of a normal invite. They answer Going / Maybe / Decline and you get notified.
- **Events:** timed or all-day, multi-day, location (opens in Maps), details, RSVP, "Add to my calendar" (.ics).
- **Notes:** private, or shared with a group. Optionally pinned to a day so they show on the calendar.
- **Reminders:** private. Free-form ("remind me Friday 18:00") or tied to an event ("30 min before", which follows the event if it moves). A PocketBase cron job checks every minute.
- **Notifications:** sign-ups (admins), approval, friend requests and accepts, group join requests / invites / approvals, new group posts, invites and "are you free?" requests, RSVPs, event changes, posts removed from a group, reminders. Shown in the bell inbox and sent as push to every device that turned them on.

- **Discord bot (optional).** Admins set it up in **Admin → Discord** (paste the app ID and bot token; no server config). People link their account with `/register`, then:
  `/plan` (an interactive panel: day / time / who sees it / invite people with Discord's member picker / optional "post here"), `/remind`, `/today`, `/week`, `/free @someone`, and `/group connect` to make a channel default to one of your groups. Invites and reminders arrive as DMs with Going / Maybe / Can't go buttons. The bot acts *as* the linked person with a short-lived login, so it can never see more than they could. Plans are only posted in a channel when you tick "Post here", and private / partner / close-friends / family plans never are.

All of this is enforced by PocketBase API rules and server hooks (`backend/pb_hooks/audience.pb.js` resolves who can see each event), not just the UI.

## Local development

Requires Node 22+.

```bash
cd push && npm install && cd ..
cd web && npm install && cd ..
cp .env.example .env    # then fill in VAPID keys + PUSH_SECRET
```

Generate VAPID keys with `cd push && npx web-push generate-vapid-keys`. Download the PocketBase binary for your OS from https://github.com/pocketbase/pocketbase/releases (v0.40.x) into `backend/`.

```bash
./dev.sh                   # PocketBase on :8090 + push service on :8091
cd web && npm run dev      # Vite on :5173 with hot reload, proxies /api to :8090
```

Or `cd web && npm run build` and open http://localhost:8090, which is how production runs.

The PocketBase dashboard is at `/_/` (create a superuser the first time). You only need it for backups or poking at data. Day-to-day admin happens in the app.

## Self-hosting

Everything runs with Docker from a git checkout (the website is built inside Docker too).
You need a Linux server with Docker and git, and HTTPS in front of it (a reverse proxy or a
Cloudflare Tunnel pointed at port 3007).

```bash
git clone https://github.com/<you>/Tavcalender.git ~/tavcal && cd ~/tavcal
cp .env.example .env    # fill in keys, secrets, TZ and ADMIN_EMAIL
bash update.sh --force
```

Then sign up with your `ADMIN_EMAIL`, and you're the admin. Every later update is `bash update.sh`
(pull, back up the database, rebuild, restart). Your data and `.env` stay on your server.

The Discord bot is optional and uses **your own** bot: create one in the Discord developer
portal and paste its ID and token in the app under **Admin → Discord**.

Full steps, rollback and notes: [deploy/DEPLOY.md](deploy/DEPLOY.md).

## Push notifications

- Android / desktop Chrome, Edge, Firefox: turn them on from **Settings → Notifications** (or the banner on the Reminders/Notifications page).
- iPhone / iPad (iOS 16.4+): add the site to the home screen first (Share → Add to Home Screen), open it from there, then turn notifications on.
- "Send test notification" in Settings checks the whole chain.
- Times in notification text use the server's `TZ`; the app itself always shows each person's local time.

## Notes / limits

- No recurring events yet. Birthdays have to be added per year.
- Logging out removes that device's push subscription.
- Password reset emails need SMTP set up in the PocketBase dashboard (Settings → Mail settings).

## License

[MIT](LICENSE)
