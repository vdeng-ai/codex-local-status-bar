import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {parseResponseHeaderPools} from './rate-limits.js';

const LOG_ATTRIBUTES = [
  'standard::name',
  'standard::type',
  'time::modified',
  'time::modified-usec',
].join(',');

const RATE_LIMIT_QUERY = `
SELECT
  ts,
  ts_nanos,
  CASE
    WHEN instr(feedback_log_body, 'x-codex-active-limit') > 0
     AND instr(feedback_log_body, 'x-models-etag') > instr(feedback_log_body, 'x-codex-active-limit')
    THEN substr(
      feedback_log_body,
      max(1, instr(feedback_log_body, 'x-codex-active-limit') - 2),
      instr(feedback_log_body, 'x-models-etag') - max(1, instr(feedback_log_body, 'x-codex-active-limit') - 2)
    )
    ELSE ''
  END AS quota_headers
FROM logs
WHERE feedback_log_body LIKE '%x-codex-primary-used-percent%'
ORDER BY ts DESC, ts_nanos DESC, id DESC
LIMIT 1;
`.trim();

function getCodexHome() {
  const codexHome = GLib.getenv('CODEX_HOME');
  return codexHome && codexHome.trim()
    ? codexHome
    : GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
}

function mtimeMicroseconds(info) {
  const seconds = info.get_attribute_uint64('time::modified');
  const microseconds = info.get_attribute_uint32('time::modified-usec');
  return Number(seconds) * 1_000_000 + Number(microseconds);
}

function enumerateChildrenAsync(directory, cancellable = null) {
  return new Promise((resolve, reject) => {
    directory.enumerate_children_async(
      LOG_ATTRIBUTES,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.enumerate_children_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function nextFilesAsync(enumerator, count, cancellable = null) {
  return new Promise((resolve, reject) => {
    enumerator.next_files_async(
      count,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.next_files_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function closeEnumeratorAsync(enumerator, cancellable = null) {
  return new Promise(resolve => {
    enumerator.close_async(
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          source.close_finish(result);
        } catch {
          // Nothing to do. A future refresh can enumerate again.
        }
        resolve();
      },
    );
  });
}

function communicateUtf8Async(process, cancellable = null) {
  return new Promise((resolve, reject) => {
    process.communicate_utf8_async(null, cancellable, (source, result) => {
      try {
        const [success, stdout, stderr] = source.communicate_utf8_finish(result);
        if (!success)
          throw new Error(stderr || 'sqlite3 query failed');
        resolve(stdout ?? '');
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function findLatestLogsDatabase(codexHome, cancellable = null) {
  const root = Gio.File.new_for_path(codexHome);
  let enumerator = null;
  const candidates = [];

  try {
    enumerator = await enumerateChildrenAsync(root, cancellable);
    while (true) {
      const infos = await nextFilesAsync(enumerator, 64, cancellable);
      if (!infos || infos.length === 0)
        break;

      for (const info of infos) {
        const name = info.get_name();
        if (info.get_file_type() !== Gio.FileType.REGULAR ||
            !/^logs_\d+\.sqlite$/.test(name))
          continue;

        candidates.push({
          path: GLib.build_filenamev([codexHome, name]),
          mtimeUs: mtimeMicroseconds(info),
        });
      }
    }
  } catch (error) {
    if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
      return null;
    throw error;
  } finally {
    if (enumerator)
      await closeEnumeratorAsync(enumerator, cancellable);
  }

  candidates.sort((a, b) => b.mtimeUs - a.mtimeUs);
  return candidates[0]?.path ?? null;
}

export class LogUsageReader {
  constructor() {
    this.codexHome = getCodexHome();
    this._sqlite3 = GLib.find_program_in_path('sqlite3');
  }

  get available() {
    return Boolean(this._sqlite3);
  }

  clearCache() {
    // Queries are intentionally uncached so each refresh can observe the latest
    // response headers already written by Codex.
  }

  async readLatest(cancellable = null) {
    if (!this._sqlite3)
      return null;

    const databasePath = await findLatestLogsDatabase(this.codexHome, cancellable);
    if (!databasePath)
      return null;

    const process = Gio.Subprocess.new(
      [this._sqlite3, '-readonly', '-json', databasePath, RATE_LIMIT_QUERY],
      Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );
    const stdout = await communicateUtf8Async(process, cancellable);
    const rows = JSON.parse(stdout || '[]');
    const row = rows[0];
    if (!row?.quota_headers)
      return null;

    const seconds = Number(row.ts);
    const nanos = Number(row.ts_nanos);
    const observedAtMs = Number.isFinite(seconds)
      ? seconds * 1000 + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0)
      : null;
    const pools = parseResponseHeaderPools(row.quota_headers, observedAtMs);
    if (pools.length === 0)
      return null;

    return {
      sourceKind: 'local-response-log',
      sourcePath: databasePath,
      pools,
      observedAtMs,
    };
  }
}
