#!/usr/bin/env bash
# Start a Chrome the capture scripts can drive, with its own persistent
# profile. By default it is HEADLESS: no window, no Dock icon, no focus
# change, so recording never gets in your way.
#
#   scripts/chrome.sh                    # headless on port 9222 (start if absent)
#   scripts/chrome.sh --login [url]      # the one time a window appears: log in
#   scripts/chrome.sh                    # ...then this hands the session back
#   scripts/chrome.sh --window           # fallback for apps that refuse headless
#   scripts/chrome.sh --stop | --status   # --stop leaves a Chrome it did not start alone (--force overrides)
#   PORT=9223 PROFILE=~/my-profile SCALE=3 scripts/chrome.sh
#
# --login stops the headless Chrome on the profile, opens a normal window on
# the same profile (at the url, if given) and returns. A later plain
# chrome.sh (or --headless) reads every cookie out of that window over CDP
# (session cookies have no expiry and would die with the process), quits it
# cleanly, starts headless on the same profile and puts the cookies back.
# localStorage and IndexedDB live in the profile and carry over by themselves.
# A headed and a headless Chrome cannot share one profile at the same time,
# which is why it is a swap and not two browsers.
#
# --window is a headed Chrome that capture.mjs never focuses (it opens its tab
# in a window of its own, in the background). Chrome itself raises its window
# once, at launch, so start it before you settle into something else.
#
# SCALE (default 2) is the device pixel ratio the browser renders at: headless
# has no retina display, and without it the screencast comes out at 1x.
#
# Already have a logged-in profile you want to reuse? Seed a kept one with the
# clone-browser-profile skill (`browser.py open <app> --from <profile>`) and
# point --port at the port it prints; that path also handles Keychain, session
# restore and the enterprise notice. Chrome refuses remote debugging on the
# profile it's currently using, so never point PROFILE at the live one.
set -euo pipefail

PORT="${PORT:-9222}"
PROFILE="${PROFILE:-$HOME/.cache/ui-demo-video/chrome-profile}"
SCALE="${SCALE:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${XDG_CACHE_HOME:-$HOME/.cache}/ui-demo-video"
MODEFILE="$STATE/chrome-$PORT.mode"
PIDFILE="$STATE/chrome-$PORT.pid"
# Keyed by profile as well as port: a file left for one profile is never
# restored into another.
PKEY="$(printf '%s' "$PROFILE" | cksum | cut -d' ' -f1)"
COOKIES="$STATE/cookies-$PORT-$PKEY.json"
mkdir -p "$PROFILE" "$STATE"
# Session cookies are secrets: whatever happens, the file does not outlive the run.
trap 'rm -f "$COOKIES"' EXIT

want=headless; explicit=0; force=0; url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --headless) want=headless; explicit=1 ;;
    --window) want=window ;;
    --login) want=login; if [[ "${2:-}" && "${2:-}" != --* ]]; then url="$2"; shift; fi ;;
    --stop) want=stop ;;
    --status) want=status ;;
    --force) force=1 ;;
    *) echo "usage: chrome.sh [--headless | --window | --login [url] | --stop [--force] | --status]" >&2; exit 2 ;;
  esac
  shift
done

is_up() { curl -sf --max-time 2 "http://127.0.0.1:$PORT/json/version" >/dev/null; }
current_mode() { if is_up; then cat "$MODEFILE" 2>/dev/null || echo external; else echo stopped; fi; }
# The pid recorded at launch (if it is still this port's Chrome), else whatever
# listens on the port (needs lsof, which not every Linux has).
chrome_pid() {
  local p
  p="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "$p" ]] && ps -p "$p" -o command= 2>/dev/null | grep -q -- "--remote-debugging-port=$PORT"; then echo "$p"; return; fi
  if command -v lsof >/dev/null; then lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true; fi
}

find_chrome() {
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
  if [[ -z "$CHROME" ]]; then echo "Chrome not found. Set CHROME_PATH." >&2; exit 1; fi
}

# Same flags as ever. The throttling flags keep rAF running when the window is
# not frontmost, or exit animations never finish mid-capture. The last two stop
# every fresh profile downloading ~4 GB of on-device model plus ~500 MB of
# components. The crash-bubble flags keep a SIGTERM from showing "restore pages".
COMMON=(
  --remote-debugging-port="$PORT"
  --user-data-dir="$PROFILE"
  --no-first-run --no-default-browser-check
  --disable-background-timer-throttling
  --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding
  --disable-component-update
  --hide-crash-restore-bubble --disable-session-crashed-bubble
  --disable-features=OptimizationGuideModelDownloading,OnDeviceModelPerformanceParams
)

wait_up() {
  for _ in $(seq 1 75); do is_up && return 0; sleep 0.2; done
  echo "Chrome didn't open port $PORT" >&2; return 1
}

