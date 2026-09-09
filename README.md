# Codex Local Status Bar

> A lightweight GNOME Shell extension that shows Codex quota pools directly in the top bar — using only data that Codex has already written locally.

[简体中文](README.zh-CN.md)

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-46--50-4A86CF?logo=gnome&logoColor=white)
![Ubuntu](https://img.shields.io/badge/Ubuntu-24.04%20tested-E95420?logo=ubuntu&logoColor=white)
![GJS](https://img.shields.io/badge/GJS-ESM-F7DF1E?logo=javascript&logoColor=111)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Release](https://img.shields.io/github/v/release/vdeng-ai/codex-local-status-bar?display_name=tag)](https://github.com/vdeng-ai/codex-local-status-bar/releases)

```text
[Codex icon]  5h 88% / 7d 83% | Reserve 7d 100%
```

Codex Local Status Bar is designed for people who use the Codex CLI or Codex desktop tooling on GNOME and want a small, always-visible quota indicator without another account integration or background API client.

It keeps independent allowance pools separate. The normal Codex pool and GPT/Luna Reserve (`base_model_inference` / `gpt-reserve`) can be displayed side by side instead of overwriting one another.

## Highlights

- **Multiple independent quota pools** in the GNOME top bar
- Shows **remaining percentage**, reset time, and freshness of each local snapshot
- Prefers Codex response headers already recorded in `~/.codex/logs_*.sqlite`
- Falls back to `~/.codex/sessions/**/*.jsonl` (or `$CODEX_HOME/sessions`)
- Does **not** read `~/.codex/auth.json`
- Does **not** handle access tokens, refresh tokens, cookies, or API keys
- Does **not** call OpenAI, ChatGPT, or any third-party endpoint
- Async Gio file scanning to keep GNOME Shell responsive
- Configurable **Left / Right** panel position
- Configurable **12–32 px** quota font size with a numeric stepper
- Configurable **15 / 30 / 60 / 120 second** local refresh interval
- Manual **Refresh local data** action
- Native GNOME/Adwaita preferences window
- No telemetry, analytics, daemon, or Node runtime; `sqlite3` is optional and used read-only for the freshest local response-log data

## Why local Codex data?

Recent Codex builds expose the freshest quota information in response headers that are also written into Codex's local `logs_*.sqlite` database. Older/session-level snapshots are still available in JSONL transcripts. The extension uses both without creating its own network request.

```text
~/.codex/logs_*.sqlite ── read-only sqlite3 ──┐
                                             ├─ quota-pool parser ── GNOME top bar
~/.codex/sessions/**/*.jsonl ─ async fallback ┘
```

That means the extension does not need to reuse your Codex login session, refresh OAuth tokens, or poll a private backend endpoint.

| Approach | Codex Local Status Bar |
| --- | --- |
| Reads local response-log headers | ✅ |
| Reads local session snapshots | ✅ fallback |
| Reads `auth.json` | ❌ |
| OAuth/token refresh | ❌ |
| OpenAI backend polling | ❌ |
| Third-party server | ❌ |
| Telemetry | ❌ |

Because every source is local, values change only after Codex itself persists newer quota information. The local response log is usually fresher than session JSONL, but the Codex App UI can still be slightly ahead when it has in-memory/background state that has not yet been persisted. The popup shows each pool's update age so that lag is visible rather than hidden.

## Interface

### Top bar

```text
[icon] 5h 88% / 7d 83% | Reserve 7d 100%
```

Remaining quota is color coded:

- green: 70–100%
- yellow: 30–69%
- red: below 30%

### Popup

Click the indicator to see:

- each detected quota pool separately
- every pool's window percentages and reset times
- age of each pool's newest local snapshot
- whether the value came from the local response log or session fallback
- current local refresh interval
- **Refresh local data**
- **Settings…**

### Preferences

Settings are applied live:

- **Panel position:** Left / Right
- **Font size:** 12–32 px, adjusted with a numeric stepper
- **Refresh interval:** 15 / 30 / 60 / 120 seconds

Default values are Right, 14 px, and 30 seconds.

## Requirements

- GNOME Shell 46–50
- Ubuntu 24.04 is the primary tested environment
- Codex CLI / Codex app must already be writing local Codex data
- `sqlite3` is recommended for the freshest `logs_*.sqlite` source; session JSONL remains the automatic fallback

This project is actively tested on **Ubuntu 24.04 / GNOME Shell 46**. Shell versions 47–50 are declared compatible; reports and fixes from users on those versions are welcome.

Check your environment:

```bash
gnome-shell --version
command -v sqlite3
find ~/.codex -maxdepth 1 -type f -name 'logs_*.sqlite' -print
find ~/.codex/sessions -type f -name '*.jsonl' | head
```

## Installation

### GitHub Release

Download the latest `*.shell-extension.zip` from [Releases](https://github.com/vdeng-ai/codex-local-status-bar/releases), then install it:

```bash
gnome-extensions install --force \
  codex-local-status-bar@vdeng-ai.github.io.shell-extension.zip
```

Log out and back in, then enable it if necessary:

```bash
gnome-extensions enable codex-local-status-bar@vdeng-ai.github.io
```

Open preferences:

```bash
gnome-extensions prefs codex-local-status-bar@vdeng-ai.github.io
```

### From source

```bash
git clone https://github.com/vdeng-ai/codex-local-status-bar.git
cd codex-local-status-bar
bash install.sh
```

Then log out and back in.

> On GNOME 46+, this project intentionally recommends logging out/in instead of `Alt+F2 → r`. In-place Shell restarts can hang when several third-party extensions are loaded.

## Upgrade from the pre-release development build

Early local builds used the temporary UUID:

```text
codex-local-status-bar@vdeng.local
```

`install.sh` automatically disables/removes that development UUID and installs the public UUID:

```text
codex-local-status-bar@vdeng-ai.github.io
```

The GSettings schema is unchanged, so existing position, font-size, and refresh-interval preferences are preserved.

## Uninstall

```bash
bash uninstall.sh
```

Or disable/remove the extension manually:

```bash
gnome-extensions disable codex-local-status-bar@vdeng-ai.github.io
rm -rf ~/.local/share/gnome-shell/extensions/codex-local-status-bar@vdeng-ai.github.io
```

Log out and back in afterward.

## Build

Build the GNOME extension ZIP:

```bash
bash pack.sh
```

The package is written to `dist/`.

## Development and testing

Parser, privacy, GNOME Shell I/O invariants, and the async reader fixture:

```bash
npm test
npm run check
npm run smoke:reader
```

Before installing UI changes into your real desktop, run the isolated nested-Shell smoke test:

```bash
npm run smoke:gnome
```

The smoke test uses a temporary extension directory and GSettings database, verifies the extension reaches `State: ACTIVE`, changes position/refresh/font settings live, and then shuts the nested Shell down.

The test suite also prevents runtime code from accidentally introducing:

- HTTP/HTTPS access
- `fetch()` / libsoup
- `auth.json` reads
- OAuth/access-token/refresh-token handling
- synchronous GNOME Shell file I/O such as `load_contents()` or `enumerate_children()`

## GNOME Extensions website

A submission to [extensions.gnome.org](https://extensions.gnome.org/) is planned. The project is being kept close to the GNOME Shell extension review guidelines: clean `enable()`/`disable()` lifecycle, async file I/O, native GSettings/preferences, no telemetry, and no bundled binaries.

Until the EGO package is approved, GitHub Releases are the canonical distribution channel.

## Project structure

```text
extension.js             GNOME top-bar indicator and settings bindings
prefs.js                 GNOME/Adwaita preferences window
icons/                   panel artwork
schemas/                 GSettings schema
lib/log-reader.js        read-only sqlite3 reader for persisted Codex response headers
lib/session-reader.js    async session JSONL fallback reader + mtime cache
lib/usage-reader.js      merges/prioritizes local quota sources and pools
lib/rate-limits.js       pure quota/header/session parser
stylesheet.css           panel UI styles
test/                    parser, privacy, and async-I/O regression tests
smoke-test-gnome.sh      isolated nested-GNOME load test
install.sh               local source installer + legacy UUID migration
uninstall.sh             local uninstaller
pack.sh                  extension ZIP builder
SECURITY.md              runtime trust boundary and security invariants
```

## Security model

See [SECURITY.md](SECURITY.md) for the explicit runtime trust boundary.

The short version: the extension is a read-only viewer for quota metadata Codex has already persisted locally. It reads only selected response-header fields from `logs_*.sqlite` plus session rate-limit snapshots as fallback. Prompt text, model responses, tool calls, cookies, and credentials are not surfaced by the UI.

## Contributing

Bug reports, GNOME-version compatibility reports, and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

The top-bar UX was inspired by [`ondrejbecva/codex-claude-status-bar`](https://github.com/ondrejbecva/codex-claude-status-bar). The original local-only architecture was inspired by [`Almighty-Shogun/codex-gnome-extension`](https://github.com/Almighty-Shogun/codex-gnome-extension).

This project intentionally does **not** copy the API/OAuth provider architecture of the former; it consumes only data that the installed Codex client has already persisted locally.

## Disclaimer

This is an independent, unofficial project and is not affiliated with or endorsed by OpenAI. OpenAI, ChatGPT, and Codex are trademarks of OpenAI.

## License

[MIT](LICENSE)
