# Changelog

All notable changes to this project are documented here.

## v0.2.1 — 2026-09-07

First public-release candidate.

### Added

- Codex 5-hour and weekly quota in the GNOME top bar
- local-session-only data source (`~/.codex/sessions/**/*.jsonl`)
- reset times and snapshot freshness in the popup
- configurable Left/Right panel position
- configurable 12–16 px panel font size
- configurable 15/30/60/120 second local refresh interval
- native GNOME/Adwaita preferences
- manual local refresh action
- isolated nested GNOME Shell smoke test
- privacy/network regression tests
- synchronous-shell-I/O regression test
- public UUID: `codex-local-status-bar@vdeng-ai.github.io`
- migration from the early `codex-local-status-bar@vdeng.local` development UUID

### Changed

- local session scanning and file reads now use async Gio APIs
- runtime refreshes are de-duplicated while an async scan is in flight
- GitHub/EGO release metadata and documentation prepared for public distribution

## v0.2.0 — 2026-09-07

- added Codex-style panel icon
- added panel position and refresh interval preferences
- added GSettings schema and preferences window

## v0.1.1 — 2026-09-07

- simplified GNOME indicator lifecycle by directly instantiating `PanelMenu.Button`
- added nested GNOME Shell smoke testing

## v0.1.0 — 2026-09-07

- initial local-only proof of concept
