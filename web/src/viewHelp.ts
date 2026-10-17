type View = 'Map' | 'Netgraph' | 'Terminal' | 'Labs';

/** Keep help next to the controls and use the browser's modal focus handling. */
export function addViewGuide(dialog: HTMLDialogElement, view: View): void {
  dialog.classList.add('view-help');
  const guide = document.createElement('section'); guide.className = 'view-guide';
  guide.innerHTML = `<h2>Reading ${view}</h2>
    <p>${view === 'Labs' ? 'Live activity drives each scene. These are artistic interpretations, not radio coverage or measured signal paths.' : 'Standing routes are previously heard, confirmed connections. Moving packets are new activity. Hiding routes leaves live packets available.'}</p>
    <p>Observer-only activity means a receiver heard a packet without a confirmed public route. A local pulse does not imply a connection to another node.</p>
    ${view === 'Netgraph' ? '<p>Geographic groups stay recognizable, but spacing and 3D height are schematic. Region filters, focus and the route window limit which connections you see.</p>' : view !== 'Labs' ? '<p>Terrain and buildings provide context. Connection lines are not measured radio trajectories, antenna heights or coverage.</p>' : ''}
    <details open><summary>Controls &amp; shortcuts</summary><dl>
      ${view === 'Labs' ? '<div><dt>Scenes</dt><dd>Choose an experiment in the dock. Pause stops its motion and sound; Reset clears the scene. Exhibit rotates experiments every minute.</dd></div>' : `<div><dt>Explore</dt><dd>Drag to pan; scroll or pinch to zoom. Use Find to select a node and inspect its neighbours.${view === 'Netgraph' ? ' Focus the scene, then use arrow keys to pan, +/− to zoom or Home to fit. In 3D, Shift-arrows rotate and tilt.' : ''}</dd></div>
      <div><dt>Layers &amp; 3D</dt><dd>${view === 'Netgraph' ? 'Open Layers on phones or Display on desktop for saved region spacing and camera controls. Drag a region label to move the whole group. Use the Regions and Focus controls to limit the view; Show all restores it.' : 'Layers groups Traffic, Map details, Terrain and Appearance. 3D enables Topo and Buildings; either can then be switched off. Heatmap shows observed activity, not coverage.'}</dd></div>
      <div><dt>Follow</dt><dd>Hold each live subject for ten seconds, or use Hold, Next and Inspect. Manual navigation pauses movement. This area captures the boundary when selected.</dd></div>`}
      ${view === 'Terminal' ? '<div><dt>Terminal</dt><dd>Display contains the character size, ASCII/Braille and phosphor palette. The saved ordinary Map style remains separate. R repeater · C companion · H room · S sensor · @ selected.</dd></div>' : ''}
      <div><dt>Sound</dt><dd>Sound is opt-in. Browse voices silently, then choose Preview voice to hear a sample. M mutes immediately outside text fields; it never enables sound.</dd></div>
      <div><dt>Keyboard &amp; Back</dt><dd>Tab through controls and use Enter or Space to activate them. Escape or Back closes the current sheet. Display offers larger text and reduced motion.</dd></div>
    </dl></details>`;
  dialog.append(guide);
}

export function mountNetworkHelp(view: Exclude<View, 'Labs'>): void {
  let dialog = document.getElementById('about-dialog') as HTMLDialogElement | null;
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id = 'about-dialog'; dialog.className = 'glass';
    dialog.setAttribute('aria-labelledby', 'about-title');
    dialog.innerHTML = '<header><h1 id="about-title">Netgraph help</h1><button type="button" aria-label="Close help">×</button></header>';
    document.querySelector('main')!.append(dialog);
    const created = dialog;
    created.querySelector('button')!.addEventListener('click', () => created.close());
    created.addEventListener('click', event => { if (event.target === created) created.close(); });
  }
  if (!dialog.querySelector('header')) {
    const header = document.createElement('header');
    header.append(dialog.querySelector('h1')!, dialog.querySelector('button')!); dialog.prepend(header);
  }
  const about = dialog.querySelector('dl');
  const details = document.createElement('details');
  if (about) { details.innerHTML = '<summary>About CartoLite</summary>'; details.append(about); }
  addViewGuide(dialog, view);
  if (about) dialog.append(details);
  const button = document.createElement('button'); button.id = 'help-button'; button.type = 'button';
  button.className = 'control-button view-help-button'; button.textContent = '? Help & controls';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', dialog.id);
  document.querySelector('.display-settings')!.prepend(button);
  let restore: HTMLElement | null = null;
  button.addEventListener('click', () => {
    restore = document.getElementById(document.documentElement.dataset.mobileDock === 'true' ? 'view-button' : view === 'Netgraph' ? 'display-button' : 'display-shortcut');
    for (const owner of document.querySelectorAll<HTMLButtonElement>('.controls button[aria-expanded="true"][aria-controls]')) owner.click();
    const brand = document.getElementById('about-button');
    if (brand) brand.click(); else dialog!.showModal();
  });
  dialog.addEventListener('close', () => { restore?.focus({ preventScroll: true }); restore = null; });
}
