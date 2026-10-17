import { describe, expect, it } from 'vitest';
import { characterCells, terminalInk, terminalPreferences, TERMINAL_DEFAULTS } from './terminalGrid';

describe('Terminal presentation', () => {
  it('validates saved settings without reading or overwriting other appearance preferences', () => {
    for (const raw of [null, 'null', '{bad', '[]', '{"size":-20,"palette":"ultraviolet","glyphs":"html"}']) expect(terminalPreferences(raw)).toEqual(TERMINAL_DEFAULTS);
    expect(terminalPreferences('{"palette":"amber","glyphs":"ascii","size":16}')).toEqual({ palette:'amber', glyphs:'ascii', size:16 });
  });
  it('keeps transparent cells empty and encodes all eight Braille positions', () => {
    const data = new Uint8ClampedArray(2 * 4 * 4);
    expect(characterCells({data,width:2,height:4}, false).glyphs).toEqual([' ']);
    for (let i=0;i<8;i++) data.set([120,207,255,255],i*4);
    expect(characterCells({data,width:2,height:4}, false).glyphs).toEqual(['⣿']);
    expect(characterCells({data,width:2,height:4}, true).glyphs).toEqual(['#']);
    data.fill(0); data.set([255,255,255,255],7*4);
    expect(characterCells({data,width:2,height:4}, false).glyphs).toEqual(['⢀']);
  });
  it('keeps packet categories coloured even when their light is faint', () => {
    expect(terminalInk(3,6,9)).toBe(0); expect(terminalInk(8,20,90)).toBe(7);
    expect([terminalInk(77,231,196),terminalInk(255,209,90),terminalInk(255,117,181),terminalInk(120,207,255),terminalInk(167,139,250)]).toEqual([4,5,6,7,8]);
    expect([terminalInk(19,57,49),terminalInk(64,52,22),terminalInk(64,29,45),terminalInk(30,52,64),terminalInk(42,35,63)]).toEqual([4,5,6,7,8]);
    expect(terminalInk(255,255,255,0)).toBe(0);
  });
  it('keeps bright packet cores separate from faint trails in the same cell', () => {
    const data = new Uint8ClampedArray(2*4*4);
    for(let i=0;i<8;i++) data.set([40,50,60,255],i*4);
    data.set([255,117,181,255],0);
    const cell=characterCells({data,width:2,height:4},false);
    expect(cell.glyphs).toEqual(['⠁']); expect([...cell.colors]).toEqual([6]);
  });
  it('keeps a white-hot core and its coloured trail, with the original fade', () => {
    const data=new Uint8ClampedArray(32);
    for(let i=0;i<8;i++) data.set([77,231,196,180],i*4);
    data.set([255,255,255,255],28);
    const bright=characterCells({data,width:2,height:4},false);
    expect(bright.glyphs).toEqual(['⣿']); expect(bright.hot).toEqual(['⢀']);
    expect([...bright.colors]).toEqual([4]); expect([...bright.energy]).toEqual([255]);
    for(let i=3;i<32;i+=4) data[i]=Math.round(data[i]!*0.4);
    const faded=characterCells({data,width:2,height:4},false);
    expect(faded.glyphs).toEqual(bright.glyphs); expect(faded.colors).toEqual(bright.colors);
    expect(faded.energy[0]).toBeGreaterThan(0); expect(faded.energy[0]).toBeLessThan(bright.energy[0]!);
  });
});
