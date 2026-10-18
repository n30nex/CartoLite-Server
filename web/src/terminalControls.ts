import { colourHSL, hslColour, normalizeTerminal, TERMINAL_COLOURS, TERMINAL_FONTS, TERMINAL_PRESETS, terminalPreset, type TerminalColour, type TerminalPreset, type TerminalProfile } from './terminalProfile';

/** One editor inside Display: no extra floating panel or live-feed owner. */
export function terminalControls(initial: TerminalProfile, change: (value: TerminalProfile) => void) {
  const settings = document.createElement('fieldset'); settings.className = 'terminal-settings';
  const fonts = Object.entries(TERMINAL_FONTS).map(([id,font])=>`<option value="${id}">${font.label}</option>`).join('');
  const slider = (key:string,label:string,min:number,max:number,step:number) => `<label class="terminal-slider">${label}<output data-value="${key}"></output><input type="range" data-terminal="${key}" aria-label="Terminal ${label.toLowerCase()}" min="${min}" max="${max}" step="${step}"></label>`;
  settings.innerHTML = `<legend>Terminal options</legend>
    <label>Preset<select data-terminal="palette" aria-label="Terminal palette">${Object.entries(TERMINAL_PRESETS).map(([id,p])=>`<option value="${id}">${p.label}</option>`).join('')}</select></label>
    <div class="terminal-preview" aria-label="Silent Terminal preview"><span>░░░ ≋≋≋</span><i>R ══════◆── C</i><b>CartoLite BBS</b></div>
    <label>Map drawing<select data-terminal="glyphs" aria-label="Terminal characters"><option value="braille">Braille dots</option><option value="ascii">ASCII</option><option value="blocks">Pixel blocks</option><option value="cell">Cel-shaded</option></select></label>
    <label>Live traffic<select data-terminal="traffic" aria-label="Terminal live traffic"><option value="characters">Glowing characters</option><option value="smooth">Smooth packets</option></select></label>
    <label>Map grid<select data-terminal="size" aria-label="Terminal cell size"><option value="10">Fine</option><option value="12">Standard</option><option value="16">Large</option></select></label>
    <details><summary>Map & traffic visibility</summary>
      ${slider('mapBrightness','Map brightness',.15,1.3,.05)}
      ${slider('labelBrightness','Place label brightness',.4,1.3,.05)}
      ${slider('liveGlow','Live glow',0,2,.1)}
      <p>Routes stay sharp above the map. Use Route style and Advanced route styling below for solid, dashed or dotted lines, width, opacity, packet size and trails. Glow respects Effects, Motion and Graphics settings.</p>
    </details>
    <details><summary>Typography</summary>
      <label>Map font<select data-terminal="font" aria-label="Terminal map font">${fonts}</select></label>
      ${slider('fontSize','Map font size',10,24,1)}${slider('weight','Font weight',400,700,100)}
      <label>Interface font<select data-terminal="uiFont" aria-label="Terminal interface font">${fonts}</select></label>
      ${slider('uiScale','Interface scale',.9,1.35,.05)}
      <p>Fonts affect labels, ASCII and controls. Braille and pixel map shapes keep their fixed grid. Missing characters use the system font. <a href="/fonts/terminal/README.txt" target="_blank" rel="noopener">Font credits</a></p>
    </details>
    <details class="terminal-colours"><summary>Element colours</summary>
      <label>Element<select aria-label="Terminal colour element">${[...new Set(Object.values(TERMINAL_COLOURS).map(v=>v[0]))].map(group=>`<optgroup label="${group}">${Object.entries(TERMINAL_COLOURS).filter(([,v])=>v[0]===group).map(([id,v])=>`<option value="${id}">${v[1]}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <div class="terminal-colour-inputs"><input type="color" aria-label="Terminal element colour"><input type="text" aria-label="Terminal colour hex" maxlength="7" spellcheck="false" pattern="#[0-9a-fA-F]{6}"></div>
      ${slider('hue','Hue',0,360,1)}${slider('saturation','Saturation',0,100,1)}${slider('lightness','Lightness',0,100,1)}
      <button type="button" data-reset-colour>Reset this colour</button>
      <p>Traffic colours are shared by routes, packets and their legend. This editor keeps readable colours so you can always undo a change.</p>
    </details>
    <button type="button" data-reset-terminal>Reset Terminal display</button>
    <p>Saved on this device; updates other Terminal tabs. Map, Netgraph, layers, sound and volume keep their saved settings. R repeater · C companion · H room · S sensor · @ selected.</p>`;
  let current = initial;
  const element = settings.querySelector<HTMLSelectElement>('[aria-label="Terminal colour element"]')!;
  const colour = settings.querySelector<HTMLInputElement>('[type=color]')!;
  const hex = settings.querySelector<HTMLInputElement>('[aria-label="Terminal colour hex"]')!;
  const channels = ['hue','saturation','lightness'] as const;
  let hsl: number[] = [0,0,0];
  function syncColour() {
    const key=element.value as TerminalColour;
    colour.value=hex.value=current.colours[key]; hex.setCustomValidity('');
    hsl=colourHSL(colour.value);
    channels.forEach((key,i)=>{
      settings.querySelector<HTMLInputElement>(`[data-terminal="${key}"]`)!.value=String(hsl[i]);
      settings.querySelector<HTMLOutputElement>(`[data-value="${key}"]`)!.value=String(hsl[i])+(i===0?'°':'%');
    });
  }
  function sync(profile: TerminalProfile) {
    current=profile;
    for(const input of settings.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[data-terminal]')) {
      const key=input.dataset.terminal as keyof TerminalProfile;
      if(key in current) input.value=String(current[key]);
    }
    for(const output of settings.querySelectorAll<HTMLOutputElement>('[data-value]')) {
      const key=output.dataset.value as keyof TerminalProfile;
      if(!(key in current))continue;
      const value=Number(current[key]);
      output.value=['mapBrightness','labelBrightness','liveGlow','uiScale'].includes(key)?`${Math.round(value*100)}%`:key==='fontSize'?`${value}px`:String(value);
    }
    const preview=settings.querySelector<HTMLElement>('.terminal-preview')!;
    for(const key of ['background','water','advert','labels'] as const)preview.style.setProperty(`--sample-${key}`,current.colours[key]);
    preview.style.fontFamily=TERMINAL_FONTS[current.font].family;
    syncColour();
  }
  function update(value: TerminalProfile, keepHsl=false) {
    const held=[...hsl]; current=normalizeTerminal(value); change(current); sync(current);
    // Keep hue/saturation adjustable through grey and black: RGB cannot retain them.
    if(keepHsl){hsl=held;channels.forEach((key,i)=>{settings.querySelector<HTMLInputElement>(`[data-terminal="${key}"]`)!.value=String(hsl[i]); settings.querySelector<HTMLOutputElement>(`[data-value="${key}"]`)!.value=String(hsl[i])+(i===0?'°':'%');});}
  }
  settings.addEventListener('input',event=>{
    const input=event.target;
    if(!(input instanceof HTMLInputElement))return;
    const key=input.dataset.terminal;
    if(channels.includes(key as typeof channels[number])) {
      hsl[channels.indexOf(key as typeof channels[number])]=Number(input.value);
      update({...current,colours:{...current.colours,[element.value]:hslColour(hsl[0]!,hsl[1]!,hsl[2]!)}},true);
    } else if(key) update({...current,[key]:Number(input.value)});
    else if(input===colour || input===hex) {
      if(/^#[0-9a-f]{6}$/i.test(input.value))update({...current,colours:{...current.colours,[element.value]:input.value}});
      else hex.setCustomValidity('Use six hexadecimal digits, for example #55ffff.');
    }
  });
  settings.addEventListener('change',event=>{
    const input=event.target;
    if(!(input instanceof HTMLSelectElement))return;
    if(input===element){syncColour();return;}
    const key=input.dataset.terminal!;
    update(key==='palette'?terminalPreset(input.value as TerminalPreset):{...current,[key]:key==='size'?Number(input.value):input.value});
  });
  settings.querySelector('[data-reset-colour]')!.addEventListener('click',()=>update({...current,colours:{...current.colours,[element.value]:terminalPreset(current.palette).colours[element.value as TerminalColour]}}));
  settings.querySelector('[data-reset-terminal]')!.addEventListener('click',()=>update(terminalPreset('ansi')));
  sync(initial);
  return {settings,sync};
}
