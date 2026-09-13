import { describe, expect, it } from 'vitest';
import { safeMapError } from './mapNotice';

describe('public map diagnostics', () => {
  it('keeps useful errors while removing provider URLs and credentials', () => {
    const result = safeMapError('Tile failed (403): https://tiles.example/tile?key=browser-secret key=other-secret Bearer abc.def.ghi');
    expect(result).toContain('Tile failed (403)');
    expect(result).not.toContain('browser-secret');
    expect(result).not.toContain('other-secret');
    expect(result).not.toContain('abc.def.ghi');
    expect(result).not.toContain('tiles.example');
  });
  it('redacts credentials in quoted diagnostic fields', () => {
    expect(safeMapError('{"access_token":"short-secret"}')).not.toContain('short-secret');
    expect(safeMapError('Authorization: Bearer short-secret')).not.toContain('short-secret');
    expect(safeMapError('x'.repeat(300))).toHaveLength(21);
  });
});
