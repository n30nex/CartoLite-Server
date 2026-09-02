import type { RouteV2 } from './types';

export const NEIGHBOR_ROUTE_RECENT_MS = 24 * 60 * 60_000;

export function recentNeighborRoutes(
  routes: readonly RouteV2[],
  selectedNodeID: string | null,
  now = Date.now(),
  maxAge = NEIGHBOR_ROUTE_RECENT_MS
): RouteV2[] {
  if (!selectedNodeID) return [];
  return routes.filter((route) => (
    (route.fromId === selectedNodeID || route.toId === selectedNodeID) && isRecentNeighborRoute(route, now, maxAge)
  ));
}

export function isRecentNeighborRoute(
  route: Pick<RouteV2, 'lastHeard'>,
  now: number,
  maxAge = NEIGHBOR_ROUTE_RECENT_MS
): boolean {
  return route.lastHeard > 0 && Math.max(0, now - route.lastHeard) <= maxAge;
}
