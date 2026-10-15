import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const request = vi.fn();
const coarse = vi.fn();
let screen: typeof import('./screenAwake');

function sentinel(): WakeLockSentinel {
  const lock = Object.assign(new EventTarget(), { released: false, release: vi.fn(async () => {
    lock.released = true; lock.dispatchEvent(new Event('release'));
  }) });
  return lock as unknown as WakeLockSentinel;
}

beforeEach(async () => {
  vi.resetModules(); request.mockReset().mockImplementation(async () => sentinel());
  document.body.innerHTML = '<main></main>'; delete document.documentElement.dataset.viewClass;
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  coarse.mockReset().mockReturnValue({ matches: true }); vi.stubGlobal('matchMedia', coarse);
  vi.stubGlobal('navigator', { userAgent: 'Synthetic browser', wakeLock: { request } });
  screen = await import('./screenAwake');
});
afterEach(() => { screen.releaseScreenAwake(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); delete document.documentElement.dataset.viewClass; });

it('shares pending requests and releases a late grant after disposal', async () => {
  let grant!: (lock: WakeLockSentinel) => void;
  request.mockImplementation(() => new Promise<WakeLockSentinel>(resolve => { grant = resolve; }));
  const pending = screen.requestScreenAwake();
  expect(screen.requestScreenAwake()).toBe(pending); expect(request).toHaveBeenCalledTimes(1);
  screen.releaseScreenAwake();
  const lock = sentinel(); grant(lock); await pending;
  expect(lock.release).toHaveBeenCalledTimes(1);
  expect(document.querySelector('main')!.dataset.screenAwake).toBe('false');
});

it('retries denial and browser release without acquiring duplicate live locks', async () => {
  request.mockRejectedValueOnce(new Error('not allowed yet'));
  await screen.requestScreenAwake(); expect(document.querySelector('main')!.dataset.screenAwake).toBe('retry');
  const lock = sentinel(); request.mockResolvedValueOnce(lock);
  await screen.requestScreenAwake(); await screen.requestScreenAwake();
  expect(request).toHaveBeenCalledTimes(2);
  await lock.release(); expect(document.querySelector('main')!.dataset.screenAwake).toBe('false');
  await screen.requestScreenAwake(); expect(request).toHaveBeenCalledTimes(3);
});

it('leaves screen ownership to Android and avoids unsupported or hidden requests', async () => {
  vi.stubGlobal('navigator', { userAgent: 'CartoLiteAndroid/1.1.0', wakeLock: { request } });
  await screen.requestScreenAwake(); expect(document.querySelector('main')!.dataset.screenAwake).toBe('native');
  vi.stubGlobal('navigator', { userAgent: 'Synthetic browser' });
  await screen.requestScreenAwake(); expect(document.querySelector('main')!.dataset.screenAwake).toBe('unsupported');
  vi.stubGlobal('navigator', { userAgent: 'Synthetic browser', wakeLock: { request } });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await screen.requestScreenAwake(); expect(request).not.toHaveBeenCalled();
});

it('preserves the map mobile-view override on a fine pointer', async () => {
  coarse.mockReturnValue({ matches: false });
  await screen.requestScreenAwake(); expect(request).not.toHaveBeenCalled();
  expect(document.querySelector('main')!.dataset.screenAwake).toBe('desktop');
  document.documentElement.dataset.viewClass = 'mobile';
  await screen.requestScreenAwake(); expect(request).toHaveBeenCalledTimes(1);
});
