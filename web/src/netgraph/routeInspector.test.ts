import { describe, expect, it, vi } from 'vitest';
import { createRouteInspector, endpointDistanceKM } from './routeInspector';
import type { NodeV2, RouteV2 } from '../types';

const a: NodeV2 = { id: 'a', label: '<img src=x onerror=alert(1)>', lat: 0, lng: 179.9, role: 'repeater', observer: false, lastSeen: Date.now() };
const b: NodeV2 = { ...a, id: 'b', label: 'Bravo', lng: -179.9 };
const route: RouteV2 = { id: 'a-b', fromId: 'a', toId: 'b', packetCount: 120, lastHeard: Date.now(), lastKind: 'Trace', intensity: 2, traffic: 120 };
describe('Netgraph connection inspection', () => {
  it('uses the short distance across the date line and keeps labels and counts honest', () => {
    expect(endpointDistanceKM(a, b)).toBeCloseTo(22.24, 1);
    const onSelectNode = vi.fn();
    const root = createRouteInspector(document, [route], new Map([['a', a], ['b', b]]), { window: '15 minutes', onClose: vi.fn(), onSelectRoute: vi.fn(), onSelectNode });
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain(a.label);
    expect(root.textContent).toContain('120 total observations');
    expect(root.textContent).toContain('Totals include earlier');
    expect(root.querySelector('a')!.getAttribute('href')).toBe('/?node=a');
    root.querySelector<HTMLButtonElement>('[data-node-id="b"]')!.click();
    expect(onSelectNode).toHaveBeenCalledWith('b');
  });
  it('lets overlapping lines be chosen without inferring a path between them', () => {
    const choose = vi.fn();
    const root = createRouteInspector(document, [route, { ...route, id: 'b-a', fromId: 'b', toId: 'a' }], new Map([['a', a], ['b', b]]), { window: '1 hour', onClose: vi.fn(), onSelectNode: vi.fn(), onSelectRoute: choose });
    expect(root.textContent).toContain('Choose a connection');
    root.querySelector<HTMLButtonElement>('[data-route-id="b-a"]')!.click();
    expect(choose).toHaveBeenCalledWith('b-a');
  });
});
