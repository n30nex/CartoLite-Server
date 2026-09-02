import { assertStateV2, sequenceAction } from './state';
import type {
  HelloV2,
  NodeEventV2,
  PacketEventV2,
  ResetV2,
  StateV2,
  StatusEventV2
} from './types';

export async function fetchState(signal?: AbortSignal): Promise<StateV2> {
  const response = await fetch('/api/state', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  });
  if (!response.ok) throw new Error(`state request failed (${response.status})`);
  const body: unknown = await response.json();
  assertStateV2(body);
  return body;
}

export interface LiveFeedHandlers {
  onConnection(connected: boolean): void;
  onNode(event: NodeEventV2): void;
  onPacket(event: PacketEventV2): void;
  onStatus(event: StatusEventV2): void;
  recover(): Promise<StateV2>;
  onError(error: Error): void;
}

export class LiveFeed {
  private source?: EventSource;
  private bootId: string;
  private seq: number;
  private recovering?: Promise<void>;
  private recoveryTimer?: number;
  private recoveryFailures = 0;
  private stopped = false;

  constructor(initial: StateV2, private readonly handlers: LiveFeedHandlers) {
    this.bootId = initial.bootId;
    this.seq = initial.seq;
  }

  start(): void {
    if (this.source || this.stopped || this.recovering || this.recoveryTimer !== undefined) return;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.recoveryTimer !== undefined) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.closeSource();
  }

  resume(): Promise<void> {
    return this.requestRecovery();
  }

  private connect(): void {
    if (this.source || this.stopped) return;
    const cursor = new URLSearchParams({ bootId: this.bootId, after: String(this.seq) });
    const source = new EventSource(`/api/events?${cursor.toString()}`, { withCredentials: true });
    this.source = source;
    const current = (): boolean => this.source === source && !this.recovering && !this.stopped;
    source.onopen = () => { if (current()) this.handlers.onConnection(true); };
    source.onerror = () => { if (current()) this.handlers.onConnection(false); };
    source.addEventListener('hello', (event) => { if (current()) this.handleHello(event); });
    source.addEventListener('node', (event) => {
      if (current()) this.handleSequenced<NodeEventV2>(event, this.handlers.onNode);
    });
    source.addEventListener('packet', (event) => {
      if (current()) this.handleSequenced<PacketEventV2>(event, this.handlers.onPacket);
    });
    source.addEventListener('status', (event) => {
      if (current()) this.handleSequenced<StatusEventV2>(event, this.handlers.onStatus);
    });
    source.addEventListener('reset', (event) => { if (current()) this.handleReset(event); });
  }

  private closeSource(): void {
    const source = this.source;
    this.source = undefined;
    source?.close();
    this.handlers.onConnection(false);
  }

  private handleHello(raw: Event): void {
    try {
      const hello = parseEvent<HelloV2>(raw);
      if (hello.bootId !== this.bootId) {
        void this.requestRecovery();
      }
    } catch (error) {
      this.report(error);
      void this.requestRecovery();
    }
  }

  private handleReset(raw: Event): void {
    try {
      const reset = parseEvent<ResetV2>(raw);
      if (reset.bootId !== this.bootId || reset.seq >= this.seq) void this.requestRecovery();
    } catch (error) {
      this.report(error);
    }
  }

  private handleSequenced<T extends { seq: number }>(raw: Event, apply: (event: T) => void): void {
    try {
      const event = parseEvent<T>(raw);
      const action = sequenceAction(this.seq, event.seq);
      if (action === 'duplicate') return;
      if (action === 'gap') {
        void this.requestRecovery();
        return;
      }
      this.seq = event.seq;
      apply(event);
    } catch (error) {
      this.report(error);
      void this.requestRecovery();
    }
  }

  private requestRecovery(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.recovering) return this.recovering;
    if (this.recoveryTimer !== undefined) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
    this.closeSource();
    let recovered = false;
    let recovery!: Promise<void>;
    recovery = Promise.resolve()
      .then(() => this.handlers.recover())
      .then((snapshot) => {
        if (this.stopped) return;
        this.bootId = snapshot.bootId;
        this.seq = snapshot.seq;
        this.recoveryFailures = 0;
        recovered = true;
      })
      .catch((error: unknown) => {
        this.recoveryFailures += 1;
        this.report(error);
      })
      .finally(() => {
        if (this.recovering === recovery) this.recovering = undefined;
        if (this.stopped) return;
        if (recovered) this.connect();
        else this.scheduleRecovery();
      });
    this.recovering = recovery;
    return recovery;
  }

  private scheduleRecovery(): void {
    if (this.stopped || this.recoveryTimer !== undefined) return;
    const delay = Math.min(10_000, 500 * (2 ** Math.min(this.recoveryFailures, 5)));
    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = undefined;
      void this.requestRecovery();
    }, delay);
  }

  private report(error: unknown): void {
    this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

function parseEvent<T>(event: Event): T {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
    throw new Error('invalid event stream message');
  }
  return JSON.parse(event.data) as T;
}