launch() { # launch <mode> [url]
  find_chrome
  local m="$1" u="${2:-}"
  case "$m" in
    headless)
      # The user agent says plain Chrome: some sites turn HeadlessChrome away.
      local major os
      major="$("$CHROME" --version 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 130)"
      if [[ "$(uname)" == Darwin ]]; then os="Macintosh; Intel Mac OS X 10_15_7"; else os="X11; Linux x86_64"; fi
      "$CHROME" --headless=new "${COMMON[@]}" --window-size=1500,1000 \
        --force-device-scale-factor="$SCALE" \
        --user-agent="Mozilla/5.0 ($os) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36" \
        >/dev/null 2>&1 &
      ;;
    window)
      local front=""
      if [[ "$(uname)" == Darwin ]]; then front="$(lsappinfo info -only name "$(lsappinfo front)" 2>/dev/null | sed -n 's/.*"LSDisplayName"="\(.*\)".*/\1/p' || true)"; fi
      "$CHROME" "${COMMON[@]}" --window-size=1500,1000 --force-device-scale-factor="$SCALE" >/dev/null 2>&1 &
      ;;
    login)
      "$CHROME" "${COMMON[@]}" --window-size=1500,1000 ${u:+"$u"} >/dev/null 2>&1 &
      ;;
  esac
  # Written before the wait: a Chrome that is slow to open its port is still
  # ours, not an "external" one.
  echo "$!" > "$PIDFILE"
  echo "$m" > "$MODEFILE"
  wait_up
  # Chrome raised itself at launch; give the screen back.
  if [[ "$m" == window && -n "${front:-}" ]]; then osascript -e "tell application \"$front\" to activate" >/dev/null 2>&1 || true; fi
}

stop_chrome() {
  local pid; pid="$(chrome_pid)"
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 75); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; sleep 0.5; fi
  fi
  # Let the profile lock go. SingletonLock is a symlink to "host-pid" that
  # dangles, so -e is always false: test the link itself.
  for _ in $(seq 1 25); do [[ -L "$PROFILE/SingletonLock" || -e "$PROFILE/SingletonLock" ]] || break; sleep 0.2; done
  rm -f "$MODEFILE" "$PIDFILE"
}

case "$want" in
  status)
    m="$(current_mode)"
    if [[ "$m" == stopped ]]; then echo "stopped (port $PORT, profile $PROFILE)"; exit 0; fi
    echo "$m on port $PORT (profile: $PROFILE, pid $(chrome_pid))"
    exit 0 ;;
  stop)
    m="$(current_mode)"
    if [[ "$m" == external && "$force" != 1 ]]; then
      echo "Chrome on port $PORT was not started by chrome.sh, so --stop leaves it alone (add --force to stop it anyway)." >&2
      exit 1
    fi
    stop_chrome
    echo "stopped (port $PORT)"
    exit 0 ;;
esac

cur="$(current_mode)"
if [[ "$cur" == "$want" ]] && [[ "$want" != login || -z "$url" ]]; then
  echo "Chrome already listening on $PORT ($cur)"
  exit 0
fi
if [[ "$cur" == external ]]; then
  echo "Chrome on port $PORT was not started by chrome.sh, so it is left alone (use another PORT, or quit it first)." >&2
  [[ "$want" == headless ]] && exit 0
  exit 1
fi
# A plain run leaves a running --window Chrome alone; --headless asks for the swap.
if [[ "$cur" == window && "$want" == headless && "$explicit" == 0 ]]; then
  echo "Chrome already listening on $PORT (window)"
  exit 0
fi

swapped=0
if [[ "$cur" != stopped ]]; then
  # Swap modes on the same profile, taking the login with us.
  if node "$HERE/chrome-session.mjs" save "$PORT" "$COOKIES" >/dev/null 2>&1; then swapped=1; else rm -f "$COOKIES"; fi
  stop_chrome
elif [[ -f "$MODEFILE" ]]; then
  # The mode file outlived its Chrome: the person closed the login window.
  if [[ "$(cat "$MODEFILE")" != headless ]]; then
    echo "The $(cat "$MODEFILE") Chrome was already closed, so session cookies that only lived in that window are gone; you may need to log in again."
  fi
  rm -f "$MODEFILE" "$PIDFILE"
fi
launch "$want" "$url"
# Only straight after a swap this very run: never a file left from earlier.
if [[ "$swapped" == 1 && -s "$COOKIES" ]]; then
  node "$HERE/chrome-session.mjs" restore "$PORT" "$COOKIES" 2>&1 | tail -1 || echo "Could not restore the session cookies." >&2
fi
case "$want" in
  login) echo "Chrome window open on port $PORT${url:+ at $url}: log in there, then run scripts/chrome.sh to go back to background mode." ;;
  *) echo "Chrome ready on port $PORT ($want, profile: $PROFILE)" ;;
esac
