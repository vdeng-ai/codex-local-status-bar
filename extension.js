import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {SessionUsageReader} from './lib/session-reader.js';

const DEFAULT_REFRESH_SECONDS = 30;
const DEFAULT_FONT_SIZE = 14;
const REFRESH_INTERVALS = new Set([15, 30, 60, 120]);
const FONT_SIZES = new Set([12, 13, 14, 15, 16]);
const PANEL_BOXES = ['left', 'right'];
const LEVEL_CLASSES = [
  'codex-local-good',
  'codex-local-warning',
  'codex-local-critical',
  'codex-local-unknown',
];

function percentText(limit) {
  return limit ? `${Math.round(limit.remainingPercent)}%` : '--';
}

function levelClass(limit) {
  if (!limit)
    return 'codex-local-unknown';
  if (limit.remainingPercent >= 70)
    return 'codex-local-good';
  if (limit.remainingPercent >= 30)
    return 'codex-local-warning';
  return 'codex-local-critical';
}

function applyLevelClass(actor, limit) {
  for (const cssClass of LEVEL_CLASSES)
    actor.remove_style_class_name(cssClass);
  actor.add_style_class_name(levelClass(limit));
}

function localDateTime(ms) {
  if (!Number.isFinite(ms))
    return null;
  return GLib.DateTime.new_from_unix_local(Math.floor(ms / 1000));
}

function sameLocalDate(a, b) {
  return a && b &&
    a.get_year() === b.get_year() &&
    a.get_month() === b.get_month() &&
    a.get_day_of_month() === b.get_day_of_month();
}

function formatReset(ms) {
  const reset = localDateTime(ms);
  if (!reset)
    return 'reset unknown';

  const now = GLib.DateTime.new_now_local();
  if (sameLocalDate(reset, now))
    return `resets ${reset.format('%H:%M')}`;

  return `resets ${reset.format('%b %e %H:%M')}`;
}

