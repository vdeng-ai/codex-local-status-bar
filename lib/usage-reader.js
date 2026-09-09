import {LogUsageReader} from './log-reader.js';
import {SessionUsageReader} from './session-reader.js';

function sessionPool(usage) {
  if (!usage || (!usage.fiveHour && !usage.weekly))
    return null;

  const windows = [usage.fiveHour, usage.weekly].filter(Boolean);
  return {
    id: 'codex',
    name: 'Codex',
    limitName: null,
    primary: usage.fiveHour ?? null,
    secondary: usage.weekly ?? null,
    windows,
    activeLimit: null,
    planType: null,
    observedAtMs: usage.observedAtMs,
  };
}

function poolTime(pool) {
  return Number.isFinite(pool?.observedAtMs) ? pool.observedAtMs : -Infinity;
}

function newestCodexPool(logPool, session) {
  const fallback = sessionPool(session);
  if (!logPool)
    return fallback;
  if (!fallback)
    return logPool;
  return poolTime(fallback) > poolTime(logPool) ? fallback : logPool;
}

export class LocalUsageReader {
  constructor() {
    this._logReader = new LogUsageReader();
    this._sessionReader = new SessionUsageReader();
  }

  clearCache() {
    this._logReader.clearCache();
    this._sessionReader.clearCache();
  }

  async readLatest(cancellable = null) {
    const [logResult, sessionResult] = await Promise.allSettled([
      this._logReader.readLatest(cancellable),
      this._sessionReader.readLatest(cancellable),
    ]);

    if (cancellable?.is_cancelled())
      throw new Error('Cancelled');

    const logUsage = logResult.status === 'fulfilled' ? logResult.value : null;
    const sessionUsage = sessionResult.status === 'fulfilled' ? sessionResult.value : null;

    const pools = [...(logUsage?.pools ?? [])];
    const logCodexIndex = pools.findIndex(pool => pool.id === 'codex');
    const logCodex = logCodexIndex >= 0 ? pools[logCodexIndex] : null;
    const codex = newestCodexPool(logCodex, sessionUsage);

    if (codex) {
      if (logCodexIndex >= 0)
        pools[logCodexIndex] = codex;
      else
        pools.unshift(codex);
    }

    pools.sort((a, b) => {
      if (a.id === 'codex')
        return -1;
      if (b.id === 'codex')
        return 1;
      return a.name.localeCompare(b.name);
    });

    const observedAtMs = pools.reduce(
      (latest, pool) => Math.max(latest, poolTime(pool)),
      -Infinity,
    );

    const codexPool = pools.find(pool => pool.id === 'codex') ?? null;
    const fiveHour = codexPool?.windows.find(window => window.kind === 'fiveHour') ?? null;
    const weekly = codexPool?.windows.find(window => window.kind === 'weekly') ?? null;

    return {
      pools,
      fiveHour,
      weekly,
      observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : null,
      sourceKind: logUsage ? 'local-response-log' : 'session-jsonl',
      logPath: logUsage?.sourcePath ?? null,
      sessionsPath: sessionUsage?.sessionsPath ?? this._sessionReader.sessionsPath,
      scannedFiles: sessionUsage?.scannedFiles ?? 0,
      logError: logResult.status === 'rejected' ? logResult.reason : null,
      sessionError: sessionResult.status === 'rejected' ? sessionResult.reason : null,
    };
  }
}
