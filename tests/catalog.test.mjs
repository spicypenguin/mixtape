import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { compileCatalog, build } from '../scripts/build.mjs';

const tape = { id: 'round9', title: 'Round 09', artist: 'tableTRASH', file: 'Round 9.mp3' };
const catalog = (tapes = [tape]) => ({ audioBaseUrl: 'https://example.com/audio/', tapes });

test('config preserves order and resolves encoded and unencoded audio keys', () => {
  const result = compileCatalog(catalog([tape, { ...tape, id: 'next', file: 'folder/a%20b.mp3' }]));
  assert.deepEqual(result.tracks.map(t => t.key), ['round9', 'next']);
  assert.deepEqual(result.tracks.map(t => t.id), [1, 2]);
  assert.equal(result.tracks[0].url, 'https://example.com/audio/Round%209.mp3');
  assert.equal(result.tracks[1].url, 'https://example.com/audio/folder/a%20b.mp3');
});

test('invalid catalog data fails before building', () => {
  assert.throws(() => compileCatalog(catalog([tape, tape])), /duplicate id/);
  assert.throws(() => compileCatalog(catalog([])), /at least one/);
  assert.throws(() => compileCatalog(catalog([{ ...tape, file: '../bad.mp3' }])), /relative audio key/);
  assert.throws(() => compileCatalog({ ...catalog(), audioBaseUrl: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => compileCatalog(catalog([{ ...tape, chapters: [
    { title: 'One', startSeconds: 0, endSeconds: 10 },
    { title: 'Two', startSeconds: 9, endSeconds: 20 },
  ] }])), /nonoverlapping/);
});

test('merged chapters flow through the build, including dynamic tape counts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mixtape-catalog-'));
  try {
    const configPath = join(directory, 'tapes.json');
    const outputPath = join(directory, 'dist');
    const chapters = [{ title: 'First', startSeconds: 0, endSeconds: 20 }, { title: 'Second', startSeconds: 20, endSeconds: 40 }];
    await writeFile(configPath, JSON.stringify(catalog([{ ...tape, chapters, durationSeconds: 40 }])));
    await build({ configPath, outputPath });
    const html = await readFile(join(outputPath, 'index.html'), 'utf8');
    assert.match(html, /id="tape-count">1</);
    assert.match(html, /View all 1 tapes/);
    assert(!html.includes('__TAPE_COUNT__'));
    assert(!html.includes('01-TableTRASH'));
    const script = await readFile(join(outputPath, 'tracks.js'), 'utf8');
    assert.match(script, /"startSeconds": 20/);
    assert.match(script, /Round%209.mp3/);
  } finally {
    // Only remove this test's verified temporary directory.
    if (dirname(resolve(directory)) === resolve(tmpdir()) && basename(directory).startsWith('mixtape-catalog-')) await rm(directory, { recursive: true, force: true });
  }
});
