let offset: number | undefined;
let lastRequest = -Infinity;

/** Data ages use the HTTP server clock; animation and dwell use performance.now. */
export function trafficNow(): number {
  return offset === undefined ? Date.now() : offset + performance.now();
}

/** Date is fresh even when the JSON snapshot was cached during a quiet period. */
export function syncTrafficClock(date: string | null, received: number, requested = received): void {
  const time = Date.parse(date ?? '');
  if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(received)
    || !Number.isFinite(requested) || requested < lastRequest) return;
  offset = time - received;
  lastRequest = requested;
}
