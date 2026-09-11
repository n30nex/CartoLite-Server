import { describe, expect, it } from 'vitest';
import { loadSoundPreference, saveSoundPreference, SOUND_STORAGE_KEY } from './audio';
import { isSoundScene, populateSoundScenes, SOUND_SCENES, SOUND_SCENE_IDS, syncSoundScene } from './soundScenes';

describe('sound voice catalog', () => {
  it('offers 30 distinct voices in five groups using the same catalog as playback', () => {
    const select = document.createElement('select');
    populateSoundScenes(select);
    expect(select.options).toHaveLength(30);
    expect(select.querySelectorAll('optgroup')).toHaveLength(5);
    expect([...select.options].map((option) => option.value)).toEqual(SOUND_SCENE_IDS);
    expect(new Set([...select.options].map((option) => option.label)).size).toBe(30);
    const signatures = SOUND_SCENE_IDS.map((id) => {
      const voice = Object.fromEntries(Object.entries(SOUND_SCENES[id])
        .filter(([key]) => !['label', 'group', 'description'].includes(key)));
      return JSON.stringify(voice);
    });
    expect(new Set(signatures).size).toBe(30);
  });

  it('preserves every voice in existing preferences without enabling sound', () => {
    for (const scene of SOUND_SCENE_IDS) {
      localStorage.clear();
      saveSoundPreference(localStorage, { enabled: false, volume: 0.42, scene });
      expect(loadSoundPreference(localStorage)).toEqual({ enabled: false, volume: 0.42, scene });
      expect(Object.keys(JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY)!)).sort()).toEqual(['enabled', 'scene', 'volume']);
    }
  });

  it('rejects prototype keys and unknown saved voice identifiers', () => {
    for (const value of ['constructor', 'toString', '__proto__', 'unknown', null, 3, {}]) {
      expect(isSoundScene(value)).toBe(false);
    }
    expect(isSoundScene('electric-piano')).toBe(true);
  });

  it('updates the selected name and accessible description after restoring a saved voice', () => {
    const select = document.createElement('select');
    const description = document.createElement('p');
    description.id = 'sound-description';
    select.setAttribute('aria-describedby', description.id);
    document.body.append(select, description);
    try {
      populateSoundScenes(select);
      syncSoundScene(select, 'electric-piano');
      expect(select.selectedOptions[0]?.label).toBe('Electric Piano');
      expect(select.title).toBe(SOUND_SCENES['electric-piano'].description);
      expect(description.textContent).toBe(select.title);
      expect(select.getAttribute('aria-description')).toBe(select.title);
      populateSoundScenes(select);
      expect(select.options).toHaveLength(30);
    } finally {
      select.remove();
      description.remove();
    }
  });
});
