import { normalizePacketKind } from './trafficVisuals';
import type { EndpointV2, PacketView } from './types';

export const FOLLOW_DWELL_MS = 10_000;

// One pending item bounds memory even during a busy feed. Prefer activity in
// the current view; an equally relevant arrival replaces the older one.
export class FollowQueue {
  private pending?: { packet: PacketView; priority: number; receivedAt: number };
  private nextAt = 0;
  private heldAt?: number;

  offer(packet: PacketView, priority: number, now: number): void {
    if (!this.pending || now - this.pending.receivedAt > FOLLOW_DWELL_MS || priority >= this.pending.priority) {
      this.pending = { packet, priority, receivedAt: now };
    }
  }

  take(now: number): PacketView | undefined {
    if (this.heldAt !== undefined || now < this.nextAt || !this.pending) return undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (now - pending.receivedAt > FOLLOW_DWELL_MS * 2) return undefined;
    this.nextAt = now + FOLLOW_DWELL_MS;
    return pending.packet;
  }

  remaining(now: number): number {
    return Math.ceil(Math.max(0, this.nextAt - (this.heldAt ?? now)) / 1000);
  }

  setHeld(held: boolean, now: number): void {
    if (held && this.heldAt === undefined) this.heldAt = now;
    else if (!held && this.heldAt !== undefined) { this.nextAt += now - this.heldAt; this.heldAt = undefined; }
  }

  next(): void { this.nextAt = 0; this.heldAt = undefined; }

  clear(): void {
    this.heldAt = undefined;
    this.pending = undefined;
    this.nextAt = 0;
  }
}

export function followEndpoints(packet: PacketView): EndpointV2[] {
  const endpoints = packet.mode === 'observer' ? [packet.observer] : packet.segments.flatMap((hop) => [hop.from, hop.to]);
  return [...new Map(endpoints.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .map((point) => [point.id, point])).values()];
}

export function followSummary(packet: PacketView): { title: string; detail: string } {
  const kind = normalizePacketKind(packet.payloadType);
  if (packet.mode === 'observer') return { title: packet.observer.label || 'Observer', detail: `${kind} · heard here` };
  const first = packet.segments[0]?.from.label || 'Node';
  const last = packet.segments.at(-1)?.to.label || 'Node';
  const hops = packet.segments.length;
  const connected = packet.segments.every((hop, index) => index === 0 || packet.segments[index - 1]!.to.id === hop.from.id);
  return { title: connected ? `${first} → ${last}` : `${first} · ${hops} observed links`, detail: `${kind} · ${hops} confirmed ${hops === 1 ? 'hop' : 'hops'}` };
}

export type FollowScope = { kind: 'everywhere' } | { kind: 'node'; id: string } | { kind: 'area'; bounds: readonly [number, number, number, number] };
export function followsScope(packet: PacketView, scope: FollowScope): boolean {
  const points = followEndpoints(packet);
  if (!points.length) return false;
  if (scope.kind === 'everywhere') return true;
  if (scope.kind === 'node') return points.some(point => point.id === scope.id);
  const [west, south, east, north] = scope.bounds;
  return points.every(point => {
    const lng = ((point.lng + 180) % 360 + 360) % 360 - 180;
    const insideLongitude = east - west >= 360 || (west <= east ? lng >= west && lng <= east : lng >= west || lng <= east);
    return point.lat >= south && point.lat <= north && insideLongitude;
  });
}
