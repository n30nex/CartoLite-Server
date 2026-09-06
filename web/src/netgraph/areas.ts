export interface NetgraphAreaAnchor {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

// Four-character Maidenhead squares: 2 degrees longitude by 1 degree latitude.
// The grid is worldwide and is derived solely from public node coordinates.
export function nearestNetgraphArea(lat: number, lng: number): NetgraphAreaAnchor {
  const longitude = ((lng + 180) % 360 + 360) % 360;
  const latitude = Math.max(0, Math.min(180 - 1e-9, lat + 90));
  const column = Math.floor(longitude / 2);
  const row = Math.floor(latitude);
  const code = String.fromCharCode(65 + Math.floor(column / 10), 65 + Math.floor(row / 10))
    + String(column % 10) + String(row % 10);
  const centerLat = row - 89.5;
  const centerLng = column * 2 - 179;
  return {
    code,
    name: `${Math.abs(centerLat)}°${centerLat < 0 ? 'S' : 'N'} · ${Math.abs(centerLng)}°${centerLng < 0 ? 'W' : 'E'}`,
    lat: centerLat,
    lng: centerLng,
  };
}
