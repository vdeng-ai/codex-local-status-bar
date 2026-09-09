#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
CODEX_DIR="$TMP/codex"
FIXTURE_DIR="$CODEX_DIR/sessions/2026/09/09"
FIXTURE="$FIXTURE_DIR/rollout-fixture.jsonl"
LOG_DB="$CODEX_DIR/logs_2.sqlite"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

for cmd in gjs sqlite3; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "$cmd not found" >&2
    exit 1
  }
done

mkdir -p "$FIXTURE_DIR"
cat >"$FIXTURE" <<'EOF'
{"timestamp":"2026-09-09T00:00:00.000Z","type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":27.0,"window_minutes":300,"resets_at":1789999999},"secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":1790999999}}}}
EOF

sqlite3 "$LOG_DB" <<'SQL'
CREATE TABLE logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  ts_nanos INTEGER NOT NULL,
  feedback_log_body TEXT
);
INSERT INTO logs (ts, ts_nanos, feedback_log_body) VALUES (
  1788916800,
  0,
  'headers={"x-codex-active-limit": "premium", "x-codex-plan-type": "plus", "x-codex-primary-used-percent": "12", "x-codex-secondary-used-percent": "17", "x-codex-primary-window-minutes": "300", "x-codex-secondary-window-minutes": "10080", "x-codex-primary-reset-at": "1789999999", "x-codex-secondary-reset-at": "1790999999", "x-base-model-inference-primary-used-percent": "0", "x-base-model-inference-secondary-used-percent": "0", "x-base-model-inference-primary-window-minutes": "10080", "x-base-model-inference-secondary-window-minutes": "0", "x-base-model-inference-primary-reset-at": "1791999999", "x-base-model-inference-limit-name": "gpt-reserve", "x-models-etag": "fixture"}'
);
SQL

export CODEX_HOME="$CODEX_DIR"
export READER_URI="file://$ROOT/lib/usage-reader.js"

gjs -c '
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const loop = new GLib.MainLoop(null, false);

import(GLib.getenv("READER_URI")).then(async module => {
  try {
    const reader = new module.LocalUsageReader();
    const usage = await reader.readLatest(new Gio.Cancellable());
    const codex = usage.pools.find(pool => pool.id === "codex");
    const reserve = usage.pools.find(pool => pool.id === "base_model_inference");

    const actual = {
      sourceKind: usage.sourceKind,
      poolCount: usage.pools.length,
      fiveHour: codex?.primary?.remainingPercent ?? null,
      weekly: codex?.secondary?.remainingPercent ?? null,
      reserveWeekly: reserve?.primary?.remainingPercent ?? null,
    };
    const expected = {
      sourceKind: "local-response-log",
      poolCount: 2,
      fiveHour: 88,
      weekly: 83,
      reserveWeekly: 100,
    };

    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(`Unexpected local reader result: ${JSON.stringify(actual)}`);

    print(`Local reader fixture smoke test: PASS ${JSON.stringify(actual)}`);
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
