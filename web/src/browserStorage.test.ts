import { afterEach, expect, it, vi } from 'vitest';
import { browserStorage } from './browserStorage';

afterEach(() => vi.restoreAllMocks());

it('keeps preferences usable when the browser rejects access to storage itself', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  const storage = browserStorage();
  storage.clear();
  storage.setItem('display', 'night');
  expect(browserStorage().getItem('display')).toBe('night');
  expect(storage.length).toBe(1);
  expect(storage.key(0)).toBe('display');
  storage.removeItem('display');
  expect(storage.getItem('display')).toBeNull();
});
