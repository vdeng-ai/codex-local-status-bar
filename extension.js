import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {LocalUsageReader} from './lib/usage-reader.js';
import {isLimitExpired} from './lib/rate-limits.js';

const DEFAULT_REFRESH_SECONDS = 30;
const DEFAULT_FONT_SIZE = 14;
const REFRESH_INTERVALS = new Set([15, 30, 60, 120]);
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

function formatFreshness(ms, prefix = 'Latest local quota update') {
  if (!Number.isFinite(ms))
    return `${prefix}: unavailable`;

  const ageSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (ageSeconds < 60)
    return `${prefix}: ${ageSeconds}s ago`;
  if (ageSeconds < 3600)
    return `${prefix}: ${Math.floor(ageSeconds / 60)}m ago`;
  if (ageSeconds < 86400)
    return `${prefix}: ${Math.floor(ageSeconds / 3600)}h ago`;

  const date = localDateTime(ms);
  return date ? `${prefix}: ${date.format('%b %e %H:%M')}` : `${prefix}: unknown`;
}

function windowText(limit) {
  if (!limit)
    return '--';
  if (limit.kind === 'fiveHour')
    return '5h';
  if (limit.kind === 'weekly')
    return '7d';

  const minutes = Number(limit.windowMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0)
    return '?';
  if (minutes % 1440 === 0)
    return `${minutes / 1440}d`;
  if (minutes % 60 === 0)
    return `${minutes / 60}h`;
  return `${minutes}m`;
}

function popupWindowText(limit) {
  const name = windowText(limit);
  if (!limit)
    return `${name}: unavailable`;
  if (isLimitExpired(limit))
    return `${name}: reset passed · waiting for a newer local snapshot`;
  return `${name}: ${percentText(limit)} left · ${formatReset(limit.resetsAtMs)}`;
}

function panelPoolName(pool) {
  if (pool.id === 'codex')
    return null;
  if (pool.name === 'GPT Reserve')
    return 'Reserve';
  return pool.name;
}

function iconStyleForFile(extensionPath, iconBasename) {
  return `background-image: url("file://${extensionPath}/icons/${iconBasename}");`;
}

