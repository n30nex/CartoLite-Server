import { isRecentNeighborRoute } from './routeFocus';
import type { NodeRole, NodeV2, RouteV2 } from './types';
import type { PacketKind } from './trafficVisuals';

export interface NeighborView {
  id: string;
  label: string;
  role: NodeRole;
  lastHeard: number;
  lastKind: PacketKind;
  packetCount: number;
}

export interface NodeInspectorModel {
  node: NodeV2;
  neighbors: NeighborView[];
}

export interface NodeSearchResult {
  node: NodeV2;
  rank: 0 | 1 | 2;
}

export function buildNodeInspectorModel(
  selectedNodeID: string,
  nodesByID: ReadonlyMap<string, NodeV2>,
  adjacentRoutes: readonly RouteV2[],
  now: number,
  maxAge: number,
): NodeInspectorModel | null {
  const node = nodesByID.get(selectedNodeID);
  if (!node) return null;
  const neighbors = new Map<string, NeighborView>();
  for (const route of adjacentRoutes) {
    if (!isRecentNeighborRoute(route, now, maxAge)) continue;
    const neighborID = route.fromId === selectedNodeID
      ? route.toId
      : route.toId === selectedNodeID ? route.fromId : '';
    if (!neighborID || neighborID === selectedNodeID) continue;
    const neighbor = nodesByID.get(neighborID);
    if (!neighbor) continue;
    const previous = neighbors.get(neighborID);
    if (!previous) {
      neighbors.set(neighborID, {
        id: neighbor.id,
        label: neighbor.label,
        role: neighbor.role,
        lastHeard: route.lastHeard,
        lastKind: route.lastKind,
        packetCount: Math.max(0, route.packetCount),
      });
      continue;
    }
    previous.packetCount += Math.max(0, route.packetCount);
    if (route.lastHeard > previous.lastHeard) {
      previous.lastHeard = route.lastHeard;
      previous.lastKind = route.lastKind;
    }
  }
  return {
    node,
    neighbors: [...neighbors.values()].sort((left, right) => (
      right.lastHeard - left.lastHeard
      || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
      || left.id.localeCompare(right.id)
    )),
  };
}

export function searchNodes(nodes: Iterable<NodeV2>, rawQuery: string, limit = 8): NodeSearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query || limit <= 0) return [];
  const results: NodeSearchResult[] = [];
  for (const node of nodes) {
    const label = node.label.trim().toLocaleLowerCase();
    const rank = label === query ? 0 : label.startsWith(query) ? 1 : label.includes(query) ? 2 : null;
    if (rank === null) continue;
    results.push({ node, rank });
  }
  return results.sort((left, right) => (
    left.rank - right.rank
    || right.node.lastSeen - left.node.lastSeen
    || left.node.label.localeCompare(right.node.label, undefined, { sensitivity: 'base' })
    || left.node.id.localeCompare(right.node.id)
  )).slice(0, Math.floor(limit));
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (seconds < 60) return 'now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function roleLabel(role: NodeRole): string {
  return role.replace('_', ' ');
}

export function createNodeInspectorContent(
  ownerDocument: Document,
  model: NodeInspectorModel,
  options: {
    mobile?: boolean;
    now?: number;
    onClose?: () => void;
    onSelectNeighbor: (nodeID: string) => void;
  },
): HTMLElement {
  const now = options.now ?? Date.now();
  const root = ownerDocument.createElement('section');
  root.className = 'node-inspector';
  root.dataset.nodeId = model.node.id;

  const header = ownerDocument.createElement('header');
  const titleWrap = ownerDocument.createElement('div');
  const title = ownerDocument.createElement('strong');
  title.textContent = model.node.label;
  const summary = ownerDocument.createElement('span');
  summary.textContent = `${roleLabel(model.node.role)}${model.node.observer ? ' · observer' : ''}`;
  titleWrap.append(title, summary);
  header.append(titleWrap);
  if (options.mobile) {
    const close = ownerDocument.createElement('button');
    close.type = 'button';
    close.className = 'node-inspector-close';
    close.setAttribute('aria-label', 'Close node details');
    close.textContent = '×';
    close.addEventListener('click', () => options.onClose?.());
    header.append(close);
  }
  root.append(header);

  const facts = ownerDocument.createElement('dl');
  appendFact(ownerDocument, facts, 'Last seen', relativeTime(model.node.lastSeen, now));
  appendFact(ownerDocument, facts, 'Coordinates', `${model.node.lat.toFixed(4)}, ${model.node.lng.toFixed(4)}`);
  appendFact(ownerDocument, facts, 'Neighbours', String(model.neighbors.length));
  root.append(facts);

  const heading = ownerDocument.createElement('h3');
  heading.textContent = model.neighbors.length === 0 ? 'No neighbours in this route window' : 'Neighbours · newest first';
  root.append(heading);
  if (model.neighbors.length === 0) return root;

  const list = ownerDocument.createElement('div');
  list.className = 'neighbor-list';
  for (const neighbor of model.neighbors) {
    const button = ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'neighbor-row';
    button.dataset.nodeId = neighbor.id;
    const label = ownerDocument.createElement('strong');
    label.textContent = neighbor.label;
    const role = ownerDocument.createElement('span');
    role.textContent = roleLabel(neighbor.role);
    const traffic = ownerDocument.createElement('span');
    const packets = neighbor.packetCount === 1 ? '1 packet' : `${neighbor.packetCount.toLocaleString()} packets`;
    traffic.textContent = `${neighbor.lastKind} · ${packets} · ${relativeTime(neighbor.lastHeard, now)}`;
    button.append(label, role, traffic);
    button.addEventListener('click', () => options.onSelectNeighbor(neighbor.id));
    list.append(button);
  }
  root.append(list);
  return root;
}

function appendFact(ownerDocument: Document, list: HTMLDListElement, label: string, value: string): void {
  const item = ownerDocument.createElement('div');
  const term = ownerDocument.createElement('dt');
  term.textContent = label;
  const description = ownerDocument.createElement('dd');
  description.textContent = value;
  item.append(term, description);
  list.append(item);
}
