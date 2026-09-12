import { populateSoundScenes, syncSoundScene, SOUND_SCENES } from '../soundScenes';
import { initializeDisplay } from '../displayPreferences';
import { mountNetgraphDisplay } from '../displayControls';
import './styles.css';
import { fetchState, LiveFeed } from '../api';
import { RouteSonifier, type SoundScene, type SoundStatus } from '../audio';
import { buildNodeInspectorModel, createNodeInspectorContent, relativeTime, roleLabel, searchNodes } from '../nodeInspector';
import { activityLabel, LiveStore } from '../state';
import { wireNodeSearch } from '../nodeSearch';
import { normalizePacketKind } from '../trafficVisuals';
import type { NodeV2, PacketView } from '../types';
import { type NetgraphWindow } from './layout';
import { NetgraphRenderer } from './renderer';

const SETTINGS_KEY = 'cartolite-server:netgraph:v1';
initializeDisplay();
mountNetgraphDisplay();
const app = required<HTMLElement>('netgraph-app');
const stage = required<HTMLElement>('netgraph-stage');
const graphCanvas = required<HTMLCanvasElement>('graph-canvas');
const packetCanvas = required<HTMLCanvasElement>('packet-canvas');
const statusElement = required<HTMLElement>('status');
const statusText = required<HTMLElement>('status-text');
const trafficMeter = required<HTMLElement>('traffic-meter');
const topbar = required<HTMLElement>('topbar');
const findControl = required<HTMLElement>('find-control');
const findButton = required<HTMLButtonElement>('find-button');
const findPanel = required<HTMLElement>('find-panel');
const nodeSearch = required<HTMLInputElement>('node-search');
const nodeSearchResults = required<HTMLElement>('node-search-results');
const routeWindow = required<HTMLSelectElement>('route-window');
const soundControl = required<HTMLElement>('sound-control');
const soundButton = required<HTMLButtonElement>('sound-button');
const soundPanel = required<HTMLElement>('sound-panel');
const soundState = required<HTMLElement>('sound-state');
const soundPanelState = required<HTMLElement>('sound-panel-state');
const soundToggle = required<HTMLButtonElement>('sound-toggle');
const soundScene = required<HTMLSelectElement>('sound-scene');
populateSoundScenes(soundScene);
const soundVolume = required<HTMLInputElement>('sound-volume');
const soundVolumeOutput = required<HTMLOutputElement>('sound-volume-output');
const soundActivity = required<HTMLElement>('sound-activity');
const resetButton = required<HTMLButtonElement>('reset-button');
const zoomInButton = required<HTMLButtonElement>('zoom-in-button');
const zoomOutButton = required<HTMLButtonElement>('zoom-out-button');
const connectedCount = required<HTMLElement>('connected-count');
const routeCount = required<HTMLElement>('route-count');
const areaCount = required<HTMLElement>('area-count');
const componentCount = required<HTMLElement>('component-count');
const tooltip = required<HTMLElement>('tooltip');
const inspectorSheet = required<HTMLElement>('node-inspector-sheet');
const emptyState = required<HTMLElement>('empty-state');
const fatal = required<HTMLElement>('fatal');

let soundPulseTimer: number | undefined;
let trafficTimer: number | undefined;
let recentTraffic: number[] = [];
let scheduledNotes = 0;
let wakeLock: ScreenWakeLockSentinel | undefined;
let wakeLockRequest: Promise<void> | undefined;
let screenAwakeWanted = true;

interface ScreenWakeLockSentinel extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

interface ScreenWakeLockAPI {
  request(type: 'screen'): Promise<ScreenWakeLockSentinel>;
}

const settings = loadSettings();
routeWindow.value = settings.routeWindow;

document.addEventListener('pointerdown', (event) => {
  void requestScreenAwake();
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!soundControl.contains(target)) closeSoundPanel();
  if (!findControl.contains(target)) closeFindPanel();
});

void requestScreenAwake();
void start();

