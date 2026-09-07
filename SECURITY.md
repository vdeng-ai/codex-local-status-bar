# Security and Privacy Model

## Runtime trust boundary

`Codex Local Status Bar` is designed as a local, read-only viewer for Codex rate-limit snapshots.

Runtime code may read only its local GNOME GSettings preferences plus the Codex session transcript tree:

```text
~/.codex/sessions/**/*.jsonl
```

or, when the user explicitly sets `CODEX_HOME`:

```text
$CODEX_HOME/sessions/**/*.jsonl
```

## Explicit non-goals

Runtime code must not:

- read `auth.json` or any other credential store;
- handle access tokens, refresh tokens, cookies, API keys, or OAuth state;
- open HTTP/HTTPS URLs;
- import or use libsoup;
- call `fetch()`;
- use `Gio.File.new_for_uri()`;
- launch Codex solely to force a quota refresh;
- invoke `codex app-server` or any account/rate-limit RPC;
- upload session contents, telemetry, analytics, crash data, or identifiers.

## Data minimization

Only `event_msg` records with `payload.type == "token_count"` and a non-null `payload.rate_limits` object are interpreted. Prompt text, responses, tool calls, file paths contained in transcript payloads, and token/account credentials are not surfaced by the UI.

The parser extracts only:

- `used_percent`;
- `window_minutes`;
- `resets_at` or `resets_in_seconds`;
- the event timestamp needed to decide which snapshot is newest.

## Polling behavior

The extension scans local filesystem metadata at a user-selectable interval of 15, 30, 60, or 120 seconds (default: 30 seconds). It uses asynchronous Gio enumeration/read operations, keeps only the 20 most recently modified JSONL files in the active parse set, and caches each file by modification time plus size so unchanged files are not reparsed.

Changing the refresh interval only restarts the local GLib timer. A new refresh is queued rather than overlapping an in-flight async scan. There is no network polling.

## Regression protection

`test/no-network.test.js` scans the Shell runtime, preferences runtime, and parser source files and fails if common network or credential-handling primitives are introduced.

`test/no-sync-shell-io.test.js` rejects synchronous Gio file calls in the GNOME Shell runtime so filesystem work cannot accidentally regress onto the Shell main thread.

These tests are intentionally simple and conservative. Code review remains required for changes to `extension.js`, `prefs.js`, and `lib/`.
