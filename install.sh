#!/usr/bin/env bash
set -euo pipefail

UUID="codex-local-status-bar@vdeng-ai.github.io"
LEGACY_UUID="codex-local-status-bar@vdeng.local"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
DEST="$EXTENSIONS_DIR/$UUID"
LEGACY_DEST="$EXTENSIONS_DIR/$LEGACY_UUID"

for cmd in gnome-extensions glib-compile-schemas; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "$cmd not found" >&2
    exit 1
  }
done

# Migrate the pre-public development UUID. The GSettings schema ID/path stay
# unchanged, so existing position/font/refresh preferences are preserved.
if [[ -d "$LEGACY_DEST" ]] || gnome-extensions info "$LEGACY_UUID" >/dev/null 2>&1; then
  gnome-extensions disable "$LEGACY_UUID" >/dev/null 2>&1 || true
  rm -rf "$LEGACY_DEST"
  echo "Migrated legacy extension UUID: $LEGACY_UUID"
fi

rm -rf "$DEST"
mkdir -p "$DEST/lib" "$DEST/icons" "$DEST/schemas"

cp "$ROOT/metadata.json" "$DEST/"
cp "$ROOT/extension.js" "$DEST/"
cp "$ROOT/prefs.js" "$DEST/"
cp "$ROOT/stylesheet.css" "$DEST/"
cp "$ROOT/lib/rate-limits.js" "$DEST/lib/"
cp "$ROOT/lib/session-reader.js" "$DEST/lib/"
cp "$ROOT/icons/codex.svg" "$DEST/icons/"
cp "$ROOT/schemas/org.gnome.shell.extensions.codex-local-status-bar.gschema.xml" "$DEST/schemas/"

glib-compile-schemas "$DEST/schemas"

ENABLED_VALUE="$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null || true)"
if [[ "$ENABLED_VALUE" == *"$UUID"* ]]; then
  ENABLE_STATE="enabled preference preserved"
else
  ENABLE_STATE="not enabled yet"
fi

cat <<EOF
Installed: $DEST
State:     $ENABLE_STATE

To load this version safely on GNOME 46+:
  log out and back in

Do not use Alt+F2 -> r for this extension update. An in-place GNOME Shell
restart can hang when several third-party extensions are loaded.
EOF

if [[ "$ENABLE_STATE" == "not enabled yet" ]]; then
  cat <<EOF

After logging back in, enable it once if needed:
  gnome-extensions enable "$UUID"
EOF
fi

cat <<EOF

Verify:
  gnome-extensions info "$UUID"

Open settings:
  gnome-extensions prefs "$UUID"
EOF
