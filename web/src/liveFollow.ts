import { normalizePacketKind } from './trafficVisuals';
import type { EndpointV2, PacketView } from './types';

export const FOLLOW_DWELL_MS = 10_000;

// One pending item bounds memory even during a busy feed. Prefer activity in
// the current view; an equally relevant arrival replaces the older one.
export class FollowQueue {
  private pending?: { packet: PacketView; priority: number; receivedAt: number };
  private nextAt = 0;

  offer(packet: PacketView, priority: number, now: number): void {
    if (!this.pending || now - this.pending.receivedAt > FOLLOW_DWELL_MS || priority >= this.pending.priority) {
      this.pending = { packet, priority, receivedAt: now };
    }
  }

  take(now: number): PacketView | undefined {
    if (now < this.nextAt || !this.pending) return undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (now - pending.receivedAt > FOLLOW_DWELL_MS * 2) return undefined;
    this.nextAt = now + FOLLOW_DWELL_MS;
    return pending.packet;
  }

  remaining(now: number): number {
    return Math.ceil(Math.max(0, this.nextAt - now) / 1000);
  }

  clear(): void {
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