async function start(): Promise<void> {
  let renderer: NetgraphRenderer | undefined;
  let sonifier: RouteSonifier | undefined;
  let store: LiveStore | undefined;
  let feed: LiveFeed | undefined;
  let selectedNodeID: string | null = null;
  let streamConnected = false;
  let minuteTimer: number | undefined;
  let selectNode: (nodeID: string | null, focus?: boolean) => void = () => undefined;

  try {
    const graph = new NetgraphRenderer(stage, graphCanvas, packetCanvas, {
      onNodeSelect(nodeID) {
        selectNode(nodeID);
      },
      onNodeHover(node, point) {
        renderTooltip(node, point);
      },
    });
    renderer = graph;
    const routeSonifier = new RouteSonifier(graph, stage);
    sonifier = routeSonifier;
    configureSound(routeSonifier);
    graph.setRouteWindow(settings.routeWindow);

    const initial = await fetchState();
    const liveStore = new LiveStore(initial);
    store = liveStore;

    const renderInspector = (): void => {
      const started = performance.now();
      inspectorSheet.replaceChildren();
      if (!selectedNodeID) {
        inspectorSheet.hidden = true;
        stage.dataset.inspectorApplyMs = (performance.now() - started).toFixed(1);
        return;
      }
      const model = buildNodeInspectorModel(
        selectedNodeID,
        graph.getNodes(),
        graph.adjacentRoutes(selectedNodeID),
        Date.now(),
        graph.getRouteWindowMS(),
      );
      if (!model) {
        selectedNodeID = null;
        graph.setSelectedNode(null);
        inspectorSheet.hidden = true;
        return;
      }
      inspectorSheet.append(createNodeInspectorContent(document, model, {
        mobile: true,
        onClose: () => selectNode(null),
        onSelectNeighbor: (nodeID) => selectNode(nodeID, true),
      }));
      inspectorSheet.hidden = false;
      stage.dataset.inspectorApplyMs = (performance.now() - started).toFixed(1);
    };

    selectNode = (nodeID: string | null, focus = false): void => {
      const started = performance.now();
      selectedNodeID = nodeID;
      graph.setSelectedNode(nodeID);
      renderInspector();
      if (nodeID && focus) graph.focusNode(nodeID);
      stage.dataset.nodeSelectionApplyMs = (performance.now() - started).toFixed(1);
    };

    const updateStatus = (): void => {
      const display = activityLabel(liveStore.snapshot, streamConnected);
      if (statusElement.dataset.state !== display.state) statusElement.dataset.state = display.state;
      if (statusText.textContent !== display.text) statusText.textContent = display.text;
      const title = `${liveStore.snapshot.nodes.length.toLocaleString()} nodes · ${liveStore.snapshot.routes.length.toLocaleString()} routes`;
      if (statusElement.title !== title) statusElement.title = title;
    };

    const updateSummary = (): void => {
      connectedCount.textContent = Number(stage.dataset.connectedNodes ?? 0).toLocaleString();
      routeCount.textContent = Number(stage.dataset.visibleRoutes ?? 0).toLocaleString();
      areaCount.textContent = Number(stage.dataset.areas ?? 0).toLocaleString();
      componentCount.textContent = Number(stage.dataset.components ?? 0).toLocaleString();
      emptyState.hidden = Number(stage.dataset.visibleRoutes ?? 0) > 0;
    };

    liveStore.subscribe((state, changes) => {
      graph.render(state, changes);
      if (changes?.reset || changes?.routes?.length) updateSummary();
      updateStatus();
      if (!selectedNodeID || !changes) return;
      const selectedNodeChanged = changes.nodes?.some((node) => node.id === selectedNodeID) ?? false;
      const adjacentRouteChanged = changes.routes?.some((route) => route.fromId === selectedNodeID || route.toId === selectedNodeID) ?? false;
      if (changes.reset || selectedNodeChanged || adjacentRouteChanged) renderInspector();
    });
    app.dataset.loading = 'false';

    const liveFeed = new LiveFeed(initial, {
      onConnection(connected) {
        streamConnected = connected;
        updateStatus();
      },
      onNode(event) {
        liveStore.upsertNode(event.node, event.seq);
      },
      onPacket(event) {
        const packet = liveStore.applyPacket(event);
        if (!packet) return;
        graph.preparePacket(packet);
        graph.addPacket(packet);
        const noteCount = routeSonifier.play(packet);
        if (noteCount > 0) pulseSound(noteCount);
        pulseTraffic(packet);
      },
      onStatus(event) {
        liveStore.updateStatus(event.status, event.seq);
      },
      async recover() {
        const snapshot = await fetchState();
        liveStore.replace(snapshot);
        return snapshot;
      },
      onError(error) {
        console.warn('Netgraph live stream recovery:', error.message);
      },
    });
    feed = liveFeed;
    liveFeed.start();

    routeWindow.addEventListener('change', () => {
      const window = routeWindow.value as NetgraphWindow;
      graph.setRouteWindow(window);
      saveSettings(window);
      updateSummary();
      renderInspector();
    });
    resetButton.addEventListener('click', () => graph.home());
    zoomInButton.addEventListener('click', () => graph.zoomBy(1.5));
    zoomOutButton.addEventListener('click', () => graph.zoomBy(1 / 1.5));
    wireSearch(graph, (nodeID) => selectNode(nodeID, true));

    let wasHidden = document.hidden;
    document.addEventListener('visibilitychange', () => {
      graph.setPaused(document.hidden);
      routeSonifier.setPaused(document.hidden);
      if (document.hidden) {
        wasHidden = true;
        releaseScreenAwake();
        return;
      }
      void requestScreenAwake();
      graph.refreshRouteWindow();
      updateSummary();
      if (selectedNodeID) renderInspector();
      if (wasHidden) {
        wasHidden = false;
        void liveFeed.resume();
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      void requestScreenAwake();
      void liveFeed.resume();
    });
    window.addEventListener('online', () => {
      void requestScreenAwake();
      void liveFeed.resume();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeSoundPanel();
      closeFindPanel();
      if (selectedNodeID) selectNode(null);
    });
    minuteTimer = window.setInterval(() => {
      graph.refreshRouteWindow();
      updateSummary();
      if (selectedNodeID) renderInspector();
    }, 60_000);
    window.addEventListener('beforeunload', () => {
      if (minuteTimer !== undefined) window.clearInterval(minuteTimer);
      if (trafficTimer !== undefined) window.clearTimeout(trafficTimer);
      if (soundPulseTimer !== undefined) window.clearTimeout(soundPulseTimer);
      liveFeed.stop();
      liveStore.destroy();
      routeSonifier.destroy();
      graph.destroy();
      releaseScreenAwake();
    }, { once: true });
  } catch (error) {
    if (minuteTimer !== undefined) window.clearInterval(minuteTimer);
    feed?.stop();
    store?.destroy();
    sonifier?.destroy();
    renderer?.destroy();
    releaseScreenAwake();
    statusElement.dataset.state = 'offline';
    statusText.textContent = 'Unavailable';
    console.warn('Netgraph could not start:', error);
    fatal.hidden = false;
  }
}

function wireSearch(renderer: NetgraphRenderer, select: (nodeID: string) => void): void {
  const renderResults = wireNodeSearch({
    input: nodeSearch,
    results: nodeSearchResults,
    metrics: stage,
    search: (query) => searchNodes(renderer.connectedNodes(), query),
    select(nodeID) {
      select(nodeID);
      closeFindPanel();
    },
    dismiss() {
      closeFindPanel();
      findButton.focus();
    },
  });

  findButton.addEventListener('click', () => {
    const opening = findPanel.hidden;
    findPanel.hidden = !opening;
    findButton.setAttribute('aria-expanded', String(opening));
    if (!opening) return;
    closeSoundPanel();
    renderResults();
    requestAnimationFrame(() => nodeSearch.focus());
  });
}

function configureSound(sonifier: RouteSonifier): void {
  soundVolume.value = String(Math.round(sonifier.getVolume() * 100));
  soundVolumeOutput.value = `${soundVolume.value}%`;
  syncSoundScene(soundScene, sonifier.getScene());
  sonifier.setStatusListener((status) => updateSound(status, sonifier.getVolume(), sonifier.getScene()));
  if (!sonifier.supported()) {
    soundButton.disabled = true;
    soundToggle.disabled = true;
    soundScene.disabled = true;
    soundVolume.disabled = true;
    soundState.textContent = 'Unavailable';
    soundPanelState.textContent = 'Unavailable';
  }
  soundButton.addEventListener('click', () => {
    const opening = soundPanel.hidden;
    soundPanel.hidden = !opening;
    soundButton.setAttribute('aria-expanded', String(opening));
    if (opening) closeFindPanel();
  });
  soundToggle.addEventListener('click', async () => {
    await sonifier.setEnabled(sonifier.status() !== 'on');
  });
  soundScene.addEventListener('change', () => sonifier.setScene(soundScene.value as SoundScene));
  soundVolume.addEventListener('input', () => {
    const percent = clamp(Number(soundVolume.value), 0, 100);
    sonifier.setVolume(percent / 100);
    soundVolumeOutput.value = `${Math.round(percent)}%`;
  });
}

function updateSound(status: SoundStatus, volume: number, scene: SoundScene): void {
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
    : status === 'resume' ? `Tap to resume ${sceneLabel} — ${percent}%` : `Sound off — ${sceneLabel} · ${percent}%`;
  soundToggle.textContent = status === 'on' ? 'Turn sound off' : status === 'resume' ? 'Tap to Resume' : 'Turn sound on';
  soundVolume.value = String(percent);
  soundVolumeOutput.value = `${percent}%`;
  syncSoundScene(soundScene, scene);
}

function renderTooltip(node: NodeV2 | null, point?: { x: number; y: number }): void {
  tooltip.replaceChildren();
  if (!node || !point) {
    tooltip.hidden = true;
    return;
  }
  const title = document.createElement('strong');
  title.textContent = node.label;
  const details = document.createElement('span');
  details.textContent = `${roleLabel(node.role)} · ${relativeTime(node.lastSeen)}`;
  tooltip.append(title, details);
  tooltip.style.left = `${clamp(point.x, 8, stage.clientWidth - 180)}px`;
  tooltip.style.top = `${clamp(point.y, 60, stage.clientHeight - 8)}px`;
  tooltip.hidden = false;
}

function pulseTraffic(packet: PacketView): void {
  const now = performance.now();
  recentTraffic = recentTraffic.filter((timestamp) => now - timestamp < 3_000);
  recentTraffic.push(now);
  const level = recentTraffic.length >= 16 ? 5 : recentTraffic.length >= 10 ? 4 : recentTraffic.length >= 6 ? 3 : recentTraffic.length >= 3 ? 2 : 1;
  trafficMeter.dataset.level = String(level);
  app.dataset.trafficKind = normalizePacketKind(packet.payloadType).toLowerCase();
  topbar.classList.add('traffic-pulse');
  if (trafficTimer !== undefined) window.clearTimeout(trafficTimer);
  trafficTimer = window.setTimeout(() => {
    recentTraffic = [];
    trafficMeter.dataset.level = '0';
    topbar.classList.remove('traffic-pulse');
    trafficTimer = undefined;
  }, 2_400);
}

function pulseSound(notes: number): void {
  scheduledNotes += notes;
  soundActivity.dataset.scheduled = String(scheduledNotes);
  soundActivity.classList.add('active');
  soundButton.classList.add('sounding');
  if (soundPulseTimer !== undefined) window.clearTimeout(soundPulseTimer);
  soundPulseTimer = window.setTimeout(() => {
    soundActivity.classList.remove('active');
    soundButton.classList.remove('sounding');
    soundPulseTimer = undefined;
  }, 720);
}

function closeFindPanel(): void {
  findPanel.hidden = true;
  findButton.setAttribute('aria-expanded', 'false');
  nodeSearch.setAttribute('aria-expanded', 'false');
  nodeSearch.removeAttribute('aria-activedescendant');
}

function closeSoundPanel(): void {
  soundPanel.hidden = true;
  soundButton.setAttribute('aria-expanded', 'false');
}

function loadSettings(): { routeWindow: NetgraphWindow } {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as { routeWindow?: unknown } | null;
    if (value && isNetgraphWindow(value.routeWindow)) return { routeWindow: value.routeWindow };
  } catch {
    // Storage is optional.
  }
  return { routeWindow: '15m' };
}

