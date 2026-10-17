import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Reuse the Map document and its exact asset graph. A second bundled Map entry
// would move MapLibre into shared chunks also downloaded by Netgraph.
const html = await readFile('dist/index.html', 'utf8');
const terminal = html.replace(/<title>(.*?)<\/title>/, '<title>CartoLite Terminal · $1</title>')
  .replace('aria-label="CartoLite live map"', 'aria-label="CartoLite Terminal live map"')
  .replace(/(rel="canonical" href="https:\/\/[^"/]+)\//, '$1/terminal/')
  .replace(/(property="og:url" content="https:\/\/[^"/]+)\//, '$1/terminal/');
await mkdir('dist/terminal', { recursive: true });
await writeFile('dist/terminal/index.html', terminal);
