import { stableHash } from '../trafficVisuals';
import type { NodeV2, RouteV2 } from '../types';
import { nearestNetgraphArea, type NetgraphAreaAnchor } from './areas';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const AREA_GEO_SCALE_X = 92;
const AREA_GEO_SCALE_Y = 240;
const AREA_GAP = 150;

export type NetgraphWindow = '15m' | '1h' | '6h' | '24h';

export interface NetgraphPosition {
  id: string;
  x: number;
  y: number;
  degree: number;
  component: number;
  areaCode: string;
}

export interface NetgraphArea {
  code: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  nodeCount: number;
}

export interface NetgraphLayout {
  positions: Map<string, NetgraphPosition>;
  connectedNodeIDs: Set<string>;
  componentCount: number;
  areas: NetgraphArea[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Component {
  ids: string[];
  rootID: string;
}

interface AreaDraft extends NetgraphArea {
  ids: string[];
  desiredX: number;
  desiredY: number;
}

export function netgraphWindowMS(window: NetgraphWindow): number {
  switch (window) {
    case '15m': return 15 * 60_000;
    case '1h': return 60 * 60_000;
    case '6h': return 6 * 60 * 60_000;
    case '24h': return 24 * 60 * 60_000;
  }
}

export function routesInWindow(routes: readonly RouteV2[], now: number, window: NetgraphWindow): RouteV2[] {
  const cutoff = now - netgraphWindowMS(window);
  return routes.filter((route) => route.lastHeard >= cutoff);
}

export function buildNetgraphLayout(
  nodes: readonly NodeV2[],
  routes: readonly RouteV2[],
  assignedAreas: ReadonlyMap<string, NetgraphAreaAnchor> = new Map(),
): NetgraphLayout {
  const nodeByID = new Map(nodes.map((node) => [node.id, node]));
  const nodeIDs = new Set(nodes.map((node) => node.id));
  const sortKeys = new Map(nodes.map((node) => [node.id, `${node.label.toLowerCase()}\u0000${node.id}`]));
  const adjacency = new Map<string, Set<string>>();
  for (const route of routes) {
    if (route.fromId === route.toId || !nodeIDs.has(route.fromId) || !nodeIDs.has(route.toId)) continue;
    addNeighbor(adjacency, route.fromId, route.toId);
    addNeighbor(adjacency, route.toId, route.fromId);
  }

  const connectedNodeIDs = new Set(adjacency.keys());
  const components = connectedComponents(adjacency, sortKeys);
  const componentByNodeID = new Map<string, number>();
  components.forEach((component, componentIndex) => {
    for (const id of component.ids) componentByNodeID.set(id, componentIndex);
  });

  const areaByCode = new Map<string, AreaDraft>();
  for (const id of [...connectedNodeIDs].sort((left, right) => compareSortKey(sortKeys, left, right))) {
    const node = nodeByID.get(id)!;
    const anchor = assignedAreas.get(id) ?? nearestNetgraphArea(node.lat, node.lng);
    let area = areaByCode.get(anchor.code);
    if (!area) {
      area = {
        code: anchor.code,
        name: anchor.name,
        x: anchor.lng * AREA_GEO_SCALE_X,
        y: -anchor.lat * AREA_GEO_SCALE_Y,
        desiredX: anchor.lng * AREA_GEO_SCALE_X,
        desiredY: -anchor.lat * AREA_GEO_SCALE_Y,
        radius: 0,
        nodeCount: 0,
        ids: [],
      };
      areaByCode.set(anchor.code, area);
    }
    area.ids.push(id);
  }

  const areaDrafts = [...areaByCode.values()].sort((left, right) => left.code.localeCompare(right.code));
  for (const area of areaDrafts) {
    area.ids.sort((left, right) => (
      (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0)
      || compareSortKey(sortKeys, left, right)
    ));
    area.nodeCount = area.ids.length;
    area.radius = Math.max(132, 58 + 44 * Math.sqrt(area.nodeCount));
  }
  placeAreas(areaDrafts);

  const positions = new Map<string, NetgraphPosition>();
  for (const area of areaDrafts) {
    const ordered = area.ids;
    const phase = (stableHash(area.code) % 6283) / 1000;
    const count = Math.max(1, ordered.length - 1);
    ordered.forEach((id, index) => {
      const degree = adjacency.get(id)?.size ?? 0;
      if (index === 0) {
        positions.set(id, {
          id,
          x: area.x,
          y: area.y,
          degree,
          component: componentByNodeID.get(id) ?? -1,
          areaCode: area.code,
        });
        return;
      }
      const radius = area.radius * 0.9 * Math.sqrt(index / count);
      const angle = phase + GOLDEN_ANGLE * index;
      positions.set(id, {
        id,
        x: area.x + Math.cos(angle) * radius,
        y: area.y + Math.sin(angle) * radius,
        degree,
        component: componentByNodeID.get(id) ?? -1,
        areaCode: area.code,
      });
    });
  }

  const areas = areaDrafts.map(({ code, name, x, y, radius, nodeCount }) => ({ code, name, x, y, radius, nodeCount }));

  return {
    positions,
    connectedNodeIDs,
    componentCount: components.length,
    areas,
    bounds: layoutBounds(positions, areas),
  };
}

export function extendNetgraphLayout(
  previous: Readonly<NetgraphLayout>,
  nodes: readonly NodeV2[],
  routes: readonly RouteV2[],
  assignedAreas: ReadonlyMap<string, NetgraphAreaAnchor> = new Map(),
): NetgraphLayout {
  if (previous.positions.size === 0) return buildNetgraphLayout(nodes, routes, assignedAreas);

  const canonical = buildNetgraphLayout(nodes, routes, assignedAreas);
  const positions = new Map<string, NetgraphPosition>();
  const canonicalAreas = new Map(canonical.areas.map((area) => [area.code, area]));
  const previousAreas = new Map(previous.areas.map((area) => [area.code, area]));
  const areas = canonical.areas.map((area) => {
    const established = previousAreas.get(area.code);
    return established ? { ...area, x: established.x, y: established.y } : area;
  });
  const stableAreas = new Map(areas.map((area) => [area.code, area]));
  for (const position of canonical.positions.values()) {
    const established = previous.positions.get(position.id);
    if (established) positions.set(position.id, { ...position, x: established.x, y: established.y });
  }

  for (const position of canonical.positions.values()) {
    if (positions.has(position.id)) continue;
    const canonicalArea = canonicalAreas.get(position.areaCode)!;
    const stableArea = stableAreas.get(position.areaCode) ?? canonicalArea;
    const candidate = distinctPoint(
      position.x + stableArea.x - canonicalArea.x,
      position.y + stableArea.y - canonicalArea.y,
      position.id,
      positions,
    );
    positions.set(position.id, { ...position, ...candidate });
  }

  return { ...canonical, positions, areas, bounds: layoutBounds(positions, areas) };
}

export function graphTopologyChanged(
  previous: ReadonlyMap<string, string>,
  changedRoutes: readonly RouteV2[],
  routeCount: number,
): boolean {
  if (previous.size !== routeCount) return true;
  return changedRoutes.some((route) => previous.get(route.id) !== `${route.fromId}>${route.toId}`);
}

export function routeTopology(routes: readonly RouteV2[]): Map<string, string> {
  return new Map(routes.map((route) => [route.id, `${route.fromId}>${route.toId}`]));
}

function connectedComponents(adjacency: ReadonlyMap<string, Set<string>>, sortKeys: ReadonlyMap<string, string>): Component[] {
  const visited = new Set<string>();
  const components: Component[] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    const ids: string[] = [];
    visited.add(start);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      ids.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    ids.sort((left, right) => (
      (adjacency.get(right)?.size ?? 0) - (adjacency.get(left)?.size ?? 0)
      || compareSortKey(sortKeys, left, right)
    ));
    const rootID = ids[0]!;
    components.push({
      ids,
      rootID,
    });
  }
  return components.sort((left, right) => right.ids.length - left.ids.length || left.rootID.localeCompare(right.rootID));
}

function placeAreas(areas: AreaDraft[]): void {
  separateAreas(areas, 100, true);
  separateAreas(areas, 40, false);
}

function separateAreas(areas: AreaDraft[], iterations: number, pullToGeography: boolean): void {
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < areas.length; leftIndex += 1) {
      const left = areas[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < areas.length; rightIndex += 1) {
        const right = areas[rightIndex]!;
        let deltaX = right.x - left.x;
        let deltaY = right.y - left.y;
        let distance = Math.hypot(deltaX, deltaY);
        const minimum = left.radius + right.radius + AREA_GAP;
        if (distance >= minimum) continue;
        if (distance < 0.001) {
          const angle = (stableHash(`${left.code}:${right.code}`) % 6283) / 1000;
          deltaX = Math.cos(angle);
          deltaY = Math.sin(angle);
          distance = 1;
        }
        const shift = (minimum - distance) / 2 + 0.01;
        const unitX = deltaX / distance;
        const unitY = deltaY / distance;
        left.x -= unitX * shift;
        left.y -= unitY * shift;
        right.x += unitX * shift;
        right.y += unitY * shift;
        moved = true;
      }
    }
    if (pullToGeography) {
      for (const area of areas) {
        area.x += (area.desiredX - area.x) * 0.012;
        area.y += (area.desiredY - area.y) * 0.012;
      }
    }
    if (!moved) return;
  }
}