export default class CodexLocalStatusBarExtension extends Extension {
  enable() {
    this._reader = new LocalUsageReader();
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

    const icon = new St.Widget({
      style_class: 'codex-local-icon',
      style: iconStyleForFile(this.path, 'codex.svg'),
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._usageBox = new St.BoxLayout({
      style_class: 'codex-local-usage-box',
      y_align: Clutter.ActorAlign.CENTER,
    });

    box.add_child(icon);
    box.add_child(this._usageBox);
    this._indicator.add_child(box);

    const titleItem = new PopupMenu.PopupMenuItem(
      'Codex usage · local data',
      {reactive: false}
    );
    titleItem.label.add_style_class_name('codex-local-menu-title');
    this._indicator.menu.addMenuItem(titleItem);

    this._poolSection = new PopupMenu.PopupMenuSection();
    this._indicator.menu.addMenuItem(this._poolSection);
    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._freshnessItem = new PopupMenu.PopupMenuItem(
      'Latest local quota update: unavailable',
      {reactive: false}
    );
    this._sourceItem = new PopupMenu.PopupMenuItem(
      'Source: local Codex data',
      {reactive: false}
    );
    this._sourceItem.label.add_style_class_name('codex-local-muted');
    this._indicator.menu.addMenuItem(this._freshnessItem);
    this._indicator.menu.addMenuItem(this._sourceItem);

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._indicator.menu.addAction('Refresh local data', () => this._requestRefresh(true));
    this._indicator.menu.addAction('Settings…', () => this.openPreferences());

    Main.panel.addToStatusArea(
      this.uuid,
      this._indicator,
      1,
      this._panelBox()
    );

    this._renderPools(null);
  }

  _destroyIndicator() {
    const indicator = this._indicator;
    if (!indicator)
      return;

    indicator.destroy();
    if (Main.panel.statusArea[this.uuid] === indicator)
      Main.panel.statusArea[this.uuid] = null;

    this._indicator = null;
    this._usageBox = null;
    this._poolSection = null;
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
    return selected >= 12 && selected <= 32 ? selected : DEFAULT_FONT_SIZE;
  }

  _applyFontSize() {
    const style = `font-size: ${this._fontSize()}px;`;
    for (const child of this._usageBox?.get_children() ?? [])
      child.set_style?.(style);
  }

  _makePanelLabel(text, styleClass, limit = null) {
    const label = new St.Label({
      text,
      y_align: Clutter.ActorAlign.CENTER,
      style_class: styleClass,
    });
    label.set_style(`font-size: ${this._fontSize()}px;`);
    if (limit !== null)
      applyLevelClass(label, limit);
    return label;
  }

  _renderPools(usage) {
    if (!this._usageBox || !this._poolSection)
      return;

    for (const child of this._usageBox.get_children())
      child.destroy();
    this._poolSection.removeAll();

    const pools = usage?.pools ?? [];
    if (pools.length === 0) {
      const placeholder = this._makePanelLabel(
        '5h -- / 7d --',
        'codex-local-window codex-local-unknown'
      );
      this._usageBox.add_child(placeholder);
      this._poolSection.addMenuItem(new PopupMenu.PopupMenuItem(
        'No local quota snapshot found yet',
        {reactive: false}
      ));
      return;
    }

    pools.forEach((pool, poolIndex) => {
      if (poolIndex > 0) {
        this._usageBox.add_child(this._makePanelLabel(
          '|',
          'codex-local-pool-divider'
        ));
      }

      const poolName = panelPoolName(pool);
      if (poolName) {
        this._usageBox.add_child(this._makePanelLabel(
          poolName,
          'codex-local-pool-name'
        ));
      }

      const windows = pool.windows ?? [];
      windows.forEach((limit, windowIndex) => {
        if (windowIndex > 0) {
          this._usageBox.add_child(this._makePanelLabel(
            '/',
            'codex-local-separator'
          ));
        }

        const visibleLimit = isLimitExpired(limit) ? null : limit;
        const label = this._makePanelLabel(
          `${windowText(limit)} ${percentText(visibleLimit)}`,
          'codex-local-window codex-local-unknown',
          visibleLimit
        );
        this._usageBox.add_child(label);
      });

      const poolTitle = new PopupMenu.PopupMenuItem(pool.name, {reactive: false});
      poolTitle.label.add_style_class_name('codex-local-pool-title');
      this._poolSection.addMenuItem(poolTitle);

      for (const limit of windows) {
        this._poolSection.addMenuItem(new PopupMenu.PopupMenuItem(
          popupWindowText(limit),
          {reactive: false}
        ));
      }

      const poolFreshness = new PopupMenu.PopupMenuItem(
        formatFreshness(pool.observedAtMs, 'Updated'),
        {reactive: false}
      );
      poolFreshness.label.add_style_class_name('codex-local-muted');
      this._poolSection.addMenuItem(poolFreshness);

      if (poolIndex < pools.length - 1)
        this._poolSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    });
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

      this._renderPools(usage);
      this._freshnessItem.label.text = formatFreshness(usage.observedAtMs);

      if (usage.sourceKind === 'local-response-log') {
        this._sourceItem.label.text = `Source: Codex local response log · session fallback · ${this._refreshSeconds()}s`;
      } else {
        this._sourceItem.label.text = `Source: Codex session JSONL · ${usage.scannedFiles} file(s) · ${this._refreshSeconds()}s`;
      }
    } catch (error) {
      if (cancellable.is_cancelled() || reader !== this._reader)
        return;

      console.error(`Codex Local Status Bar could not read local quota data: ${error.stack ?? error.message}`);
      if (!this._indicator)
        return;

      this._renderPools(null);
      this._freshnessItem.label.text = 'Local quota read failed; see GNOME Shell logs';
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
