import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const SHELL_IO_FILES = [
  'extension.js',
  'lib/session-reader.js',
  'lib/log-reader.js',
  'lib/usage-reader.js',
];

const FORBIDDEN_SYNC_FILE_CALLS = [
  [/\.enumerate_children\s*\(/, 'Gio.File.enumerate_children()'],
  [/\.next_file\s*\(/, 'Gio.FileEnumerator.next_file()'],
  [/\.load_contents\s*\(/, 'Gio.File.load_contents()'],
  [/\.query_exists\s*\(/, 'Gio.File.query_exists()'],
];

test('GNOME Shell runtime avoids synchronous file IO', async () => {
  for (const file of SHELL_IO_FILES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [pattern, description] of FORBIDDEN_SYNC_FILE_CALLS) {
      assert.doesNotMatch(source, pattern, `${file} must not use ${description}`);
    }
  }
});
