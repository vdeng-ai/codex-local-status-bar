#!/usr/bin/env bash
set -euo pipefail

UUID="codex-local-status-bar@vdeng-ai.github.io"
LEGACY_UUID="codex-local-status-bar@vdeng.local"
EXTENSIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"

for id in "$UUID" "$LEGACY_UUID"; do
  gnome-extensions disable "$id" >/dev/null 2>&1 || true
  rm -rf "$EXTENSIONS_DIR/$id"
done

echo "Removed: $UUID"
echo "Log out and back in to reload GNOME Shell safely."
