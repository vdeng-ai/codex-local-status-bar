#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
FIXTURE_DIR="$TMP/codex/sessions/2026/09/08"
FIXTURE="$FIXTURE_DIR/rollout-fixture.jsonl"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

command -v gjs >/dev/null 2>&1 || {
  echo "gjs not found" >&2
  exit 1
}

mkdir -p "$FIXTURE_DIR"
cat >"$FIXTURE" <<'EOF'
{"timestamp":"2026-09-08T02:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":27.0,"window_minutes":300,"resets_at":1788841702},"secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":1789371725}}}}
EOF

export CODEX_HOME="$TMP/codex"
export READER_URI="file://$ROOT/lib/session-reader.js"

gjs -c '
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const loop = new GLib.MainLoop(null, false);

import(GLib.getenv("READER_URI")).then(async module => {
  try {
    const reader = new module.SessionUsageReader();
    const usage = await reader.readLatest(new Gio.Cancellable());

    const actual = {
      scannedFiles: usage.scannedFiles,
      fiveHour: usage.fiveHour?.remainingPercent ?? null,
      weekly: usage.weekly?.remainingPercent ?? null,
    };

    const expected = {scannedFiles: 1, fiveHour: 73, weekly: 59};
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`Unexpected reader result: ${JSON.stringify(actual)}`);

    print(`Reader fixture smoke test: PASS ${JSON.stringify(actual)}`);
  } catch (error) {
    printerr(error.stack ?? error.message ?? String(error));
    imports.system.exit(1);
  } finally {
    loop.quit();
  }
}).catch(error => {
  printerr(error.stack ?? error.message ?? String(error));
  loop.quit();
  imports.system.exit(1);
});

loop.run();
'
