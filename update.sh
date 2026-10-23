#!/usr/bin/env bash
# Update Tav Calendar on the VPS: pull the latest code, back up the database,
# rebuild and restart. Safe to run any time; your .env and pb_data/ are never touched.
#
#   bash update.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env here. Copy .env.example to .env and fill it in first (see deploy/DEPLOY.md)." >&2
  exit 1
fi

echo "==> Pulling latest code"
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ] && [ "${1:-}" != "--force" ]; then
  echo "Already up to date. (Run 'bash update.sh --force' to rebuild anyway.)"
  exit 0
fi
git log --oneline "$before..$after" | sed 's/^/    /'

if [ -d pb_data ]; then
  echo "==> Backing up pb_data"
  mkdir -p backups
  tar -czf "backups/pb_data-$(date +%Y%m%d-%H%M%S).tar.gz" pb_data
  # keep the 10 most recent backups
  ls -1t backups/pb_data-*.tar.gz | tail -n +11 | xargs -r rm --
fi

echo "==> Rebuilding and restarting"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "==> Status"
docker compose ps
echo "Done. Database changes (if any) were applied on start. Logs: docker compose logs -f"