function formatFreshness(ms) {
  if (!Number.isFinite(ms))
    return 'No Codex rate-limit event found yet';

  const ageSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ageSeconds < 60)
    return `Latest Codex update: ${ageSeconds}s ago`;
  if (ageSeconds < 3600)
    return `Latest Codex update: ${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400)
    return `Latest Codex update: ${Math.floor(ageSeconds / 3600)}h ago`;

  const date = localDateTime(ms);
  return date ? `Latest Codex update: ${date.format('%b %e %H:%M')}` : 'Latest Codex update: unknown';
}

function popupWindowText(name, limit) {
  if (!limit)
    return `${name}: unavailable`;
  return `${name}: ${percentText(limit)} left · ${formatReset(limit.resetsAtMs)}`;
}

function iconStyleForFile(extensionPath, iconBasename) {
  return `background-image: url("file://${extensionPath}/icons/${iconBasename}");`;
}

export default class CodexLocalStatusBarExtension extends Extension {
  enable() {
    this._reader = new SessionUsageReader();
    this._settings = this.getSettings();
    this._cancellable = new Gio.Cancellable();
    this._timerId = 0;
    this._refreshInFlight = false;
    this._refreshQueued = false;
    this._settingsSignalIds = [];

    this._settingsSignalIds.push(
      this._settings.connect('changed::panel-position', () => this._rebuildIndicator()),
      this._settings.connect('changed::refresh-interval', () => this._onRefreshIntervalChanged()),
      this._settings.connect('changed::font-size', () => this._applyFontSize())
    );

    this._buildIndicator();
    this._requestRefresh(false);
    this._startTimer();
  }

  disable() {
    this._stopTimer();
    this._cancellable?.cancel();

    if (this._settings) {
      for (const signalId of this._settingsSignalIds ?? [])
        this._settings.disconnect(signalId);
    }
    this._settingsSignalIds = [];

    this._destroyIndicator();

    this._reader = null;
    this._settings = null;
    this._cancellable = null;
    this._refreshInFlight = false;
    this._refreshQueued = false;
  }

  _buildIndicator() {
    this._indicator = new PanelMenu.Button(0.0, 'Codex Local Usage');

    const box = new St.BoxLayout({
      style_class: 'panel-status-menu-box codex-local-panel',
      y_align: Clutter.ActorAlign.CENTER,
    });

    // Match the reference extension's approach: a plain St.Widget with a CSS
    // background image preserves the SVG's embedded brand color. St.Icon may
    // recolor file icons through GNOME's symbolic-icon panel styling.
    const icon = new St.Widget({
      style_class: 'codex-local-icon',
      style: iconStyleForFile(this.path, 'codex.svg'),
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._fiveLabel = new St.Label({
      text: '5h --',
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'codex-local-window codex-local-unknown',
    });

    this._separatorLabel = new St.Label({
      text: '/',
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'codex-local-separator',
    });

    this._weeklyLabel = new St.Label({
      text: '7d --',
      y_align: Clutter.ActorAlign.CENTER,
      style_class: 'codex-local-window codex-local-unknown',
    });

    box.add_child(icon);
    box.add_child(this._fiveLabel);
    box.add_child(this._separatorLabel);
    box.add_child(this._weeklyLabel);
    this._indicator.add_child(box);
    this._applyFontSize();

    const titleItem = new PopupMenu.PopupMenuItem(
      'Codex usage · local session data',
      {reactive: false}
    );
    titleItem.label.add_style_class_name('codex-local-menu-title');
    this._indicator.menu.addMenuItem(titleItem);

    this._fiveItem = new PopupMenu.PopupMenuItem(
      '5-hour: unavailable',
      {reactive: false}
    );
    this._weeklyItem = new PopupMenu.PopupMenuItem(
      'Weekly: unavailable',
      {reactive: false}
    );
    this._indicator.menu.addMenuItem(this._fiveItem);
    this._indicator.menu.addMenuItem(this._weeklyItem);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._freshnessItem = new PopupMenu.PopupMenuItem(
      'No Codex rate-limit event found yet',
      {reactive: false}
    );
    this._sourceItem = new PopupMenu.PopupMenuItem(
      'Source: ~/.codex/sessions',
      {reactive: false}
    );
    this._sourceItem.label.add_style_class_name('codex-local-muted');
    this._indicator.menu.addMenuItem(this._freshnessItem);
    this._indicator.menu.addMenuItem(this._sourceItem);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._indicator.menu.addAction('Refresh local files', () => this._requestRefresh(true));
    this._indicator.menu.addAction('Settings…', () => this.openPreferences());

    Main.panel.addToStatusArea(
      this.uuid,
      this._indicator,
      1,
      this._panelBox()
    );
  }

  _destroyIndicator() {
    const indicator = this._indicator;
    if (!indicator)
      return;

    indicator.destroy();
    if (Main.panel.statusArea[this.uuid] === indicator)
      Main.panel.statusArea[this.uuid] = null;

    this._indicator = null;
    this._fiveLabel = null;
    this._weeklyLabel = null;
    this._separatorLabel = null;
    this._fiveItem = null;
    this._weeklyItem = null;
    this._freshnessItem = null;
    this._sourceItem = null;
  }

  _rebuildIndicator() {
    if (!this._settings || !this._reader)
      return;

    this._destroyIndicator();
    this._buildIndicator();
    this._requestRefresh(false);
  }

  _panelBox() {
    const selected = this._settings?.get_enum('panel-position') ?? 1;
    return PANEL_BOXES[selected] ?? 'right';
  }

  _refreshSeconds() {
    const selected = this._settings?.get_enum('refresh-interval') ?? DEFAULT_REFRESH_SECONDS;
    return REFRESH_INTERVALS.has(selected) ? selected : DEFAULT_REFRESH_SECONDS;
  }

  _fontSize() {
    const selected = this._settings?.get_enum('font-size') ?? DEFAULT_FONT_SIZE;
    return FONT_SIZES.has(selected) ? selected : DEFAULT_FONT_SIZE;
  }

  _applyFontSize() {
    const style = `font-size: ${this._fontSize()}px;`;
    this._fiveLabel?.set_style(style);
    this._separatorLabel?.set_style(style);
    this._weeklyLabel?.set_style(style);
  }

  _startTimer() {
    this._stopTimer();

    this._timerId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      this._refreshSeconds(),
      () => {
        this._requestRefresh(false);
        return GLib.SOURCE_CONTINUE;
      }
    );
  }

  _stopTimer() {
    if (!this._timerId)
      return;

    GLib.Source.remove(this._timerId);
    this._timerId = 0;
  }

  _onRefreshIntervalChanged() {
    if (!this._settings || !this._reader)
      return;

    this._startTimer();
    this._requestRefresh(false);
  }

  _requestRefresh(force) {
    if (!this._reader || !this._indicator || !this._cancellable)
      return;

    if (force)
      this._reader.clearCache();

    if (this._refreshInFlight) {
      this._refreshQueued = true;
      return;
    }

    void this._refresh();
  }

  async _refresh() {
    const reader = this._reader;
    const cancellable = this._cancellable;
    if (!reader || !this._indicator || !cancellable)
      return;

    this._refreshInFlight = true;

    try {
      const usage = await reader.readLatest(cancellable);

      if (reader !== this._reader || cancellable !== this._cancellable ||
          cancellable.is_cancelled() || !this._indicator)
        return;

      this._fiveLabel.text = `5h ${percentText(usage.fiveHour)}`;
      this._weeklyLabel.text = `7d ${percentText(usage.weekly)}`;
      applyLevelClass(this._fiveLabel, usage.fiveHour);
      applyLevelClass(this._weeklyLabel, usage.weekly);

      this._fiveItem.label.text = popupWindowText('5-hour', usage.fiveHour);
      this._weeklyItem.label.text = popupWindowText('Weekly', usage.weekly);
      this._freshnessItem.label.text = formatFreshness(usage.observedAtMs);
      this._sourceItem.label.text = `Source: ${usage.sessionsPath} · ${usage.scannedFiles} recent files · ${this._refreshSeconds()}s`;
    } catch (error) {
      if (cancellable.is_cancelled() || reader !== this._reader)
        return;

      console.error(`Codex Local Status Bar could not read local sessions: ${error.stack ?? error.message}`);
      if (!this._indicator)
        return;

      this._fiveLabel.text = '5h --';
      this._weeklyLabel.text = '7d --';
      applyLevelClass(this._fiveLabel, null);
      applyLevelClass(this._weeklyLabel, null);
      this._freshnessItem.label.text = 'Local session read failed; see GNOME Shell logs';
    } finally {
      if (reader !== this._reader)
        return;

      this._refreshInFlight = false;
      if (this._refreshQueued && this._indicator) {
        this._refreshQueued = false;
        this._requestRefresh(false);
      }
    }
  }
}
