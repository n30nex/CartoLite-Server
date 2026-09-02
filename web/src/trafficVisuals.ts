export type PacketKind = 'Advert' | 'Trace' | 'Text' | 'ACK' | 'Control' | 'Other';
export type PacketSignature = 'ripple' | 'echo' | 'orbit' | 'double' | 'tick';

export const PACKET_KINDS: readonly PacketKind[] = ['Advert', 'Trace', 'Text', 'ACK', 'Control', 'Other'];

export const ROUTE_TRAFFIC_HALF_LIFE_MS = 15 * 60_000;
export const ROUTE_TRAFFIC_MAX = 64;
export const ROUTE_BRIGHT_AGE_MS = 60 * 60_000;
export const ROUTE_MAX_AGE_MS = 24 * 60 * 60_000;

export const PACKET_KIND_COLORS: Readonly<Record<PacketKind, string>> = {
  Advert: '#4de7c4',
  Trace: '#ffd15a',
  Text: '#ff75b5',
  ACK: '#78cfff',
  Control: '#a78bfa',
  Other: '#9caebd'
};

export const PACKET_KIND_SIGNATURES: Readonly<Record<PacketKind, PacketSignature>> = {
  Advert: 'ripple',
  Trace: 'echo',
  Text: 'orbit',
  ACK: 'double',
  Control: 'tick',
  Other: 'tick'
};

export const ROUTE_LEGEND_ITEMS: readonly { kind: PacketKind; label: string; shortLabel: string; accessibleLabel: string }[] = [
  { kind: 'Advert', label: 'Advert', shortLabel: 'Adv', accessibleLabel: 'Advert' },
  { kind: 'Trace', label: 'Trace', shortLabel: 'Trc', accessibleLabel: 'Trace' },
  { kind: 'Text', label: 'Text', shortLabel: 'Txt', accessibleLabel: 'Text' },
  { kind: 'ACK', label: 'ACK', shortLabel: 'ACK', accessibleLabel: 'ACK' },
  { kind: 'Control', label: 'Control', shortLabel: 'Ctl', accessibleLabel: 'Control or other' }
];

export function normalizePacketKind(payloadType: string | undefined): PacketKind {
  const value = payloadType?.trim().toLowerCase() ?? '';
  if (value.includes('trace')) return 'Trace';
  if (value.includes('text')) return 'Text';
  if (value.includes('ack')) return 'ACK';
  if (value.includes('advert')) return 'Advert';
  if (value.includes('control')) return 'Control';
  return 'Other';
}

export function payloadColor(payloadType: string | undefined): string {
  return PACKET_KIND_COLORS[normalizePacketKind(payloadType)];
}

export function packetSignature(payloadType: string | undefined): PacketSignature {
  return PACKET_KIND_SIGNATURES[normalizePacketKind(payloadType)];
}

export function decayedRouteTraffic(traffic: number, lastHeard: number, now: number): number {
  const bounded = boundedTraffic(traffic);
  if (bounded === 0 || !Number.isFinite(lastHeard) || !Number.isFinite(now)) return bounded;
  const age = Math.max(0, now - lastHeard);
  return bounded * Math.pow(0.5, age / ROUTE_TRAFFIC_HALF_LIFE_MS);
}

export function routeTrafficAfterPacket(traffic: number, lastHeard: number, packetAt: number): number {
  const bounded = boundedTraffic(traffic);
  if (!Number.isFinite(packetAt)) return bounded;
  if (!Number.isFinite(lastHeard) || lastHeard <= 0) return Math.min(ROUTE_TRAFFIC_MAX, bounded + 1);
  if (packetAt >= lastHeard) {
    return Math.min(ROUTE_TRAFFIC_MAX, decayedRouteTraffic(bounded, lastHeard, packetAt) + 1);
  }
  const delayedContribution = Math.pow(0.5, (lastHeard - packetAt) / ROUTE_TRAFFIC_HALF_LIFE_MS);
  return Math.min(ROUTE_TRAFFIC_MAX, bounded + delayedContribution);
}

export function trafficRenderBucket(traffic: number): number {
  return Math.floor(Math.log2(1 + boundedTraffic(traffic)) * 4);
}

function boundedTraffic(traffic: number): number {
  if (!Number.isFinite(traffic)) return 0;
  return Math.max(0, Math.min(ROUTE_TRAFFIC_MAX, traffic));
}
