import {
  geographicDistanceKm,
  LONG_HAUL_MIN_KM,
  routeDuration,
} from './packetAnimator';
import type { NetgraphAreaAnchor } from './netgraph/areas';
import { normalizePacketKind, type PacketKind } from './trafficVisuals';
import type { PacketView, RoutePacketView } from './types';

export const REGION_LOCAL_PULSE_MS = 3_200;
export const REGION_CROSS_PULSE_MS = 3_800;
export const REGION_DX_PULSE_MS = 10_000;
export const MAX_REGION_ACTIVITY_CUES = 96;

export type RegionPulseRole = 'local' | 'send' | 'receive';

export interface RegionActivityCue {
  regionTag: string;
  kind: PacketKind;
  role: RegionPulseRole;
  startedAt: number;
  duration: number;
  longHaul: boolean;
}

export interface RegionTrafficPlan {
  source: NetgraphAreaAnchor;
  destination: NetgraphAreaAnchor;
  crossRegion: boolean;
  longHaul: boolean;
  distanceKm: number;
  cues: RegionActivityCue[];
}

export interface RegionPulseFrame {
  regionTag: string;
  kind: PacketKind;
  role: RegionPulseRole;
  intensity: number;
  spread: number;
  longHaul: boolean;
}

export function planRegionTraffic(
  packet: PacketView,
  assignments: ReadonlyMap<string, NetgraphAreaAnchor>,
  startedAt: number,
): RegionTrafficPlan | null {
  if (packet.mode !== 'route' || packet.segments.length === 0) return null;
  const route = packet as RoutePacketView;
  const sourceEndpoint = route.segments[0]!.from;
  const destinationEndpoint = route.segments[route.segments.length - 1]!.to;
  const source = assignments.get(sourceEndpoint.id);
  const destination = assignments.get(destinationEndpoint.id);
  if (!source || !destination) return null;

  const kind = normalizePacketKind(packet.payloadType);
  const sourceTag = source.code.toLowerCase();
  const destinationTag = destination.code.toLowerCase();
  const crossRegion = sourceTag !== destinationTag;
  const distanceKm = geographicDistanceKm(sourceEndpoint, destinationEndpoint);
  const longHaul = crossRegion && distanceKm >= LONG_HAUL_MIN_KM;
  const duration = longHaul ? REGION_DX_PULSE_MS : crossRegion ? REGION_CROSS_PULSE_MS : REGION_LOCAL_PULSE_MS;

  if (!crossRegion) {
    return {
      source,
      destination,
      crossRegion,
      longHaul,
      distanceKm,
      cues: [{ regionTag: sourceTag, kind, role: 'local', startedAt, duration, longHaul }],
    };
  }

  const arrivalDelay = routeDuration(route.segments);

  return {
    source,
    destination,
    crossRegion,
    longHaul,
    distanceKm,
    cues: [
      { regionTag: sourceTag, kind, role: 'send', startedAt, duration: duration + arrivalDelay, longHaul },
      {
        regionTag: destinationTag,
        kind,
        role: 'receive',
        startedAt: startedAt + arrivalDelay,
        duration,
        longHaul,
      },
    ],
  };
}

export function regionPulseFrame(
  cue: RegionActivityCue,
  now: number,
  reducedMotion = false,
): RegionPulseFrame | null {
  const age = now - cue.startedAt;
  if (age < 0 || age >= cue.duration) return null;
  if (reducedMotion) {
    return {
      regionTag: cue.regionTag,
      kind: cue.kind,
      role: cue.role,
      intensity: cue.longHaul ? 0.9 : 0.72,
      spread: 0.5,
      longHaul: cue.longHaul,
    };
  }

  const progress = clamp(age / cue.duration);
  const attack = clamp(progress / 0.1);
  const decay = Math.pow(1 - progress, cue.longHaul ? 0.72 : 1.08);
  const shimmer = 0.9 + Math.sin(progress * Math.PI * 4) * 0.1;
  const intensity = clamp(attack * decay * shimmer * (cue.longHaul ? 1.12 : 1));
  const eased = 1 - Math.pow(1 - progress, 3);
  const spread = cue.role === 'send' ? eased : cue.role === 'receive' ? 1 - eased : 0.5;
  return {
    regionTag: cue.regionTag,
    kind: cue.kind,
    role: cue.role,
    intensity,
    spread,
    longHaul: cue.longHaul,
  };
}

export function activeRegionFrames(
  cues: readonly RegionActivityCue[],
  now: number,
  reducedMotion = false,
): Map<string, RegionPulseFrame> {
  const frames = new Map<string, RegionPulseFrame>();
  for (const cue of cues) {
    const frame = regionPulseFrame(cue, now, reducedMotion);
    if (!frame) continue;
    const previous = frames.get(frame.regionTag);
    if (!previous || frame.intensity > previous.intensity) frames.set(frame.regionTag, frame);
  }
  return frames;
}

export function capRegionActivity(cues: readonly RegionActivityCue[]): RegionActivityCue[] {
  return cues.slice(-MAX_REGION_ACTIVITY_CUES);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
