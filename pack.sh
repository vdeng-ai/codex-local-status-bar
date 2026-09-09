#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$ROOT/dist"
SCHEMA="$ROOT/schemas/org.gnome.shell.extensions.codex-local-status-bar.gschema.xml"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/*.shell-extension.zip

gnome-extensions pack \
  --force \
  --out-dir="$OUT_DIR" \
  --schema="$SCHEMA" \
  --extra-source=lib \
  --extra-source=icons \
  --extra-source=prefs.js \
  --extra-source=stylesheet.css \
  "$ROOT"

echo "Bundle written to: $OUT_DIR"
