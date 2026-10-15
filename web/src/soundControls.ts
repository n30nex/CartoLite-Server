import type { SoundScene, SoundStatus } from './audio';
import { SOUND_SCENES, syncSoundScene } from './soundScenes';
import { required } from './dom';

export function updateSoundChrome(status: SoundStatus, volume: number, scene: SoundScene): void {
  const soundButton = required('sound-button');
  const soundPanel = required('sound-panel');
  const soundState = required('sound-state');
  const soundPanelState = required('sound-panel-state');
  const soundToggle = required('sound-toggle');
  const soundVolume = required<HTMLInputElement>('sound-volume');
  const soundVolumeOutput = required<HTMLOutputElement>('sound-volume-output');
  const soundScene = required<HTMLSelectElement>('sound-scene');
  const label = status === 'on' ? 'On' : status === 'resume' ? 'Tap to Resume' : 'Off';
  const percent = Math.round(volume * 100);
  const sceneLabel = SOUND_SCENES[scene].label;
  soundState.textContent = label;
  soundPanelState.textContent = label;
  soundButton.dataset.soundState = status;
  soundPanel.dataset.soundState = status;
  soundButton.setAttribute('aria-pressed', String(status === 'on'));
  soundButton.classList.toggle('selected', status === 'on');
  soundButton.title = status === 'on'
    ? `Sound on — ${sceneLabel} · ${percent}% · visible live hops only`
    : status === 'resume'
      ? `Tap to resume ${sceneLabel} — ${percent}%`
      : `Sound off — ${sceneLabel} · ${percent}%`;
  soundToggle.textContent = status === 'on' ? 'Turn sound off' : status === 'resume' ? 'Tap to Resume' : 'Turn sound on';
  soundVolume.value = String(percent);
  soundVolumeOutput.value = `${percent}%`;
  syncSoundScene(soundScene, scene);
}
