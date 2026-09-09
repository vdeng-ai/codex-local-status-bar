import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_POSITION_LABELS = ['Left', 'Right'];
const REFRESH_INTERVALS = [15, 30, 60, 120];
const REFRESH_INTERVAL_LABELS = ['15 seconds', '30 seconds', '60 seconds', '120 seconds'];
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;

export default class CodexLocalStatusBarPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    this._settings = this.getSettings();

    window.set_default_size(520, 420);

    const page = new Adw.PreferencesPage({
      title: 'Codex Local Status Bar',
      icon_name: 'preferences-system-symbolic',
    });

    const appearanceGroup = new Adw.PreferencesGroup({
      title: 'Top bar',
      description: 'Choose where the Codex quota indicator appears.',
    });

    const positionRow = new Adw.ComboRow({
      title: 'Position',
      subtitle: 'Changes are applied immediately.',
      model: Gtk.StringList.new(PANEL_POSITION_LABELS),
      selected: this._settings.get_enum('panel-position'),
    });

    positionRow.connect('notify::selected', row => {
      this._settings.set_enum('panel-position', row.selected);
    });

    const currentFontSize = this._settings.get_enum('font-size');
    const fontSizeAdjustment = new Gtk.Adjustment({
      lower: MIN_FONT_SIZE,
      upper: MAX_FONT_SIZE,
      step_increment: 1,
      page_increment: 2,
      value: currentFontSize,
    });
    const fontSizeRow = new Adw.SpinRow({
      title: 'Font size',
      subtitle: 'Top-bar quota text size in pixels.',
      adjustment: fontSizeAdjustment,
      digits: 0,
      numeric: true,
      snap_to_ticks: true,
    });

    fontSizeRow.connect('notify::value', row => {
      this._settings.set_enum('font-size', Math.round(row.value));
    });

    appearanceGroup.add(positionRow);
    appearanceGroup.add(fontSizeRow);
    page.add(appearanceGroup);

    const updateGroup = new Adw.PreferencesGroup({
      title: 'Local refresh',
      description: 'Controls how often local Codex quota sources are refreshed.',
    });

    const currentInterval = this._settings.get_enum('refresh-interval');
    const currentIndex = Math.max(0, REFRESH_INTERVALS.indexOf(currentInterval));
    const refreshRow = new Adw.ComboRow({
      title: 'Refresh interval',
      subtitle: '30 seconds is recommended for normal use.',
      model: Gtk.StringList.new(REFRESH_INTERVAL_LABELS),
      selected: currentIndex,
    });

    refreshRow.connect('notify::selected', row => {
      const seconds = REFRESH_INTERVALS[row.selected] ?? 30;
      this._settings.set_enum('refresh-interval', seconds);
    });

    updateGroup.add(refreshRow);
    page.add(updateGroup);

    window.add(page);
  }
}
