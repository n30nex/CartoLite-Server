import { normalizePacketKind } from '../trafficVisuals';
import type { PacketView } from '../types';

export const KINDS = ['Advert', 'Trace', 'Text', 'ACK', 'Control', 'Other'] as const;
export const MAX_PACKET_BEADS = 64;
export const MAX_PACKET_LINKS = 128;
export const MAX_PENDING = 48;
export const BOX = { width: 4.8, depth: 3.2, height: 0.9, centerY: 0.45 } as const;
export const SPOUT = { x: -0.65, y: 3.15, z: -0.2 } as const;
export const PIT_Y = -4.8;
export const HEADER = 16;
export const TEXTURE_WIDTH = 128;
export interface Rotation { x: number; y: number; z: number; w: number }
export const UPRIGHT: Rotation = { x: 0, y: 0, z: 0, w: 1 };
export interface PacketShape { kind: number; nodes: string[]; links: [number, number][] }
export interface PhysicalPacket { id: number; kind: number; beads: number; links: [number, number][] }
export type Input = { type: 'init'; capacity: number } | { type: 'packet'; packet: PhysicalPacket }
  | { type: 'rotation'; rotation: Rotation } | { type: 'pause'; paused: boolean }
  | { type: 'recycle'; buffer: ArrayBuffer } | { type: 'clear' } | { type: 'dispose' };
export type Output = { type: 'ready'; capacity: number; radius: number }
  | { type: 'impact'; x:number; z:number; kind:number }
  | { type: 'accepted'; id: number; slots: number[] }
  | { type: 'removed'; ids: number[] } | { type: 'rejected'; id: number }
  | { type: 'frame'; buffer: ArrayBuffer } | { type: 'fatal' };
export function frameSize(capacity: number): number { return HEADER + capacity * 8; }
export function particleRadius(capacity: number): number {
  // Packing leaves air gaps. Reserve capacity for beads still falling/spilling,
  // so a settled pile cannot consume every slot and stop the visible overflow.
  return Math.cbrt(BOX.width * BOX.depth * BOX.height / (capacity * 4 * Math.PI / 3));
}
export function capacityFor(coarse: boolean, quality: string): number {
  return coarse ? quality === 'high' ? 2048 : quality === 'economy' ? 768 : 1280
    : quality === 'high' ? 4096 : quality === 'economy' ? 1536 : 3072;
}

/** Visual physics can reshape confirmed edges, never invent an edge across a gap. */
export function packetShape(packet: PacketView): PacketShape | undefined {
  const nodes: string[] = [], indices = new Map<string, number>(), links: [number, number][] = [], seen = new Set<string>();
  const index = (id: string) => { let value = indices.get(id); if (value === undefined) { value = nodes.length; nodes.push(id); indices.set(id, value); } return value; };
  if (packet.mode === 'observer') index(packet.observer.id);
  else for (const segment of packet.segments) {
    const a = index(segment.from.id), b = index(segment.to.id);
    if (a === b) continue;
    const key = `${Math.min(a,b)}:${Math.max(a,b)}`;
    if (!seen.has(key)) { links.push([a,b]); seen.add(key); }
  }
  if (!nodes.length || nodes.length > MAX_PACKET_BEADS || links.length > MAX_PACKET_LINKS || (packet.mode === 'route' && !links.length)) return;
  return { nodes, links, kind: KINDS.indexOf(normalizePacketKind(packet.payloadType)) };
}
export function normalizedRotation(value: Rotation): Rotation | undefined {
  const values = [value.x,value.y,value.z,value.w];
  if (!values.every(Number.isFinite)) return;
  const length = Math.hypot(...values); if (length < 0.001) return;
  return {x:value.x/length,y:value.y/length,z:value.z/length,w:value.w/length};
}
export function approachRotation(a: Rotation, b: Rotation, maxAngle: number): Rotation {
  let dot = a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w;
  const sign = dot < 0 ? -1 : 1; dot = Math.min(1, Math.abs(dot));
  const angle = Math.acos(dot), t = angle < 1e-6 ? 1 : Math.min(1,maxAngle/(angle*2));
  const sa = angle < 1e-6 ? 1-t : Math.sin((1-t)*angle)/Math.sin(angle);
  const sb = (angle < 1e-6 ? t : Math.sin(t*angle)/Math.sin(angle))*sign;
  return normalizedRotation({x:a.x*sa+b.x*sb,y:a.y*sa+b.y*sb,z:a.z*sa+b.z*sb,w:a.w*sa+b.w*sb})!;
}
