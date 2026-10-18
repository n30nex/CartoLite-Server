import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';

// Reuse the Map document and its exact asset graph. A second bundled Map entry
// would move MapLibre into shared chunks also downloaded by Netgraph.
const html = await readFile('dist/index.html', 'utf8');
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json','utf8'));
const entry = manifest['src/terminal.ts'];
if(!entry?.isEntry || !/^assets\/[\w.-]+\.js$/.test(entry.file))throw new Error('Terminal entry missing from build manifest');
const visited=new Set(), css=new Set();
function collect(chunk) {
  for(const id of chunk.imports??[]) { if(visited.has(id))continue;visited.add(id);if(!manifest[id])throw new Error('Missing Terminal import');collect(manifest[id]); }
  for(const path of chunk.css??[]) {if(!/^assets\/[\w.-]+\.css$/.test(path))throw new Error('Invalid Terminal CSS');if(!html.includes(`href="/${path}"`))css.add(path);}
}
collect(entry);
if(!css.size)throw new Error('Terminal stylesheet missing');
const script = `<script type="module" src="/${entry.file}"></script>`;
const style = [...css].map(path=>`<link rel="stylesheet" href="/${path}">`).join('\n');
const terminal = html.replace('<html lang="en">', '<html lang="en" data-terminal="true">')
  .replace('<head>', `<head>\n${script}`)
  .replace('</head>', `${style}\n</head>`)
  .replace(/<title>(.*?)<\/title>/, '<title>Terminal · $1</title>')
  .replace('aria-label="CartoLite live map"', 'aria-label="CartoLite Terminal live map"')
  .replace(/(rel="canonical" href="https:\/\/[^"/]+)\//, '$1/terminal/')
  .replace(/(property="og:url" content="https:\/\/[^"/]+)\//, '$1/terminal/');
await mkdir('dist/terminal', { recursive: true });
await writeFile('dist/terminal/index.html', terminal);
// This manifest is build input, not a new public endpoint.
await unlink('dist/.vite/manifest.json');
