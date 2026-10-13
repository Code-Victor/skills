#!/usr/bin/env bash
# Start a Chrome the capture scripts can drive, with its own persistent
# profile: log in to your app once in this window and it stays logged in.
#
#   scripts/chrome.sh                 # port 9222, default profile
#   PORT=9223 PROFILE=~/my-profile scripts/chrome.sh
#
# Already have a logged-in profile you want to reuse? Seed a kept one with the
# clone-browser-profile skill (`browser.py open <app> --from <profile>`) and
# point --port at the port it prints; that path also handles Keychain, session
# restore and the enterprise notice. Chrome refuses remote debugging on the
# profile it's currently using, so never point PROFILE at the live one.
set -euo pipefail

PORT="${PORT:-9222}"
PROFILE="${PROFILE:-$HOME/.cache/ui-demo-video/chrome-profile}"
mkdir -p "$PROFILE"

if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null; then
  echo "Chrome already listening on $PORT"
  exit 0
fi

CHROME="${CHROME_PATH:-}"
if [[ -z "$CHROME" ]]; then
  for c in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(command -v google-chrome || true)" \
    "$(command -v google-chrome-stable || true)" \
    "$(command -v chromium || true)" \
    "$(command -v chromium-browser || true)"; do
    if [[ -n "$c" && -x "$c" ]]; then CHROME="$c"; break; fi
  done
fi
if [[ -z "$CHROME" ]]; then
  echo "Chrome not found. Set CHROME_PATH." >&2
  exit 1
fi

# A real (headed) window: screencasts need a composited, visible tab, and
# sites behind Cloudflare or SSO often reject headless Chrome.
# The throttling flags keep rAF running when the window is not frontmost, or
# exit animations never finish mid-capture. The last two stop every fresh
# profile downloading ~4 GB of on-device model plus ~500 MB of components.
"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  --window-size=1500,1000 \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-component-update \
  --disable-features=OptimizationGuideModelDownloading,OnDeviceModelPerformanceParams \
  >/dev/null 2>&1 &

for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$PORT/json/version" >/dev/null; then
    echo "Chrome ready on port $PORT (profile: $PROFILE)"
    exit 0
  fi
  sleep 0.2
done
echo "Chrome didn't open port $PORT" >&2
exit 1
