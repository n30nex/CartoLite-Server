// Each document has one screen-lock owner, shared by its view entry point.
let lock: WakeLockSentinel | undefined;
let pending: Promise<void> | undefined;
let wanted = false;

function state(value: string): void {
  document.querySelector('main')?.setAttribute('data-screen-awake', value);
}

export function requestScreenAwake(): Promise<void> {
  wanted = true;
  if (/CartoLiteAndroid\//.test(navigator.userAgent)) { state('native'); return Promise.resolve(); }
  if (document.documentElement.dataset.viewClass !== 'mobile' && !matchMedia('(pointer: coarse)').matches) {
    state('desktop'); return Promise.resolve();
  }
  const api = navigator.wakeLock;
  if (!api) { state('unsupported'); return Promise.resolve(); }
  if (document.hidden || lock && !lock.released) return Promise.resolve();
  if (pending) return pending;
  state('requesting');
  pending = api.request('screen').then(async sentinel => {
    if (!wanted || document.hidden) {
      await sentinel.release(); state('false'); return;
    }
    lock = sentinel; state('true');
    sentinel.addEventListener('release', () => {
      if (lock === sentinel) { lock = undefined; state('false'); }
    }, { once: true });
  }).catch(() => { state('retry'); }).finally(() => { pending = undefined; });
  return pending;
}

export function releaseScreenAwake(): void {
  wanted = false; state('false');
  const sentinel = lock; lock = undefined;
  if (sentinel && !sentinel.released) void sentinel.release().catch(() => undefined);
}