function distinctPoint(
  x: number,
  y: number,
  id: string,
  positions: ReadonlyMap<string, NetgraphPosition>,
): { x: number; y: number } {
  if (isDistinct(x, y, positions)) return { x, y };
  const phase = (stableHash(id) % 6283) / 1000;
  for (let step = 1; step <= 512; step += 1) {
    const radius = 8 + 5 * Math.sqrt(step);
    const candidateX = x + Math.cos(phase + GOLDEN_ANGLE * step) * radius;
    const candidateY = y + Math.sin(phase + GOLDEN_ANGLE * step) * radius;
    if (isDistinct(candidateX, candidateY, positions)) return { x: candidateX, y: candidateY };
  }
  const rightEdge = Math.max(...[...positions.values()].map((position) => position.x));
  return { x: rightEdge + 18, y };
}

function isDistinct(x: number, y: number, positions: ReadonlyMap<string, NetgraphPosition>): boolean {
  for (const position of positions.values()) {
    if (Math.hypot(x - position.x, y - position.y) < 8) return false;
  }
  return true;
}

function layoutBounds(
  positions: ReadonlyMap<string, NetgraphPosition>,
  areas: readonly NetgraphArea[],
): NetgraphLayout['bounds'] {
  if (positions.size === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of positions.values()) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  for (const area of areas) {
    minX = Math.min(minX, area.x - area.radius - 42);
    minY = Math.min(minY, area.y - area.radius - 72);
    maxX = Math.max(maxX, area.x + area.radius + 42);
    maxY = Math.max(maxY, area.y + area.radius + 42);
  }
  return { minX, minY, maxX, maxY };
}

function addNeighbor(adjacency: Map<string, Set<string>>, nodeID: string, neighborID: string): void {
  const neighbors = adjacency.get(nodeID) ?? new Set<string>();
  neighbors.add(neighborID);
  adjacency.set(nodeID, neighbors);
}

function compareSortKey(sortKeys: ReadonlyMap<string, string>, leftID: string, rightID: string): number {
  const left = sortKeys.get(leftID) ?? leftID;
  const right = sortKeys.get(rightID) ?? rightID;
  return left < right ? -1 : left > right ? 1 : 0;
}
