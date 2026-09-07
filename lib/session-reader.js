import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {mergeSnapshots, parseRateLimitText} from './rate-limits.js';

const DEFAULT_RECENT_FILE_LIMIT = 20;
const ENUMERATOR_BATCH_SIZE = 64;
const FILE_ATTRIBUTES = [
  'standard::name',
  'standard::type',
  'standard::size',
  'time::modified',
  'time::modified-usec',
].join(',');

function getSessionsPath() {
  const codexHome = GLib.getenv('CODEX_HOME');
  const base = codexHome && codexHome.trim()
    ? codexHome
    : GLib.build_filenamev([GLib.get_home_dir(), '.codex']);
  return GLib.build_filenamev([base, 'sessions']);
}

function mtimeMicroseconds(info) {
  const seconds = info.get_attribute_uint64('time::modified');
  const microseconds = info.get_attribute_uint32('time::modified-usec');
  return Number(seconds) * 1_000_000 + Number(microseconds);
}

function enumerateChildrenAsync(directory, cancellable = null) {
  return new Promise((resolve, reject) => {
    directory.enumerate_children_async(
      FILE_ATTRIBUTES,
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
          // A later refresh can retry any directory that failed to close.
        }
        resolve();
      },
    );
  });
}

function loadContentsAsync(file, cancellable = null) {
  return new Promise((resolve, reject) => {
    file.load_contents_async(cancellable, (source, result) => {
      try {
        const [success, contents] = source.load_contents_finish(result);
        if (!success)
          throw new Error(`Could not read ${source.get_path()}`);
        resolve(contents);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function walkJsonlFiles(root, cancellable = null) {
  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    if (cancellable?.is_cancelled())
      throw new Error('Cancelled');

    const directory = stack.pop();
    let enumerator = null;

    try {
      enumerator = await enumerateChildrenAsync(directory, cancellable);

      while (true) {
        const infos = await nextFilesAsync(enumerator, ENUMERATOR_BATCH_SIZE, cancellable);
        if (!infos || infos.length === 0)
          break;

        for (const info of infos) {
          const name = info.get_name();
          const child = directory.get_child(name);
          const type = info.get_file_type();

          if (type === Gio.FileType.DIRECTORY) {
            stack.push(child);
            continue;
          }

          if (type !== Gio.FileType.REGULAR || !name.endsWith('.jsonl'))
            continue;

          files.push({
            file: child,
            path: child.get_path(),
            mtimeUs: mtimeMicroseconds(info),
            size: Number(info.get_size()),
          });
        }
      }
    } catch (error) {
      if (cancellable?.is_cancelled() ||
          error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        throw error;

      // A missing sessions directory is normal before Codex has created its
      // first transcript. Other transient scan failures can be retried later.
      if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        console.debug(`Codex Local Status Bar: cannot scan ${directory.get_path()}: ${error.message}`);
    } finally {
      if (enumerator)
        await closeEnumeratorAsync(enumerator, cancellable);
    }
  }

  return files;
}

export class SessionUsageReader {
  constructor({recentFileLimit = DEFAULT_RECENT_FILE_LIMIT} = {}) {
    this.sessionsPath = getSessionsPath();
    this._recentFileLimit = recentFileLimit;
    this._cache = new Map();
  }

  clearCache() {
    this._cache.clear();
  }

  async readLatest(cancellable = null) {
    const root = Gio.File.new_for_path(this.sessionsPath);
    const recent = (await walkJsonlFiles(root, cancellable))
      .sort((a, b) => b.mtimeUs - a.mtimeUs)
      .slice(0, this._recentFileLimit);

    const activePaths = new Set(recent.map(item => item.path));
    let merged = null;

    for (const item of recent) {
      const cacheKey = `${item.mtimeUs}:${item.size}`;
      let parsed = this._cache.get(item.path);

      if (!parsed || parsed.cacheKey !== cacheKey) {
        const contents = await loadContentsAsync(item.file, cancellable);
        const text = new TextDecoder('utf-8').decode(contents);
        parsed = {
          cacheKey,
          snapshot: parseRateLimitText(text, Math.floor(item.mtimeUs / 1000)),
        };
        this._cache.set(item.path, parsed);
      }

      merged = mergeSnapshots(merged, parsed.snapshot);
    }

    for (const path of this._cache.keys()) {
      if (!activePaths.has(path))
        this._cache.delete(path);
    }

    return {
      sessionsPath: this.sessionsPath,
      scannedFiles: recent.length,
      fiveHour: merged?.fiveHour ?? null,
      weekly: merged?.weekly ?? null,
      observedAtMs: merged?.observedAtMs ?? null,
    };
  }
}