function saveSettings(window: NetgraphWindow): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ routeWindow: window }));
  } catch {
    // Storage is optional.
  }
}

function isNetgraphWindow(value: unknown): value is NetgraphWindow {
  return value === '15m' || value === '1h' || value === '6h' || value === '24h';
}

function requestScreenAwake(): Promise<void> {
  screenAwakeWanted = true;
  if (!matchMedia('(pointer: coarse)').matches) {
    app.dataset.screenAwake = 'desktop';
    return Promise.resolve();
  }
  const api = (navigator as Navigator & { wakeLock?: ScreenWakeLockAPI }).wakeLock;
  if (!api) {
    app.dataset.screenAwake = 'unsupported';
    return Promise.resolve();
  }
  if (document.hidden || wakeLock && !wakeLock.released) return Promise.resolve();
  if (wakeLockRequest) return wakeLockRequest;
  app.dataset.screenAwake = 'requesting';
  wakeLockRequest = api.request('screen')
    .then(async (sentinel) => {
      if (!screenAwakeWanted || document.hidden) {
        await sentinel.release();
        app.dataset.screenAwake = 'false';
        return;
      }
      wakeLock = sentinel;
      app.dataset.screenAwake = 'true';
      sentinel.addEventListener('release', () => {
        if (wakeLock === sentinel) {
          wakeLock = undefined;
          app.dataset.screenAwake = 'false';
        }
      }, { once: true });
    })
    .catch(() => { app.dataset.screenAwake = 'retry'; })
    .finally(() => { wakeLockRequest = undefined; });
  return wakeLockRequest;
}

function releaseScreenAwake(): void {
  screenAwakeWanted = false;
  app.dataset.screenAwake = 'false';
  const sentinel = wakeLock;
  wakeLock = undefined;
  if (sentinel && !sentinel.released) {
    void sentinel.release().catch(() => undefined);
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing required element: ${id}`);
  return element as T;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
