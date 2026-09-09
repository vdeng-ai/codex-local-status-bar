# Contributing

Thanks for helping improve Codex Local Status Bar.

## Before opening an issue

Please include:

- GNOME Shell version (`gnome-shell --version`)
- distribution/version
- extension version or Git commit
- whether `~/.codex/logs_*.sqlite` or `~/.codex/sessions` contains recent local Codex data
- relevant GNOME Shell log lines

Useful diagnostics:

```bash
gnome-shell --version
gnome-extensions info codex-local-status-bar@vdeng-ai.github.io
journalctl --user -b | grep -F 'Codex Local Status Bar'
```

Do not post `~/.codex/auth.json`, access tokens, cookies, API keys, or complete session transcripts in public issues.

## Development workflow

Run all lightweight checks before submitting a PR:

```bash
npm test
npm run check
npm run smoke:reader
```

For UI/runtime changes, also run the isolated nested GNOME Shell smoke test:

```bash
npm run smoke:gnome
```

The extension should reach:

```text
State: ACTIVE
```

## Runtime invariants

Changes to runtime code must preserve these project constraints:

- quota data comes only from Codex data already persisted locally (`logs_*.sqlite` plus session JSONL fallback)
- local SQLite access stays read-only and quota-field-only
- no `auth.json`, browser cookie, or browser Local Storage reads
- no OAuth/token handling
- no `codex app-server` quota/account RPC
- no OpenAI or third-party backend polling
- no telemetry
- no synchronous file I/O on the GNOME Shell main thread
- everything created/connected in `enable()` must be cleaned up in `disable()`

Regression tests enforce the most important parts of this boundary.

## Compatibility reports

Ubuntu 24.04 / GNOME Shell 46 is the primary development environment. Reports and tested patches for GNOME Shell 47–50 are particularly useful.

## Pull requests

Keep changes focused and reviewable. Avoid generated/minified bundles and unnecessary runtime dependencies. GNOME Shell extension code should remain plain, readable GJS.
