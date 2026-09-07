import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const RUNTIME_FILES = [
  'extension.js',
  'prefs.js',
  'lib/rate-limits.js',
  'lib/session-reader.js',
];

const FORBIDDEN = [
  [/https?:\/\//i, 'HTTP URL'],
  [/\bfetch\s*\(/i, 'fetch()'],
  [/\bSoup\b/, 'libsoup'],
  [/new_for_uri\s*\(/, 'Gio URI access'],
  [/auth\.json/i, 'Codex credential file'],
  [/oauth/i, 'OAuth logic'],
  [/access[_-]?token/i, 'access token handling'],
  [/refresh[_-]?token/i, 'refresh token handling'],
];

test('runtime source has no network or credential handling', async () => {
  for (const file of RUNTIME_FILES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const [pattern, description] of FORBIDDEN) {
      assert.doesNotMatch(source, pattern, `${file} must not contain ${description}`);
    }
  }
});
