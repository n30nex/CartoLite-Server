import { describe, expect, it, vi } from 'vitest';
import { buildNodeInspectorModel, createNodeInspectorContent, searchNodes } from './nodeInspector';
import type { NodeV2, RouteV2 } from './types';

const now = 1_700_000_000_000;
const node = (id: string, label: string, lastSeen = now): NodeV2 => ({
  id, label, lastSeen, lat: 43.5, lng: -80.2, role: 'repeater', observer: false,
});
const route = (id: string, fromId: string, toId: string, lastHeard: number, packetCount = 1): RouteV2 => ({
  id, fromId, toId, lastHeard, packetCount, intensity: 1, lastKind: 'Trace', traffic: 1,
});

describe('node inspector model', () => {
  it('filters the active window and sorts newest first with deterministic ties', () => {
    const nodes = new Map([
      ['a', node('a', 'Anchor')], ['b', node('b', 'Zulu')], ['c', node('c', 'Alpha')], ['d', node('d', 'Old')],
    ]);
    const model = buildNodeInspectorModel('a', nodes, [
      route('ab', 'a', 'b', now - 1_000),
      route('ac', 'c', 'a', now - 1_000),
      route('ad', 'a', 'd', now - 70_000),
    ], now, 60_000);
    expect(model?.neighbors.map(({ id }) => id)).toEqual(['c', 'b']);
  });

  it('updates packet totals while keeping the newest sanitized kind', () => {
    const nodes = new Map([['a', node('a', 'A')], ['b', node('b', 'B')]]);
    const old = route('ab-1', 'a', 'b', now - 2_000, 4);
    const recent = { ...route('ab-2', 'b', 'a', now - 1_000, 3), lastKind: 'ACK' as const };
    const model = buildNodeInspectorModel('a', nodes, [old, recent], now, 60_000);
    expect(model?.neighbors[0]).toMatchObject({ id: 'b', packetCount: 7, lastKind: 'ACK' });
  });

  it('renders untrusted labels as text and selects neighbours', () => {
    const nodes = new Map([['a', node('a', '<img src=x>')], ['b', node('b', '<script>alert(1)</script>')]]);
    const model = buildNodeInspectorModel('a', nodes, [route('ab', 'a', 'b', now)], now, 60_000)!;
    const select = vi.fn();
    const content = createNodeInspectorContent(document, model, { now, onSelectNeighbor: select });
    expect(content.querySelector('img')).toBeNull();
    expect(content.querySelector('script')).toBeNull();
    expect(content.textContent).toContain('<img src=x>');
    (content.querySelector('.neighbor-row') as HTMLButtonElement).click();
    expect(select).toHaveBeenCalledWith('b');
  });
});

describe('node finder', () => {
  it('ranks exact then prefix then contains and keeps duplicate labels distinct', () => {
    const results = searchNodes([
      node('old-exact', 'Maple', now - 10_000),
      node('new-exact', 'Maple', now - 1_000),
      node('prefix', 'Maple Ridge', now),
      node('contains', 'East Maple', now),
      node('miss', 'Birch', now),
    ], 'maple');
    expect(results.map(({ node: result }) => result.id)).toEqual(['new-exact', 'old-exact', 'prefix', 'contains']);
  });
});
