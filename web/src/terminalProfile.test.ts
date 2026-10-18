import { afterEach, describe, expect, it } from 'vitest';
import { colourHSL, hslColour, loadTerminal, normalizeTerminal, TERMINAL_COLOURS, TERMINAL_KEY, TERMINAL_PRESETS, terminalPreset } from './terminalProfile';
import { displayColor, displayColorRevision, packetPalette, recolorPaint, setDisplayColors } from './displayPreferences';
import { characterCells } from './terminalGrid';

afterEach(()=>setDisplayColors());
describe('Terminal profiles',()=>{
  it('migrates the three legacy choices without touching shared settings',()=>{
    const store={getItem:(key:string)=>key===TERMINAL_KEY?null:'{"palette":"amber","glyphs":"ascii","size":16}'};
    expect(loadTerminal(store)).toMatchObject({palette:'amber',glyphs:'ascii',size:16,fontSize:16});
    expect(loadTerminal({getItem:()=>{throw Error('blocked');}})).toEqual(terminalPreset('ansi'));
  });
  it('bounds arbitrary saved data and rejects CSS, fonts and unknown keys',()=>{
    for(const raw of [null,[],{},false])expect(normalizeTerminal(raw)).toEqual(terminalPreset('ansi'));
    const value=normalizeTerminal({palette:'__proto__',font:'url(https://evil)',uiFont:'bogus',glyphs:'html',weight:Infinity,fontSize:999,mapBrightness:-3,liveGlow:20,colours:{water:'red;display:none',ink:'#AaCcFF',unknown:'#ffffff'}});
    expect(value).toMatchObject({palette:'ansi',font:'mono',uiFont:'mono',glyphs:'braille',weight:600,fontSize:24,mapBrightness:.15,liveGlow:2});
    expect(value.colours.ink).toBe('#aaccff');expect(value.colours.water).toBe('#213c78');
    expect(Object.keys(value.colours)).toEqual(Object.keys(TERMINAL_COLOURS));
  });
  it('round-trips every preset and edits without sharing mutable defaults',()=>{
    for(const preset of Object.keys(TERMINAL_PRESETS) as (keyof typeof TERMINAL_PRESETS)[]){
      const profile=terminalPreset(preset);
      expect(normalizeTerminal(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
      profile.colours.water='#ffffff';expect(terminalPreset(preset).colours.water).not.toBe('#ffffff');
    }
    expect(hslColour(...colourHSL('#ff0000'))).toBe('#ff0000');
    expect(hslColour(180,100,50)).toBe('#00ffff');
    expect(colourHSL('#000000')).toEqual([0,0,0]);
  });
  it('keeps arbitrary network colours and legend consistent, then removes the override',()=>{
    const old=displayColorRevision();setDisplayColors({'#4de7c4':'#5329ff','#ffffff':'#ff5500','bad':'url(no)'});
    expect(displayColorRevision()).toBe(old+1);
    expect(displayColor('#4de7c4',false)).toBe('#5329ff');expect(packetPalette(false).Advert).toBe('#5329ff');
    expect(displayColor('rgba(77,231,196,0.4)',false)).toBe('rgba(83, 41, 255, 0.4)');
    expect(recolorPaint(['get','color'],false)).toEqual(['match',['get','color'],'#4de7c4','#5329ff','#ffffff','#ff5500',['get','color']]);
    setDisplayColors();expect(displayColor('#4de7c4',false)).toBe('#4de7c4');
  });
  it('preserves glyph packet colours even when users choose unconventional hues',()=>{
    const data=new Uint8ClampedArray(32);data.set([83,41,255,220],0);data.set([255,85,0,255],28);
    const cell=characterCells({data,width:2,height:4},false,{2:'#ff5500',4:'#5329ff',6:'#00ff00'});
    expect([...cell.colors]).toEqual([4]);expect(cell.hot).toEqual(['⢀']);
  });
});
