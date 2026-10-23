#!/usr/bin/env bash
# Runs PocketBase + the push service + the Discord bot locally with the vars from .env
set -a; source "$(dirname "$0")/.env"; set +a
cd "$(dirname "$0")"
node push/server.js &
PUSH_PID=$!
PB_URL=http://127.0.0.1:8090 node discord/src/index.js &
BOT_PID=$!
trap "kill $PUSH_PID $BOT_PID" EXIT
PB=./backend/pocketbase; [ -f "$PB.exe" ] && PB="$PB.exe"
"$PB" serve --dir backend/pb_data --hooksDir backend/pb_hooks --migrationsDir backend/pb_migrations --publicDir backend/pb_public --http 127.0.0.1:8090
