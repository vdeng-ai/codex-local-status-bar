# Security and Privacy Model

## Runtime trust boundary

`Codex Local Status Bar` is a local, read-only viewer for quota metadata that the installed Codex client has already persisted.

Runtime code may read only:

- the extension's GNOME GSettings preferences;
- local Codex response-log databases:

  ```text
  ~/.codex/logs_*.sqlite
  ```

  or `$CODEX_HOME/logs_*.sqlite` when `CODEX_HOME` is explicitly set;
- the Codex session transcript tree as a fallback:

  ```text
  ~/.codex/sessions/**/*.jsonl
  ```

  or `$CODEX_HOME/sessions/**/*.jsonl`.

The response-log path is queried with the local `sqlite3` executable using `-readonly`. The extension does not open or modify the database itself and does not create a network request.

## Response-log data minimization

A Codex HTTP log row may contain many unrelated response headers. The extension deliberately does **not** return the entire log row to GJS.

The fixed SQLite query slices only the quota-header region beginning at `x-codex-active-limit` and ending before `x-models-etag`. This keeps unrelated headers such as `set-cookie` out of the extension process.

From that quota-only slice, the parser recognizes fields such as:

- `x-*-primary-used-percent` / `x-*-secondary-used-percent`;
- `x-*-primary-window-minutes` / `x-*-secondary-window-minutes`;
- reset timestamps / reset-after values;
- quota-pool names such as `gpt-reserve`;
- non-secret plan/active-limit labels used only for local presentation.

Independent prefixes are kept as independent quota pools. For example, the normal `x-codex-*` pool and `x-base-model-inference-*` / `gpt-reserve` pool are never merged into each other.

## Session fallback data minimization

For JSONL fallback, only `event_msg` records with `payload.type == "token_count"` and a non-null `payload.rate_limits` object are interpreted. Prompt text, model responses, tool calls, transcript file-path payloads, and account credentials are not surfaced by the UI.

The session parser extracts only quota percentages, window durations, reset metadata, pool identity, and timestamps required to select the newest snapshot.

## Explicit non-goals

Runtime code must not:

- read `auth.json` or another credential store;
- read browser cookies, browser Local Storage, or Electron credential/session stores;
- handle access tokens, refresh tokens, cookies, API keys, or OAuth state;
- open HTTP/HTTPS URLs;
- import or use libsoup;
- call `fetch()`;
- use `Gio.File.new_for_uri()`;
- launch Codex solely to force quota refreshes;
- invoke `codex app-server`, account APIs, or rate-limit RPCs;
- upload local data, telemetry, analytics, crash data, or identifiers.

The fact that a Codex response log was originally produced by the official Codex client does not authorize the extension to repeat that request. The extension only consumes the already-persisted local result.

## Polling behavior

The extension refresh interval is user-selectable: 15, 30, 60, or 120 seconds (default: 30 seconds).

On each refresh it:

1. asynchronously finds the newest local `logs_*.sqlite` database;
2. when `sqlite3` exists, executes one fixed read-only query through `Gio.Subprocess`;
3. asynchronously scans session JSONL as a fallback/secondary source;
4. merges sources by timestamp while keeping quota pools independent.

A new refresh is queued instead of overlapping a refresh already in flight. JSONL parsing also stops as soon as the required normal Codex windows are found, avoiding unnecessary reads of large historical transcripts.

If `sqlite3` is absent or the response-log query cannot produce quota data, session JSONL remains available automatically.

## Freshness limitation

The Codex desktop UI may temporarily show a value newer than any locally persisted quota snapshot. For example, the app can hold an updated quota response in process memory before a matching response-header record is written to `logs_*.sqlite`.

The extension does not cross its security boundary to eliminate this lag. It will not inspect browser credential stores, scrape Electron process memory, invoke app-server, or issue its own account request. The popup exposes update age so this local-persistence lag remains visible.

## Regression protection

`test/no-network.test.js` scans the Shell runtime, preferences runtime, and readers/parsers and fails if common network or credential-handling primitives are introduced.

`test/no-sync-shell-io.test.js` rejects synchronous Gio file calls in the GNOME Shell runtime.

`smoke-test-reader.sh` creates an isolated local SQLite response-log fixture plus session fallback and verifies that independent Codex and GPT Reserve pools are parsed correctly.

`smoke-test-gnome.sh` loads the extension in an isolated nested GNOME Shell before UI changes are installed on the real desktop.

These automated checks are conservative guardrails rather than a formal security proof. Code review remains required for changes to `extension.js`, `prefs.js`, and `lib/`.
