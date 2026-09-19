#!/usr/bin/env zsh
# Preview The Patriarchs' Altar locally.
#   ./preview.sh        -> serves this folder and opens http://localhost:8099
#   Ctrl+C              -> stop
# Nothing here is published; this only runs on your machine.

PORT=8099
cd "${0:a:h}" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  print -u2 "python3 not found - install it with: sudo apt install python3"
  exit 1
fi

print "Serving $(pwd)"
print "Open: http://localhost:$PORT    (Ctrl+C to stop)"

# Open the browser a moment after the server starts.
( sleep 1; xdg-open "http://localhost:$PORT" >/dev/null 2>&1 || true ) &

exec python3 -m http.server "$PORT"
