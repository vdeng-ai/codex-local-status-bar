import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWindow,
  extractRateLimitSnapshot,
  isLimitExpired,
  parseRateLimitText,
  parseResponseHeaderPools,
} from '../lib/rate-limits.js';

function event({
  timestamp = '2026-09-07T07:42:20.700Z',
  limitId = 'codex',
  limitName = null,
  primary = null,
  secondary = null,
} = {}) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: {
        limit_id: limitId,
        limit_name: limitName,
        primary,
        secondary,
      },
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

test('ignores Luna Reserve / gpt-reserve allowance records', () => {
  const text = [
    JSON.stringify(event({
      timestamp: '2026-09-08T07:07:37.789Z',
      primary: {used_percent: 100, window_minutes: 300, resets_at: 1788865260},
      secondary: {used_percent: 16, window_minutes: 10080, resets_at: 1789452060},
    })),
    JSON.stringify(event({
      timestamp: '2026-09-09T01:14:48.672Z',
      limitId: 'base_model_inference',
      limitName: 'gpt-reserve',
      primary: {used_percent: 0, window_minutes: 10080, resets_at: 1789521234},
    })),
  ].join('\n');

  const snapshot = parseRateLimitText(text);
  assert.equal(snapshot.fiveHour.remainingPercent, 0);
  assert.equal(snapshot.weekly.remainingPercent, 84);
  assert.equal(snapshot.observedAtMs, Date.parse('2026-09-08T07:07:37.789Z'));
});

test('parses independent Codex and GPT Reserve pools from local response headers', () => {
  const observedAtMs = Date.parse('2026-09-09T01:20:00.000Z');
  const body = `headers={"x-codex-active-limit": "premium", "x-codex-plan-type": "plus", "x-codex-primary-used-percent": "12", "x-codex-secondary-used-percent": "17", "x-codex-primary-window-minutes": "300", "x-codex-secondary-window-minutes": "10080", "x-codex-primary-reset-at": "1788933609", "x-codex-secondary-reset-at": "1789452121", "x-base-model-inference-primary-used-percent": "0", "x-base-model-inference-secondary-used-percent": "0", "x-base-model-inference-primary-window-minutes": "10080", "x-base-model-inference-secondary-window-minutes": "0", "x-base-model-inference-primary-reset-at": "1789521234", "x-base-model-inference-limit-name": "gpt-reserve"}`;

  const pools = parseResponseHeaderPools(body, observedAtMs);
  assert.equal(pools.length, 2);

  const codex = pools.find(pool => pool.id === 'codex');
  assert.equal(codex.name, 'Codex');
  assert.equal(codex.primary.remainingPercent, 88);
  assert.equal(codex.secondary.remainingPercent, 83);
  assert.equal(codex.primary.kind, 'fiveHour');
  assert.equal(codex.secondary.kind, 'weekly');

  const reserve = pools.find(pool => pool.id === 'base_model_inference');
  assert.equal(reserve.name, 'GPT Reserve');
  assert.equal(reserve.windows.length, 1);
  assert.equal(reserve.primary.remainingPercent, 100);
  assert.equal(reserve.primary.kind, 'weekly');
});

test('marks a quota window stale after its reset timestamp passes', () => {
  const snapshot = extractRateLimitSnapshot(event({
    primary: {used_percent: 100, window_minutes: 300, resets_at: 1788865260},
  }));

  assert.equal(isLimitExpired(snapshot.fiveHour, 1788865259000), false);
  assert.equal(isLimitExpired(snapshot.fiveHour, 1788865260000), true);
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
