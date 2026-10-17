import { describe, expect, it } from 'vitest';
import { characterCells, terminalInk, terminalPreferences, TERMINAL_DEFAULTS } from './terminalGrid';

describe('Terminal presentation', () => {
  it('validates saved settings without reading or overwriting other appearance preferences', () => {
    for (const raw of [null, 'null', '{bad', '[]', '{"size":-20,"palette":"ultraviolet","glyphs":"html"}']) expect(terminalPreferences(raw)).toEqual(TERMINAL_DEFAULTS);
    expect(terminalPreferences('{"palette":"amber","glyphs":"ascii","size":16}')).toEqual({ palette:'amber', glyphs:'ascii', size:16 });
  });
  it('keeps transparent cells empty and encodes all eight Braille positions', () => {
    const data = new Uint8ClampedArray(2 * 4 * 4);
    expect(characterCells({data,width:2,height:4}, false, false).glyphs).toEqual([' ']);
    for (let i=0;i<8;i++) data.set([120,207,255,255],i*4);
    expect(characterCells({data,width:2,height:4}, false, false).glyphs).toEqual(['⣿']);
    expect(characterCells({data,width:2,height:4}, true, false).glyphs).toEqual(['#']);
    data.fill(0); data.set([255,255,255,255],7*4);
    expect(characterCells({data,width:2,height:4}, false, false).glyphs).toEqual(['⢀']);
  });
  it('distinguishes water, land and the existing packet colours', () => {
    expect(terminalInk(3,6,9)).toBe(0); expect(terminalInk(8,20,90)).toBe(1);
    expect([terminalInk(77,231,196),terminalInk(255,209,90),terminalInk(255,117,181),terminalInk(120,207,255),terminalInk(167,139,250)]).toEqual([4,5,6,7,8]);
    expect(terminalInk(255,255,255,0)).toBe(0);
    const data = new Uint8ClampedArray(4*4*4);
    for(let y=0;y<4;y++) for(let x=0;x<4;x++) data.set(x<2 ? [8,20,90,255] : [3,6,9,255],(y*4+x)*4);
    expect([...characterCells({data,width:4,height:4},false,true).colors]).toEqual([1,2]);
  });
});
