#!/usr/bin/env zsh
# Preview The Patriarchs' Altar locally.
#   ./preview.sh        -> this computer only (safest). Opens http://localhost:8099
#   ./preview.sh --lan  -> also reachable from your phone on the same Wi-Fi
#   Ctrl+C              -> stop
# Nothing here is published; this only runs on your machine.

PORT=8099
HOST="127.0.0.1"
LAN_NOTE=""

if [[ "$1" == "--lan" ]]; then
  HOST="0.0.0.0"
  LAN_NOTE="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

cd "${0:a:h}" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  print -u2 "python3 not found - install it with: sudo apt install python3"
  exit 1
fi

print "Serving $(pwd)"
print "Open: http://localhost:$PORT    (Ctrl+C to stop)"

if [[ -n "$LAN_NOTE" ]]; then
  print ""
  print "LAN mode: anyone on this network can reach http://$LAN_NOTE:$PORT"
  print "That shows the phone LAYOUT only - installing and offline mode need"
  print "https, so test those on the live site instead."
else
  print "(this computer only - use ./preview.sh --lan to also open it on your phone)"
fi

# Open the browser a moment after the server starts.
( sleep 1; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &

exec python3 -m http.server "$PORT" --bind "$HOST"
