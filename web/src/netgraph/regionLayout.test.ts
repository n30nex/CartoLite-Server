import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildNetgraphLayout, extendNetgraphLayout } from './layout';
import { arrangeRegions, loadRegionLayout, normalizeRegionLayout, REGION_LAYOUT_KEY, saveRegionLayout } from './regionLayout';
import { GraphProjection, GRAPH_TILT } from './camera';
import type { NodeV2, RouteV2 } from '../types';

const nodes: NodeV2[] = ['a', 'b', 'c', 'd'].map(id => ({ id, label: id, lat: 45, lng: -75, role: 'repeater', observer: false, lastSeen: 1 }));
const routes: RouteV2[] = [['a', 'b'], ['b', 'c'], ['c', 'd']].map(([fromId, toId], i) => ({ id: String(i), fromId: fromId!, toId: toId!, packetCount: 1, lastHeard: 1, intensity: 1, lastKind: 'Text', traffic: 1 }));
const west = { code: 'WEST', name: 'West', lat: 45, lng: -120 }, east = { code: 'EAST', name: 'East', lat: 45, lng: -75 };
const assignments = new Map([['a', west], ['b', west], ['c', east], ['d', east]]);
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('saved region arrangements', () => {
  it('moves whole bubbles, preserves internal spacing and never mutates source geometry/topology', () => {
    const base = buildNetgraphLayout(nodes, routes, assignments), original = structuredClone(base);
    const settings = normalizeRegionLayout({ spacing: 3, offsets: { WEST: { x: 210, y: -80 } } });
    const moved = arrangeRegions(base, settings);
    const a = moved.positions.get('a')!, b = moved.positions.get('b')!;
    expect(a.x - b.x).toBeCloseTo(base.positions.get('a')!.x - base.positions.get('b')!.x);
    expect(a.y - b.y).toBeCloseTo(base.positions.get('a')!.y - base.positions.get('b')!.y);
    expect(moved.areas.find(a => a.code === 'WEST')!.x).toBeCloseTo((base.areas.find(a => a.code === 'WEST')!.x + 210) * 3);
    expect(moved.connectedNodeIDs).toEqual(base.connectedNodeIDs);
    expect(moved.componentCount).toBe(base.componentCount);
    expect(base).toEqual(original);
    expect(arrangeRegions(base, normalizeRegionLayout(null))).toEqual(base);
  });
  it('keeps an arrangement through live extension and restores it from device storage', () => {
    const base = buildNetgraphLayout(nodes, routes, assignments);
    const settings = normalizeRegionLayout({ spacing: 2, offsets: { WEST: { x: 200, y: 90 } }, regions: ['WEST'], routes: false });
    expect(saveRegionLayout(settings)).toBe(true);
    const before = arrangeRegions(base, settings);
    const newNode = { ...nodes[0]!, id: 'new' }, newRoute = { ...routes[0]!, id: 'new-route', toId: 'new' };
    const extended = extendNetgraphLayout(base, [...nodes, newNode], [...routes, newRoute], new Map([...assignments, ['new', west]]));
    const after = arrangeRegions(extended, loadRegionLayout());
    for (const id of nodes.map(n => n.id)) expect(after.positions.get(id)!.x).toBe(before.positions.get(id)!.x);
    expect(after.positions.get('new')!.areaCode).toBe('WEST');
    expect(loadRegionLayout().regions).toEqual(['WEST']); expect(loadRegionLayout().routes).toBe(false);
    expect(JSON.parse(localStorage.getItem(REGION_LAYOUT_KEY)!)).not.toHaveProperty('nodes');
  });
  it('rejects corrupt storage, unbounded offsets and prototype keys without touching other preferences', () => {
    localStorage.setItem('cartolite:display:v1', 'saved appearance');
    localStorage.setItem(REGION_LAYOUT_KEY, '{bad json'); expect(loadRegionLayout().spacing).toBe(1);
    const value = normalizeRegionLayout(JSON.parse('{"spacing":999,"offsets":{"__proto__":{"x":1,"y":2},"WEST":{"x":1e99,"y":0}},"regions":["WEST","WEST",4,"<script>"],"routes":false}'));
    expect(value.spacing).toBe(4); expect(Object.keys(value.offsets)).toEqual([]); expect(value.regions).toEqual(['WEST']);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveRegionLayout(value)).toBe(false);
    expect(localStorage.getItem('cartolite:display:v1')).toBe('saved appearance');
  });
  it('keeps permitted rearrangements above the 3D near plane', () => {
    const base = buildNetgraphLayout(nodes, routes, assignments), b = base.bounds;
    const d = Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
    const settings = normalizeRegionLayout({ spacing: 4, offsets: { WEST: { x: d, y: d } } });
    const layout = arrangeRegions(base, settings);
    for (const yaw of [0, 1.2, 2.5]) {
      const projection = new GraphProjection({ x: (b.minX + b.maxX) * 2, y: (b.minY + b.maxY) * 2, zoom: 0.01, distance: d * 8, tilt: GRAPH_TILT, yaw }, 1200, 800);
      expect([...layout.positions.values()].every(p => projection.project(p).visible)).toBe(true);
    }
  });
});
