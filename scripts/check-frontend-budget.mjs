import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ?? "web/dist";
const limit = Number(process.env.CARTOLITE_GZIP_BUDGET ?? 350 * 1024);

async function assets(dir, pattern) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await assets(path, pattern));
    else if (pattern.test(entry.name)) found.push(path);
  }
  return found;
}

const files = await assets(root, /\.(?:css|js)$/);
if (files.length === 0) throw new Error(`no JavaScript or CSS assets found in ${root}`);

let total = 0;
for (const file of files) {
  const bytes = gzipSync(await readFile(file), { level: 9 }).byteLength;
  total += bytes;
  console.log(`${bytes.toString().padStart(8)}  ${file}`);
}

console.log(`${total} gzip bytes total (budget ${limit})`);
if (total > limit) process.exitCode = 1;
