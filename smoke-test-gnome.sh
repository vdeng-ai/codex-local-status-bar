#!/usr/bin/env bash
set -euo pipefail

UUID="codex-local-status-bar@vdeng-ai.github.io"
SCHEMA_ID="org.gnome.shell.extensions.codex-local-status-bar"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
DEST="$TMP/data/gnome-shell/extensions/$UUID"
LOG="$TMP/gnome-shell.log"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

for cmd in gnome-shell gnome-extensions glib-compile-schemas; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "$cmd not found" >&2
    exit 1
  }
done

mkdir -p "$DEST/lib" "$DEST/icons" "$DEST/schemas" "$TMP/config/glib-2.0/settings"
cp "$ROOT/metadata.json" "$ROOT/extension.js" "$ROOT/prefs.js" "$ROOT/stylesheet.css" "$DEST/"
cp "$ROOT/lib/rate-limits.js" "$ROOT/lib/session-reader.js" "$ROOT/lib/log-reader.js" "$ROOT/lib/usage-reader.js" "$DEST/lib/"
cp "$ROOT/icons/codex.svg" "$DEST/icons/"
cp "$ROOT/schemas/org.gnome.shell.extensions.codex-local-status-bar.gschema.xml" "$DEST/schemas/"
glib-compile-schemas "$DEST/schemas"

export XDG_DATA_HOME="$TMP/data"
export XDG_CONFIG_HOME="$TMP/config"
export GSETTINGS_BACKEND=keyfile
export GSETTINGS_SCHEMA_DIR="$DEST/schemas"

set +e
dbus-run-session bash -lc '
  set -u
  UUID="codex-local-status-bar@vdeng-ai.github.io"
  SCHEMA_ID="org.gnome.shell.extensions.codex-local-status-bar"
  LOG="'"$LOG"'"

  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "['\''$UUID'\'']"

  gnome-shell --nested --wayland >"$LOG" 2>&1 &
  SHELL_PID=$!

  STATE=""
  INFO=""
  for _ in $(seq 1 15); do
    sleep 1
    INFO="$(gnome-extensions info "$UUID" 2>/dev/null || true)"
    if printf "%s\n" "$INFO" | grep -q "State: ACTIVE"; then
      STATE="ACTIVE"
      break
    fi
    if ! kill -0 "$SHELL_PID" 2>/dev/null; then
      break
    fi
  done

  echo "--- EXTENSION INFO ---"
  printf "%s\n" "$INFO"

  if [ "$STATE" != "ACTIVE" ]; then
    echo "--- RELEVANT GNOME SHELL LOGS ---"
    grep -Ei -C 3 "codex-local|gtype|typeerror|referenceerror|extension.*error|js error" "$LOG" | tail -120 || true
    kill -TERM "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
    exit 1
  fi

  echo "--- LIVE SETTINGS CHANGE ---"
  gsettings set "$SCHEMA_ID" panel-position "'\''left'\''"
  gsettings set "$SCHEMA_ID" refresh-interval "'\''fifteen-seconds'\''"
  gsettings set "$SCHEMA_ID" font-size "'\''twelve'\''"
  sleep 1
  gsettings set "$SCHEMA_ID" panel-position "'\''right'\''"
  gsettings set "$SCHEMA_ID" refresh-interval "'\''two-minutes'\''"
  gsettings set "$SCHEMA_ID" font-size "'\''thirty-two'\''"
  sleep 1

  INFO_AFTER="$(gnome-extensions info "$UUID" 2>/dev/null || true)"
  printf "%s\n" "$INFO_AFTER"
  printf "panel-position=%s\n" "$(gsettings get "$SCHEMA_ID" panel-position)"
  printf "refresh-interval=%s\n" "$(gsettings get "$SCHEMA_ID" refresh-interval)"
  printf "font-size=%s\n" "$(gsettings get "$SCHEMA_ID" font-size)"

  if ! printf "%s\n" "$INFO_AFTER" | grep -q "State: ACTIVE"; then
    echo "Extension stopped being ACTIVE after live settings changes" >&2
    grep -Ei -C 3 "codex-local|gtype|typeerror|referenceerror|extension.*error|js error" "$LOG" | tail -120 || true
    kill -TERM "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
    exit 1
  fi

  if grep -Ei "codex local status bar.*(failed|error)|extension codex-local-status-bar.*error" "$LOG" >/dev/null 2>&1; then
    echo "Codex extension error found in nested Shell log" >&2
    grep -Ei -C 3 "codex-local|codex local status bar" "$LOG" | tail -120 || true
    kill -TERM "$SHELL_PID" 2>/dev/null || true
    wait "$SHELL_PID" 2>/dev/null || true
    exit 1
  fi

  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
  sleep 1
  kill -TERM "$SHELL_PID" 2>/dev/null || true
  wait "$SHELL_PID" 2>/dev/null || true

  echo "GNOME nested smoke test: PASS"
'
STATUS=$?
set -e

if [[ $STATUS -ne 0 ]]; then
  echo "Smoke test failed. Full nested Shell log was: $LOG" >&2
  exit $STATUS
fi
