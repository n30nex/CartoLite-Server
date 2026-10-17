import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = process.argv[2] ?? "web/dist";
// Report artifact sizes without release-blocking caps. Runtime gates remain.

async function assets(dir, pattern) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await assets(path, pattern));
    else if (pattern.test(entry.name)) found.push(path);
  }
  return found;
}

const files = await assets(root, /\.(?:css|m?js)$/);
if (files.length === 0) throw new Error(`no JavaScript or CSS assets found in ${root}`);

let total = 0;
let terminalBytes = 0;
let workerBytes = 0;
let workerCount = 0;
for (const file of files) {
  const bytes = gzipSync(await readFile(file), { level: 9 }).byteLength;
  total += bytes;
  if (/^terminal-.*\.(?:m?js|css)$/.test(basename(file))) terminalBytes += bytes;
  if (/^maplibre-gl-worker-.*\.m?js$/.test(basename(file))) {
    workerBytes += bytes;
    workerCount += 1;
  }
  console.log(`${bytes.toString().padStart(8)}  ${file}`);
}

console.log(`${total} gzip bytes total`);
console.log(`${total - workerBytes - terminalBytes} gzip bytes for main UI`);
console.log(`${workerBytes} gzip bytes for map worker`);
console.log(terminalBytes + ' gzip bytes for optional Terminal');
if (terminalBytes <= 0) throw new Error('missing optional Terminal assets');
if (workerCount !== 1) throw new Error(`expected one map worker, found ${workerCount}`);
