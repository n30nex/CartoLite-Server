import { browserStorage } from './browserStorage';
import { DISPLAY_EVENT } from './displayPreferences';
import { relativeTime } from './nodeInspector';
import { DEFAULT_SCOPES, SCOPE_STORAGE, normalizeScopeSettings, scopesFromURL, scopesToURL, parseScopeSnapshot, scopeLabel, scopeWindowIndex, type ScopeSettings } from './scopes';
import type { LiveMap } from './map';
import type { NodeScopes, ScopeSnapshot } from './types';
import './scopes.css';

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text = ''): HTMLElementTagNameMap[K] {
  const el=doc.createElement(tag); el.textContent=text; return el;
}

export function mountScopeControls(view: LiveMap): void {
  if (document.documentElement.hasAttribute('data-terminal')) return;
  const parent=document.getElementById('map-detail-options');
  const legendParent=document.getElementById('legend');
  if (!parent || !legendParent) return;
  let settings={...DEFAULT_SCOPES};
  try { settings=normalizeScopeSettings(JSON.parse(browserStorage()?.getItem(SCOPE_STORAGE) ?? 'null')); } catch { /* Defaults remain usable with unavailable storage. */ }
  settings=scopesFromURL(new URL(location.href),settings);
  let snapshot: ScopeSnapshot | undefined;
  let pending: AbortController | undefined;
  let disposed=false;
  let failure=false;
  let timer: number | undefined;
  const panel=element(document,'section'); panel.className='scope-controls';
  panel.innerHTML='<button type="button" class="control-button scope-toggle" aria-pressed="false">â—‰ Repeater scopes</button><div class="scope-options" hidden><label>Evidence window<select aria-label="Scope evidence window"><option value="1">1h</option><option value="6">6h</option><option value="24">24h</option></select></label><label>Focus mode<select aria-label="Scope focus mode"><option value="highlight">Highlight</option><option value="isolate">Isolate repeaters</option></select></label><div class="scope-actions"><button type="button" class="scope-clear">Show all</button><button type="button" class="scope-share">Copy scope link</button></div><p class="layer-hint">Color shows the largest observed repeat-report count. Reported settings and heard traffic show membership, not forwarding. Connections and live packets keep their original meaning.</p><p class="scope-status" role="status"></p></div>';
  parent.append(panel);
  const toggle=panel.querySelector<HTMLButtonElement>('.scope-toggle')!;
  const options=panel.querySelector<HTMLElement>('.scope-options')!;
  const hours=panel.querySelector<HTMLSelectElement>('[aria-label="Scope evidence window"]')!;
  const mode=panel.querySelector<HTMLSelectElement>('[aria-label="Scope focus mode"]')!;
  const clear=panel.querySelector<HTMLButtonElement>('.scope-clear')!;
  const share=panel.querySelector<HTMLButtonElement>('.scope-share')!;
  const status=panel.querySelector<HTMLElement>('.scope-status')!;
  const legend=element(document,'details'); legend.className='region-legend scope-legend'; legend.id='scope-legend';
  const summary=element(document,'summary','Repeater scopes');
  const list=element(document,'div'); list.className='scope-legend-list glass';
  legend.append(summary,list); legendParent.append(legend);

  const renderLegend=(): void=>{
    if (disposed || !settings.enabled) return;
    const rows=view.scopeLegend();
    summary.textContent=settings.focus ? `Scope: ${scopeLabel(settings.focus)}` : `Scopes in view (${rows.length})`;
    // Rebuild only on settled camera/evidence changes, preserving the focused row.
    const active=list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.scope : undefined;
    list.replaceChildren();
    const note=element(document,'p',`${settings.hours}h Â· memberships / repeat reports`); note.className='scope-legend-note'; list.append(note);
    if (!rows.length) list.append(element(document,'p',snapshot ? 'No scope evidence for nodes in this view.' : 'Collecting scope evidenceâ€¦'));
    for (const row of rows) {
      const button=element(document,'button'); button.type='button'; button.dataset.scope=row.name;
      button.setAttribute('aria-pressed',String(settings.focus===row.name));
      const swatch=element(document,'i'); swatch.style.backgroundColor=row.color; swatch.setAttribute('aria-hidden','true');
      const name=element(document,'span',scopeLabel(row.name));
      const counts=element(document,'small',`${row.members.toLocaleString()} / ${row.repeats.toLocaleString()}`);
      button.title=`${row.members} member nodes; ${row.repeats} observed repeat reports. Select to ${settings.mode}.`;
      button.append(swatch,name,counts);
      button.addEventListener('click',()=>change({focus:settings.focus===row.name ? null : row.name})); list.append(button);
      if (active===row.name) button.focus({preventScroll:true});
    }
    list.append(element(document,'p','Neutral: no repeats, a tie, unresolved traffic or a name outside the 64-color palette. One node can belong to several rows.'));
  };

  const render=(): void=>{
    toggle.setAttribute('aria-pressed',String(settings.enabled)); options.hidden=!settings.enabled; legend.hidden=!settings.enabled;
    hours.value=String(settings.hours); mode.value=settings.mode; clear.disabled=!settings.focus;
    view.setScopes(snapshot,settings);
    const coverage=snapshot ? `Collected since ${new Date(snapshot.since).toLocaleString()}. ${snapshot.connected ? 'Connected' : 'Feed offline'}.` : 'Waiting for the first scope summary.';
    status.textContent=failure ? 'Scope evidence could not refresh. Showing the last available summary; the live feed continues.' : `${coverage} Windows include the current partial UTC hour. Restarts, feed gaps and limits can leave incomplete coverage.`;
    if (snapshot?.limitedAt) status.textContent+=' Some evidence exceeded the storage limit.';
    renderLegend();
  };

  const schedule=(): void=>{
    if (timer!==undefined) window.clearTimeout(timer);
    timer=undefined;
    if (!disposed && settings.enabled && !document.hidden) timer=window.setTimeout(()=>void refresh(),60_000);
  };
  const refresh=async(): Promise<void>=>{
    if (disposed || !settings.enabled || document.hidden || pending) return;
    const controller=new AbortController(); pending=controller;
    const timeout=window.setTimeout(()=>controller.abort(),10_000);
    try {
      const response=await fetch('/api/scopes',{signal:controller.signal,cache:'no-store',credentials:'same-origin'});
      if (!response.ok) throw new Error('Scope summary unavailable');
      const body=await response.text();
      if (body.length>16*1024*1024) throw new Error('Scope summary too large');
      const parsed=parseScopeSnapshot(JSON.parse(body));
      if (disposed || pending!==controller || !settings.enabled || document.hidden) return;
      snapshot=parsed; failure=false; render();
    } catch {
      if (!disposed && pending===controller && settings.enabled && !document.hidden) { failure=true; render(); }
    } finally {
      window.clearTimeout(timeout);
      if (pending===controller) pending=undefined;
      schedule();
    }
  };
  const change=(patch: Partial<ScopeSettings>, external=false): void=>{
    settings=normalizeScopeSettings({...settings,...patch});
    if (!external) {
      try { browserStorage()?.setItem(SCOPE_STORAGE,JSON.stringify(settings)); } catch { /* Private browsing may reject writes. */ }
      const url=scopesToURL(new URL(location.href),settings); history.pushState(history.state,'',url);
    }
    if (!settings.enabled) { pending?.abort(); pending=undefined; }
    render(); schedule(); if (settings.enabled && !snapshot) void refresh();
  };
  toggle.addEventListener('click',()=>change({enabled:!settings.enabled}));
  hours.addEventListener('change',()=>change({hours:Number(hours.value) as ScopeSettings['hours']}));
  mode.addEventListener('change',()=>change({mode:mode.value as ScopeSettings['mode']}));
  clear.addEventListener('click',()=>change({focus:null}));
  share.addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(scopesToURL(new URL(location.href),settings).href); status.textContent='Scope link copied.'; }
    catch { status.textContent='Copy the current page address to share these scope settings.'; }
  });
  const popstate=(): void=>change(scopesFromURL(new URL(location.href)),true);
  const storage=(event: StorageEvent): void=>{ if (event.key===SCOPE_STORAGE) { try { change(normalizeScopeSettings(JSON.parse(event.newValue ?? 'null')),true); } catch { /* Keep current view on malformed input. */ } } };
  const visibility=(): void=>{ if (document.hidden) { pending?.abort(); pending=undefined; schedule(); } else void refresh(); };
  const appearance=(): void=>{ renderLegend(); };
  const dispose=(): void=>{
    disposed=true; pending?.abort(); pending=undefined; if (timer!==undefined) window.clearTimeout(timer);
    document.removeEventListener('visibilitychange',visibility); window.removeEventListener('popstate',popstate); window.removeEventListener('storage',storage);
    window.removeEventListener(DISPLAY_EVENT,appearance); view.map.off('moveend',renderLegend); panel.remove(); legend.remove();
  };
  document.addEventListener('visibilitychange',visibility); window.addEventListener('popstate',popstate); window.addEventListener('storage',storage);
  window.addEventListener(DISPLAY_EVENT,appearance); view.map.on('moveend',renderLegend); view.map.once('idle',renderLegend); view.map.once('remove',dispose);
  render(); void refresh();
}

