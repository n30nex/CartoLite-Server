const key = process.env.CARTO_BASEMAP_API_KEY?.trim()
if (!key) throw new Error('CARTO_BASEMAP_API_KEY is required')

const tileJSON = await checkedFetch(
  `https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json?key=${encodeURIComponent(key)}`,
  'TileJSON',
  'application/json',
)
const metadata = JSON.parse(new TextDecoder().decode(tileJSON.body))
const template = metadata.tiles?.[0]
if (typeof template !== 'string') throw new Error('CARTO TileJSON has no vector tile template')

const tileURL = new URL(template.replace('{z}', '0').replace('{x}', '0').replace('{y}', '0'))
tileURL.searchParams.set('key', key)
const vector = await checkedFetch(tileURL, 'vector PBF', 'protobuf')
const glyphURL = new URL('https://tiles.basemaps.cartocdn.com/fonts/Open%20Sans%20Regular/0-255.pbf')
glyphURL.searchParams.set('key', key)
const glyph = await checkedFetch(glyphURL, 'glyph PBF', 'protobuf')

console.log(JSON.stringify({
  tileJSON: { status: tileJSON.status, type: tileJSON.type, bytes: tileJSON.bytes },
  vector: { status: vector.status, type: vector.type, bytes: vector.bytes },
  glyph: { status: glyph.status, type: glyph.type, bytes: glyph.bytes },
}))

async function checkedFetch(url, label, expectedType) {
  const response = await fetch(url, { headers: { accept: '*/*' }, signal: AbortSignal.timeout(5_000) })
  const body = new Uint8Array(await response.arrayBuffer())
  const bytes = body.byteLength
  const type = response.headers.get('content-type')?.split(';', 1)[0] ?? ''
  if (!response.ok || bytes === 0 || !type.includes(expectedType)) {
    throw new Error(`${label} failed authorization or content validation (status ${response.status}, type ${type || 'missing'}, bytes ${bytes})`)
  }
  return { status: response.status, type, bytes, body }
}
