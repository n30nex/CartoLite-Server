import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

// Reuse the Map document and its exact asset graph. A second bundled Map entry
// would move MapLibre into shared chunks also downloaded by Netgraph.
const html = await readFile('dist/index.html', 'utf8');
const assets = (await readdir('dist/assets')).filter(name => /^terminal-.*\.(?:js|css)$/.test(name));
if (assets.filter(name => name.endsWith('.js')).length !== 1 || assets.filter(name => name.endsWith('.css')).length !== 1) throw new Error('Terminal entry assets missing or ambiguous');
const script = `<script type="module" src="/assets/${assets.find(name => name.endsWith('.js'))}"></script>`;
const style = `<link rel="stylesheet" href="/assets/${assets.find(name => name.endsWith('.css'))}">`;
const terminal = html.replace('<html lang="en">', '<html lang="en" data-terminal="true">')
  .replace('<head>', `<head>\n${script}`)
  .replace('</head>', `${style}\n</head>`)
  .replace(/<title>(.*?)<\/title>/, '<title>Terminal · $1</title>')
  .replace('aria-label="CartoLite live map"', 'aria-label="CartoLite Terminal live map"')
  .replace(/(rel="canonical" href="https:\/\/[^"/]+)\//, '$1/terminal/')
  .replace(/(property="og:url" content="https:\/\/[^"/]+)\//, '$1/terminal/');
await mkdir('dist/terminal', { recursive: true });
await writeFile('dist/terminal/index.html', terminal);
