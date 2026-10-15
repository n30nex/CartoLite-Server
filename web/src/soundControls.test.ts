import { afterEach, expect, it } from 'vitest';
import { updateSoundChrome } from './soundControls';
import { populateSoundScenes } from './soundScenes';

afterEach(() => document.body.replaceChildren());
it('keeps Map and Netgraph sound labels, mute state, voice and volume in sync', () => {
  document.body.innerHTML = '<button id="sound-button"></button><div id="sound-panel"></div><span id="sound-state"></span><span id="sound-panel-state"></span><button id="sound-toggle"></button><input id="sound-volume"><output id="sound-volume-output"></output><select id="sound-scene"></select>';
  const voice = document.querySelector('select')!;
  populateSoundScenes(voice);
  const scene = voice.options[0]!.value as Parameters<typeof updateSoundChrome>[2];
  for (const [status, label] of [['on', 'On'], ['resume', 'Tap to Resume'], ['off', 'Off']] as const) {
    updateSoundChrome(status, 0.37, scene);
    expect(document.getElementById('sound-state')!.textContent).toBe(label);
    expect(document.getElementById('sound-panel-state')!.textContent).toBe(label);
    expect(document.getElementById('sound-button')!.getAttribute('aria-pressed')).toBe(String(status === 'on'));
    expect(document.getElementById('sound-panel')!.dataset.soundState).toBe(status);
    expect(document.querySelector('output')!.value).toBe('37%');
    expect(voice.value).toBe(scene);
  }
});
