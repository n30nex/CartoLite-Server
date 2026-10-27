import type { CartoView as View } from './viewNavigation';

export function closeHelpBackdrop(dialog: HTMLDialogElement, event: MouseEvent): void {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
}

/** Keep help next to the controls and use the browser's modal focus handling. */
export function addViewGuide(dialog: HTMLDialogElement, view: View): void {
  dialog.classList.add('view-help');
  const guide = document.createElement('section'); guide.className = 'view-guide';
  if (view === 'Pachinko') {
    guide.innerHTML = '<h2>Reading Pachinko</h2><p>Each dot is one newly observed, sanitized packet. Its color and lane identify Advert, Trace, Text, ACK, Control or Other. There are no route links in this view. Pegs and bucket collisions are an illustration, not geography or measured radio motion.</p><p>Drag to orbit, use two fingers or right-drag to pan, and pinch or scroll to zoom. Home resets the camera; Camera also offers Angle, Front and Above views. With the scene focused, Space pauses or resumes. Buckets fill and overflow into the drain. Drain empties them with motion; Clear starts empty immediately. Pause stops intake, motion and sound. Hidden or replayed traffic never fills the machine.</p><p>Click a dot to inspect its public category and confirmed observations. Sound is opt-in. Display controls shared appearance and quality; reduced motion starts paused. A bounded particle budget protects long sessions and omitted events are disclosed.</p>';
    dialog.append(guide); return;
  }
  if (view === 'Firehose') {
    guide.innerHTML = '<h2>Playing with Firehose</h2><p>Fresh packets fall from the spout into the box. Each bead represents a node in an observed packet; links preserve confirmed hops. Single beads are observer-only receptions. Positions, gravity and tumbling are an illustration, not geography or measured radio travel.</p><p>Drag in Tilt box mode to move the pile. Choose Orbit camera in Box to look around independently. Right-drag or two fingers pan; scroll or pinch zoom. Arrow keys tilt or orbit, Shift-arrows pan, +/− zoom, and Home resets the camera. Box offers Angle, Front and Above views without changing the pile. Space pauses or resumes when the scene is focused.</p><p>Pour turns the box upside down so its contents fall into the pit. Right the box in Box to collect again. Pause stops physics, new beads and sound; Resume uses fresh activity only. The box starts empty on every load. Hidden and paused intervals are never backfilled.</p><p>Find inspects public nodes; clicking a bead inspects its packet. Graphics are GPU-batched and physics runs in a worker. A bounded detail cap protects long sessions; omitted events are counted. Old beads leave only when their chain drains or you explicitly clear the pile. Sound is opt-in and collisions never trigger it.</p>';
    dialog.append(guide); return;
  }
  if (view === 'Chronoscope') {
    guide.innerHTML = '<h2>Reading Chronoscope</h2><p>The top plane is Now. Fresh packets follow their confirmed hops, descend, and stack into a session sculpture. Its height is illustrative; it is not radio altitude or signal strength.</p><p>Sculpture offers full 3D orbit, pan and zoom. Settled shapes remain until the bounded session cap replaces the oldest observations or you choose Clear. Fall time applies to new shapes. Flat keeps a top-down picture. Slice freezes the view and shows a four-second interval around the chosen moment. Freeze view keeps a bounded still snapshot while new events arrive silently. Return to live does not replay missed packets.</p><p>Observer-only pulses stay local. Separate confirmed segments remain separate, including gaps in a journey. Empty time means no activity was observed here, including while the tab was hidden or disconnected.</p><p>Drag to orbit Sculpture; right-drag or two fingers pan. Flat and Slice use drag to pan. Scroll or pinch zoom, arrow keys pan, Shift-arrows rotate/tilt, and Home fits the scene. Without working WebGL2, a labelled 2D time-window fallback stays available. Find selects nodes; Time lists recent packets for keyboard inspection. Freeze is available directly in the dock, or with Space when the scene is focused. On phones, optional Follow is in View. Escape or Back closes the current sheet. Sound is opt-in; M mutes outside text fields.</p>';
    dialog.append(guide); return;
  }
  guide.innerHTML = `<h2>Reading ${view}</h2>
    <p>${view === 'Labs' ? 'Live activity drives each scene. These are artistic interpretations, not radio coverage or measured signal paths.' : 'Standing routes are previously heard, confirmed connections. Moving packets are new activity. Hiding routes leaves live packets available.'}</p>
    <p>Observer-only activity means a receiver heard a packet without a confirmed public route. A local pulse does not imply a connection to another node.</p>
    ${view === 'Netgraph' ? '<p>Geographic groups stay recognizable, but spacing and 3D height are schematic. Region filters, focus and the route window limit which connections you see.</p>' : view !== 'Labs' ? '<p>Terrain and buildings provide context. Connection lines are not measured radio trajectories, antenna heights or coverage.</p>' : ''}
    <details open><summary>Controls &amp; shortcuts</summary><dl>
      ${view === 'Labs' ? '<div><dt>Scenes</dt><dd>Choose an experiment in the dock. Pause stops its motion and sound; Reset clears the scene. Exhibit rotates experiments every minute.</dd></div>' : `<div><dt>Explore</dt><dd>Drag to pan; scroll or pinch to zoom. Use Find to select a node and inspect its neighbours.${view === 'Netgraph' ? ' Focus the scene, then use arrow keys to pan, +/− to zoom or Home to fit. In 3D, Shift-arrows rotate and tilt.' : ''}</dd></div>
      <div><dt>Layers &amp; 3D</dt><dd>${view === 'Netgraph' ? 'Open Layers on phones or Display on desktop for saved region spacing and camera controls. Drag a region label to move the whole group. Use the Regions and Focus controls to limit the view; Show all restores it.' : 'Layers groups Traffic, Map details, Terrain and Appearance. 3D enables Topo and Buildings; either can then be switched off. Heatmap shows observed activity, not coverage.'}</dd></div>
      <div><dt>Follow</dt><dd>Hold each live subject for ten seconds, or use Hold, Next and Inspect. Manual navigation pauses movement. This area captures the boundary when selected.</dd></div>`}
      ${view === 'Terminal' ? '<div><dt>Terminal</dt><dd>Display contains the character size, ASCII/Braille and phosphor palette. The saved ordinary Map style remains separate. R repeater · C companion · H room · S sensor · @ selected.</dd></div>' : ''}
      ${view !== 'Terminal' ? '<div><dt>Interface palette</dt><dd>Display offers Aurora, Glacier, Ember and Violet, with dark or light panels. This choice follows you across views; packet colours keep their meaning. Terminal has its own colour studio.</dd></div>' : ''}
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
    dialog.innerHTML = `<header><h1 id="about-title">${view} help</h1><button type="button" aria-label="Close help">×</button></header>`;
    document.querySelector('main')!.append(dialog);
    const created = dialog;
    created.querySelector('button')!.addEventListener('click', () => created.close());
    created.addEventListener('click', event => closeHelpBackdrop(created, event));
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
  const brand = document.getElementById('about-button');
  brand?.addEventListener('click', () => { dialog!.scrollTop = 0; });
  let restore = false;
  button.addEventListener('click', () => {
    restore = true;
    for (const owner of document.querySelectorAll<HTMLButtonElement>('.controls button[aria-expanded="true"][aria-controls]')) owner.click();
    if (brand) brand.click(); else { dialog!.showModal(); dialog!.scrollTop = 0; }
  });
  dialog.addEventListener('close', () => {
    if (restore) document.getElementById(document.documentElement.dataset.mobileDock === 'true' ? 'view-button' : view === 'Netgraph' || view === 'Chronoscope' || view === 'Firehose' || view === 'Pachinko' ? 'display-button' : 'display-shortcut')?.focus({ preventScroll: true });
    restore = false;
  });
}
