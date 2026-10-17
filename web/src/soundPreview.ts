import type { RouteSonifier } from './audio';
import { SOUND_SCENE_IDS, syncSoundScene } from './soundScenes';
export function mountSoundPreview(sonifier: RouteSonifier, parent: HTMLElement): void {
  const controls = document.createElement('div'); controls.className = 'sound-preview-actions';
  const scene = document.getElementById('sound-scene') as HTMLSelectElement;
  if (!scene.getAttribute('aria-describedby')) {
    const description = document.createElement('p'); description.id = 'sound-description'; description.className = 'sound-description';
    scene.setAttribute('aria-describedby', description.id); scene.closest('label')!.after(description);
    syncSoundScene(scene, sonifier.getScene());
  }
  for (const [step, label] of [[-1, 'Previous voice'], [1, 'Next voice']] as const) {
    const browse = document.createElement('button'); browse.type = 'button'; browse.className = 'control-button';
    browse.textContent = step < 0 ? '← Previous' : 'Next →'; browse.setAttribute('aria-label', label); browse.disabled = !sonifier.supported();
    browse.addEventListener('click', () => {
      sonifier.setScene(SOUND_SCENE_IDS[(SOUND_SCENE_IDS.indexOf(sonifier.getScene()) + step + SOUND_SCENE_IDS.length) % SOUND_SCENE_IDS.length]!);
    });
    controls.append(browse);
  }
  const preview = document.createElement('button'); preview.type='button'; preview.textContent='Preview voice'; preview.className='control-button';
  preview.disabled=!sonifier.supported();
  preview.addEventListener('click', async () => { preview.disabled=true; try { await sonifier.preview(); } catch { preview.textContent='Preview unavailable'; } finally { window.setTimeout(()=>{preview.disabled=!sonifier.supported();},700); } });
  const mute=document.createElement('button'); mute.type='button';mute.textContent='Mute';mute.className='control-button quick-mute';
  mute.title = 'Mute immediately (M)'; mute.setAttribute('aria-keyshortcuts', 'M'); mute.disabled = !sonifier.supported();
  mute.addEventListener('click',()=>{void sonifier.setEnabled(false);});
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'm'
      || (target instanceof Element && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))) return;
    event.preventDefault(); void sonifier.setEnabled(false);
  });
  controls.append(preview); parent.append(controls);
  const header = parent.querySelector('header');
  if (header) header.insertBefore(mute, header.querySelector('.panel-close')); else parent.prepend(mute);
}
