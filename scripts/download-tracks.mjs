import { readFile, mkdir, stat, rename, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCatalog } from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'tracks');
const { tracks } = compileCatalog(JSON.parse(await readFile(resolve(root, 'config/tapes.json'), 'utf8')));
await mkdir(directory, { recursive: true });
const names = tracks.map(track => decodeURIComponent(basename(new URL(track.url).pathname)));
if (new Set(names).size !== names.length || names.some(name => /[<>:"/\\|?*\x00-\x1f]/.test(name))) throw new Error('Track filenames must be unique and safe local filenames.');
let next = 0, completed = 0, totalBytes = 0;
const failures = [];
async function worker() {
  while (next < tracks.length) {
    const index = next++;
    const track = tracks[index];
    const target = resolve(directory, names[index]);
    const partial = target + '.part';
    try {
      const existing = await stat(target).catch(() => null);
      if (existing) {
        const head = await fetch(track.url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
        const length = Number(head.headers.get('content-length'));
        if (!head.ok || !length || length !== existing.size) throw new Error('Existing local file differs from the source; refusing to overwrite it.');
        totalBytes += existing.size;
        console.log(`[${++completed}/${tracks.length}] Already downloaded: ${names[index]}`);
        continue;
      }
      const response = await fetch(track.url, { signal: AbortSignal.timeout(300000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('The response is not audio.');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      const downloaded = await stat(partial);
      const expected = Number(response.headers.get('content-length'));
      if (!downloaded.size || (expected && downloaded.size !== expected)) throw new Error('Incomplete download.');
      await rename(partial, target);
      totalBytes += downloaded.size;
      console.log(`[${++completed}/${tracks.length}] Downloaded: ${names[index]}`);
    } catch (error) {
      failures.push({ file: names[index], error: error.message });
      await rm(partial, { force: true }).catch(() => {});
    }
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
console.log(JSON.stringify({ completed, expected: tracks.length, totalBytes, directory, failures }, null, 2));
if (failures.length) process.exitCode = 1;