export function scopeInspector(doc: Document, node: NodeScopes | undefined, snapshot: ScopeSnapshot | undefined, settings: ScopeSettings): HTMLElement {
  const root=element(doc,'details'); root.className='scope-inspector'; root.open=true;
  root.append(element(doc,'summary',`Repeater scopes Â· ${settings.hours}h`));
  const index=scopeWindowIndex(settings.hours);
  const total=node?.scopes.reduce((sum,e)=>sum+e.repeats[index]!,0) ?? 0;
  const now=snapshot?.serverTime ?? Date.now();
  const age=(at?: number): string=>at ? relativeTime(at,now) : 'age unknown';
  const list=element(doc,'div'); list.className='scope-evidence'; root.append(list);
  if (!total) list.append(element(doc,'p','No observed repeats in this window. Missing evidence does not mean disabled.'));
  for (const e of node?.scopes ?? []) {
    const repeats=e.repeats[index]!; const heard=e.heard[index]!;
    if (!repeats && !heard) continue;
    const row=element(doc,'div'); row.className='scope-evidence-row';
    row.append(element(doc,'strong',scopeLabel(e.name)),element(doc,'span',`${repeats.toLocaleString()} repeat reports${total ? ` Â· ${Math.round(repeats/total*100)}%` : ''}${heard ? ` Â· receiver heard ${heard}` : ''}`));
    if (repeats) {
      const meter=element(doc,'meter'); meter.min=0; meter.max=Math.max(1,total); meter.value=repeats; meter.setAttribute('aria-label',`${scopeLabel(e.name)} share of repeat reports`); row.append(meter);
      row.append(element(doc,'small',`First ${age(e.first)}, latest ${age(e.last)} within retained 24h evidence.`));
    }
    list.append(row);
  }
  const sourceNames: Record<string,string>={'mqtt-self':'MQTT self report','mqtt-neighbor':'MQTT neighbour report','mqtt-status':'MQTT status report','meshmapper-reported':'MeshMapper observer report','meshmapper-uploaded':'MeshMapper uploaded report','meshmapper-default':'MeshMapper default'};
  for (const report of node?.reports ?? []) {
    const row=element(doc,'div'); row.className='scope-evidence-row'; row.append(element(doc,'strong',`${sourceNames[report.source]} Â· ${age(report.at)}`));
    if (report.list) row.append(element(doc,'span',report.entries.length ? report.entries.map(e=>`${scopeLabel(e.name)} (${age(e.at)})`).join(', ') : 'Explicitly reported empty list.'));
    if (report.defaultState) row.append(element(doc,'span',`Default: ${report.defaultState==='named' ? scopeLabel(report.default!) : report.defaultState==='none' ? 'none' : 'name unresolved'}.`));
    list.append(row);
  }
  if (!node?.reports.length) list.append(element(doc,'small','No explicit scope configuration report available.'));
  list.append(element(doc,'small','Reports can include multiple observers of the same transmission. Configuration and receiver-heard evidence do not vote on node color.'));
  return root;
}
