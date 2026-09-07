export const FIVE_HOUR_MINUTES = 300;
export const WEEKLY_MINUTES = 10080;

const WINDOW_TOLERANCE_MINUTES = 5;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = finiteNumber(value);
  if (number === null)
    return null;
  return Math.max(0, Math.min(100, number));
}

export function classifyWindow(windowMinutes) {
  const minutes = finiteNumber(windowMinutes);
  if (minutes === null)
    return null;

  if (Math.abs(minutes - FIVE_HOUR_MINUTES) <= WINDOW_TOLERANCE_MINUTES)
    return 'fiveHour';
  if (Math.abs(minutes - WEEKLY_MINUTES) <= WINDOW_TOLERANCE_MINUTES)
    return 'weekly';
  return null;
}

function parseObservedAtMs(record, fallbackObservedAtMs = null) {
  if (typeof record?.timestamp === 'string') {
    const parsed = Date.parse(record.timestamp);
    if (Number.isFinite(parsed))
      return parsed;
  }

  const fallback = finiteNumber(fallbackObservedAtMs);
  return fallback === null ? null : fallback;
}

function parseResetAtMs(limit, observedAtMs) {
  const resetsAtSeconds = finiteNumber(limit?.resets_at ?? limit?.resetsAt);
  if (resetsAtSeconds !== null)
    return resetsAtSeconds * 1000;

  const resetsInSeconds = finiteNumber(limit?.resets_in_seconds ?? limit?.resetsInSeconds);
  if (resetsInSeconds !== null && observedAtMs !== null)
    return observedAtMs + resetsInSeconds * 1000;

  return null;
}

function normalizeLimit(limit, observedAtMs) {
  if (!limit || typeof limit !== 'object')
    return null;

  const kind = classifyWindow(limit.window_minutes ?? limit.windowMinutes);
  if (!kind)
    return null;

  const usedPercent = clampPercent(limit.used_percent ?? limit.usedPercent);
  if (usedPercent === null)
    return null;

  return {
    kind,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    windowMinutes: finiteNumber(limit.window_minutes ?? limit.windowMinutes),
    resetsAtMs: parseResetAtMs(limit, observedAtMs),
    observedAtMs,
  };
}

export function extractRateLimitSnapshot(record, fallbackObservedAtMs = null) {
  if (!record || record.type !== 'event_msg')
    return null;

  const payload = record.payload;
  if (!payload || payload.type !== 'token_count' || !payload.rate_limits)
    return null;

  const observedAtMs = parseObservedAtMs(record, fallbackObservedAtMs);
  const snapshot = {
    fiveHour: null,
    weekly: null,
    observedAtMs,
  };

  for (const key of ['primary', 'secondary']) {
    const normalized = normalizeLimit(payload.rate_limits[key], observedAtMs);
    if (normalized)
      snapshot[normalized.kind] = normalized;
  }

  if (!snapshot.fiveHour && !snapshot.weekly)
    return null;

  return snapshot;
}

function newerLimit(current, candidate) {
  if (!candidate)
    return current ?? null;
  if (!current)
    return candidate;

  const currentTime = finiteNumber(current.observedAtMs) ?? -Infinity;
  const candidateTime = finiteNumber(candidate.observedAtMs) ?? -Infinity;
  return candidateTime >= currentTime ? candidate : current;
}

export function mergeSnapshots(current, candidate) {
  if (!candidate)
    return current ?? {fiveHour: null, weekly: null, observedAtMs: null};
  if (!current)
    return candidate;

  const fiveHour = newerLimit(current.fiveHour, candidate.fiveHour);
  const weekly = newerLimit(current.weekly, candidate.weekly);
  const observedAtMs = Math.max(
    finiteNumber(fiveHour?.observedAtMs) ?? -Infinity,
    finiteNumber(weekly?.observedAtMs) ?? -Infinity,
  );

  return {
    fiveHour,
    weekly,
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : null,
  };
}

export function parseRateLimitText(text, fallbackObservedAtMs = null) {
  let merged = null;

  for (const line of String(text ?? '').split('\n')) {
    if (!line || !line.includes('rate_limits'))
      continue;

    try {
      const record = JSON.parse(line);
      const snapshot = extractRateLimitSnapshot(record, fallbackObservedAtMs);
      if (snapshot)
        merged = mergeSnapshots(merged, snapshot);
    } catch {
      // JSONL files may end with a partially-written line while Codex is active.
    }
  }

  return merged ?? {fiveHour: null, weekly: null, observedAtMs: null};
}
