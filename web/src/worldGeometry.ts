export type Coordinate = readonly [number, number];
const radians = Math.PI / 180;
const mercatorY = (lat: number): number => Math.log(Math.tan(Math.PI / 4 + Math.max(-85.051129, Math.min(85.051129, lat)) * radians / 2));

export function longitudeDelta(from: number, to: number): number {
  const delta = to - from;
  return delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
}

export function routeCoordinate(from: Coordinate, to: Coordinate, progress: number): [number, number] {
  const t = Math.max(0, Math.min(1, progress));
  const y = mercatorY(from[1]) + (mercatorY(to[1]) - mercatorY(from[1])) * t;
  return [from[0] + longitudeDelta(from[0], to[0]) * t, Math.atan(Math.sinh(y)) / radians];
}

export function splitWorldRoute(from: Coordinate, to: Coordinate): Array<readonly [Coordinate, Coordinate]> {
  const end: Coordinate = [from[0] + longitudeDelta(from[0], to[0]), to[1]];
  if (Math.abs(end[0]) <= 180) return [[from, end]];
  const boundary = end[0] > 180 ? 180 : -180;
  const t = (boundary - from[0]) / (end[0] - from[0]);
  const latitude = routeCoordinate(from, end, t)[1];
  return [[from, [boundary, latitude]], [[-boundary, latitude], [end[0] - Math.sign(boundary) * 360, end[1]]]];
}
