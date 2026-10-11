import { observationTotal, relativeTime, roleLabel } from '../nodeInspector';
import { normalizePacketKind } from '../trafficVisuals';
import { longitudeDelta } from '../worldGeometry';
import type { NodeV2, RouteV2 } from '../types';

export function endpointDistanceKM(a: NodeV2, b: NodeV2): number {
  const radians = Math.PI / 180, latitude = (b.lat - a.lat) * radians, longitude = longitudeDelta(a.lng, b.lng) * radians;
  const value = Math.sin(latitude / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(longitude / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, value))));
}

export function createRouteInspector(document: Document, routes: readonly RouteV2[], nodes: ReadonlyMap<string, NodeV2>, options: {
  window: string; onClose(): void; onSelectRoute(id: string): void; onSelectNode(id: string): void;
}): HTMLElement {
  const root = document.createElement('section'); root.className = 'node-inspector route-inspector';
  const header = document.createElement('header'), title = document.createElement('strong');
  title.textContent = routes.length === 1 ? 'Confirmed connection' : 'Choose a connection';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'node-inspector-close';
  close.textContent = '×'; close.setAttribute('aria-label', 'Close connection details'); close.addEventListener('click', options.onClose);
  header.append(title, close); root.append(header);
  if (routes.length !== 1) {
    const hint = document.createElement('p'); hint.textContent = 'Several lines meet here. Choose the endpoints you want to inspect.'; root.append(hint);
    const list = document.createElement('div'); list.className = 'neighbor-list';
    for (const route of routes) {
      const from = nodes.get(route.fromId), to = nodes.get(route.toId);
      if (!from || !to) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'neighbor-row';
      button.dataset.routeId = route.id; button.textContent = `${from.label} ↔ ${to.label}`;
      button.addEventListener('click', () => options.onSelectRoute(route.id)); list.append(button);
    }
    root.append(list); return root;
  }
  const route = routes[0]!, from = nodes.get(route.fromId), to = nodes.get(route.toId);
  if (!from || !to) return root;
  root.dataset.routeId = route.id;
  const endpoints = document.createElement('div'); endpoints.className = 'route-endpoints';
  for (const node of [from, to]) {
    const row = document.createElement('div'), inspect = document.createElement('button'), map = document.createElement('a');
    inspect.type = 'button'; inspect.dataset.nodeId = node.id; inspect.textContent = node.label;
    inspect.title = `Inspect ${roleLabel(node.role)}`; inspect.addEventListener('click', () => options.onSelectNode(node.id));
    map.textContent = 'Map'; map.href = '/?node=' + encodeURIComponent(node.id); map.setAttribute('aria-label', `Open ${node.label} on map`);
    row.append(inspect, map); endpoints.append(row);
  }
  root.append(endpoints);
  const facts = document.createElement('dl');
  const distance = endpointDistanceKM(from, to);
  for (const [label, value] of [['Last heard', relativeTime(route.lastHeard)], ['Latest category', normalizePacketKind(route.lastKind)],
    ['Endpoint distance', `${distance < 10 ? distance.toFixed(1) : Math.round(distance).toLocaleString()} km approx.`], ['Retained total', observationTotal(route.packetCount)]]) {
    const item = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = label!; detail.textContent = value!; item.append(term, detail); facts.append(item);
  }
  root.append(facts);
  const note = document.createElement('p'); note.className = 'inspector-window-note';
  note.textContent = `Heard within ${options.window}. Totals include earlier observations. Distance is between reported node positions; graph height is schematic. Live packet motion shows observed direction.`;
  root.append(note); return root;
}
