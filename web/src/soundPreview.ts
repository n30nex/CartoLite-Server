import type { RouteSonifier } from './audio';
export function mountSoundPreview(sonifier: RouteSonifier, parent: HTMLElement): void {
  const controls = document.createElement('div'); controls.className = 'sound-preview-actions';
  const preview = document.createElement('button'); preview.type='button'; preview.textContent='Preview voice'; preview.className='control-button';
  preview.disabled=!sonifier.supported();
  preview.addEventListener('click', async () => { preview.disabled=true; try { await sonifier.preview(); } catch { preview.textContent='Preview unavailable'; } finally { window.setTimeout(()=>{preview.disabled=!sonifier.supported();},700); } });
  const mute=document.createElement('button'); mute.type='button';mute.textContent='Mute';mute.className='control-button';
  mute.addEventListener('click',()=>{void sonifier.setEnabled(false);});
  controls.append(preview,mute);parent.append(controls);
}
