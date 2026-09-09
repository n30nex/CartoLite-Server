import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = process.argv[2] ?? "web/dist";
// MapLibre 6 requires a separate Vite worker (129,701 gzip bytes in Actions).
// Keep the previous cap for all other JS/CSS; account for the worker explicitly.
// Combined measured cost: 446,084 bytes. Runtime timing/route gates are unchanged.
const uiLimit = 350 * 1024;
const workerLimit = 128 * 1024;
const limit = Number(process.env.CARTOLITE_GZIP_BUDGET ?? (uiLimit + workerLimit));

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
let workerBytes = 0;
let workerCount = 0;
for (const file of files) {
  const bytes = gzipSync(await readFile(file), { level: 9 }).byteLength;
  total += bytes;
  if (/^maplibre-gl-worker-.*\.m?js$/.test(basename(file))) {
    workerBytes += bytes;
    workerCount += 1;
  }
  console.log(`${bytes.toString().padStart(8)}  ${file}`);
}

console.log(`${total} gzip bytes total (budget ${limit})`);
console.log(`${total - workerBytes} gzip bytes excluding map worker (budget ${uiLimit})`);
console.log(`${workerBytes} gzip bytes for map worker (budget ${workerLimit})`);
if (workerCount !== 1) throw new Error(`expected one map worker, found ${workerCount}`);
if (!Number.isFinite(limit) || limit <= 0) throw new Error('invalid total frontend budget');
if (total > limit || total - workerBytes > uiLimit || workerBytes > workerLimit) process.exitCode = 1;
