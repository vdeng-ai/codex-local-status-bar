import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWindow,
  extractRateLimitSnapshot,
  parseRateLimitText,
} from '../lib/rate-limits.js';

function event({timestamp = '2026-09-07T07:42:20.700Z', primary = null, secondary = null} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {primary, secondary},
    },
  };
}

test('classifies 5-hour and weekly windows with small server-side drift', () => {
  assert.equal(classifyWindow(300), 'fiveHour');
  assert.equal(classifyWindow(299), 'fiveHour');
  assert.equal(classifyWindow(10080), 'weekly');
  assert.equal(classifyWindow(10079), 'weekly');
  assert.equal(classifyWindow(1440), null);
});

test('extracts remaining percentages and absolute reset times', () => {
  const snapshot = extractRateLimitSnapshot(event({
    primary: {used_percent: 3, window_minutes: 300, resets_at: 1788784925},
    secondary: {used_percent: 0, window_minutes: 10080, resets_at: 1789371725},
  }));

  assert.equal(snapshot.fiveHour.remainingPercent, 97);
  assert.equal(snapshot.weekly.remainingPercent, 100);
  assert.equal(snapshot.fiveHour.resetsAtMs, 1788784925000);
  assert.equal(snapshot.weekly.resetsAtMs, 1789371725000);
});

test('identifies windows by duration rather than primary/secondary position', () => {
  const snapshot = extractRateLimitSnapshot(event({
    primary: {used_percent: 80, window_minutes: 10080, resets_at: 1789371725},
    secondary: {used_percent: 25, window_minutes: 300, resets_at: 1788784925},
  }));

  assert.equal(snapshot.fiveHour.remainingPercent, 75);
  assert.equal(snapshot.weekly.remainingPercent, 20);
});

test('supports resets_in_seconds when Codex emits relative reset metadata', () => {
  const timestamp = '2026-09-07T07:00:00.000Z';
  const observedAt = Date.parse(timestamp);
  const snapshot = extractRateLimitSnapshot(event({
    timestamp,
    primary: {used_percent: 10, window_minutes: 299, resets_in_seconds: 600},
  }));

  assert.equal(snapshot.fiveHour.resetsAtMs, observedAt + 600_000);
});

test('keeps the newest value for each window independently', () => {
  const lines = [
    JSON.stringify(event({
      timestamp: '2026-09-07T07:00:00.000Z',
      primary: {used_percent: 40, window_minutes: 300, resets_at: 1788784925},
      secondary: {used_percent: 50, window_minutes: 10080, resets_at: 1789371725},
    })),
    JSON.stringify(event({
      timestamp: '2026-09-07T07:10:00.000Z',
      primary: {used_percent: 55, window_minutes: 300, resets_at: 1788784925},
    })),
  ].join('\n');

  const snapshot = parseRateLimitText(lines);
  assert.equal(snapshot.fiveHour.remainingPercent, 45);
  assert.equal(snapshot.weekly.remainingPercent, 50);
  assert.equal(snapshot.fiveHour.observedAtMs, Date.parse('2026-09-07T07:10:00.000Z'));
  assert.equal(snapshot.weekly.observedAtMs, Date.parse('2026-09-07T07:00:00.000Z'));
});

test('ignores malformed JSONL tails and unrelated events', () => {
  const text = [
    JSON.stringify({type: 'event_msg', payload: {type: 'other'}}),
    JSON.stringify(event({
      primary: {used_percent: 82, window_minutes: 300, resets_at: 1788784925},
    })),
    '{"timestamp":',
  ].join('\n');

  const snapshot = parseRateLimitText(text);
  assert.equal(snapshot.fiveHour.remainingPercent, 18);
  assert.equal(snapshot.weekly, null);
});
