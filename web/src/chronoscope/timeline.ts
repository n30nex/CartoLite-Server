import { routeDuration, segmentTravelWeights } from '../packetAnimator';
import type { PacketView } from '../types';

export const MAX_TIME_MS = 120_000;
export const MAX_EVENTS = 1_024;
export const MAX_SEGMENTS = 4_096;
export type ChronoscopeMode = 'sculpture' | 'slice' | 'flat';
export interface Observation {
  packet: PacketView;
  started: number;
  duration: number;
  weights: number[];
  cost: number;
}

/** Only newly received public events enter this bounded, session-local view. */
export class ChronoscopeTimeline {
  #records: Observation[] = [];
  #cost = 0;
  #lastSeq = -1;
  #frozen?: { at: number; records: readonly Observation[] };
  trimmed = false;
  get records(): readonly Observation[] { return this.#records; }
  get segmentCount(): number { return this.#cost; }
  get frozen(): boolean { return Boolean(this.#frozen); }
  get frozenAt(): number | undefined { return this.#frozen?.at; }
  clock(now: number): number { return this.#frozen?.at ?? now; }
  freeze(now: number): void {
    if (!this.#frozen) this.#frozen = { at: now, records: [...this.#records] };
  }
  resume(): void { this.#frozen = undefined; }
  clear(): void { this.#records = []; this.#cost = 0; this.#lastSeq = -1; this.#frozen = undefined; this.trimmed = false; }

  add(packet: PacketView, now: number): Observation | undefined {
    if (!Number.isFinite(now) || packet.seq <= this.#lastSeq) return;
    this.#lastSeq = packet.seq;
    const cost = packet.mode === 'route' ? packet.segments.length : 1;
    if (!cost || cost > MAX_SEGMENTS) { this.trimmed = true; return; }
    this.prune(now);
    const record = { packet, started: now, cost, duration: packet.mode === 'route' ? routeDuration(packet.segments) : 1_200,
      weights: packet.mode === 'route' ? segmentTravelWeights(packet.segments) : [] };
    this.#records.push(record); this.#cost += cost;
    while (this.#records.length > MAX_EVENTS || this.#cost > MAX_SEGMENTS) {
      this.#cost -= this.#records.shift()!.cost; this.trimmed = true;
    }
    return record;
  }
  prune(now: number): void {
    while (this.#records.length && now - this.#records[0]!.started > MAX_TIME_MS) this.#cost -= this.#records.shift()!.cost;
  }
  visible(now: number, seconds: number): readonly Observation[] {
    const at = this.clock(now);
    return (this.#frozen?.records ?? this.#records).filter(record => at - record.started >= 0 && at - record.started <= seconds * 1_000);
  }
}

export interface ChronoscopePreferences { mode: ChronoscopeMode; seconds: 30 | 60 | 120; regions: string[] | null }
export function normalizeChronoscope(value: unknown): ChronoscopePreferences {
  const v = value && typeof value === 'object' ? value as Partial<ChronoscopePreferences> : {};
  return { mode: v.mode === 'flat' || v.mode === 'slice' ? v.mode : 'sculpture', seconds: v.seconds === 30 || v.seconds === 120 ? v.seconds : 60,
    regions: Array.isArray(v.regions) ? [...new Set(v.regions.filter((code): code is string => typeof code === 'string' && code.length <= 80))].slice(0, 512) : null };
}
