import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { fetchState, LiveFeed } from './api';
import { RouteSonifier, type SoundScene, type SoundStatus } from './audio';
import {
  LIVE_FOLLOW_MIN_INTERVAL_MS,
  LiveMap,
  type LiveMapFocus,
  type RouteRepresentation,
  type RouteWindow
} from './map';
import { PacketAnimator } from './packetAnimator';
import {
  loadSavedView,
  loadUiPreferences,
  saveUiPreferences,
  saveView,
  viewClass,
  type UiPreferences,
  type ViewClass
} from './preferences';
import { activityLabel, LiveStore } from './state';
import { normalizePacketKind, PACKET_KIND_COLORS, ROUTE_LEGEND_ITEMS } from './trafficVisuals';
import type { PacketView } from './types';

const appElement = required<HTMLElement>('app');
const statusElement = required<HTMLElement>('status');
const statusText = required<HTMLElement>('status-text');
const trafficMeter = required<HTMLElement>('traffic-meter');
const topbar = required<HTMLElement>('topbar');
const mapElement = required<HTMLElement>('map');
const fatal = required<HTMLElement>('fatal');
const followButton = required<HTMLButtonElement>('follow-button');
const routesButton = required<HTMLButtonElement>('routes-button');
const heatmapButton = required<HTMLButtonElement>('heatmap-button');
const clustersButton = required<HTMLButtonElement>('clusters-button');
const hillshadeButton = required<HTMLButtonElement>('hillshade-button');
const terrainButton = required<HTMLButtonElement>('terrain-button');
const soundButton = required<HTMLButtonElement>('sound-button');
const soundControl = required<HTMLElement>('sound-button').parentElement as HTMLElement;
const soundPanel = required<HTMLElement>('sound-panel');
const soundState = required<HTMLElement>('sound-state');
const soundPanelState = required<HTMLElement>('sound-panel-state');
const soundToggle = required<HTMLButtonElement>('sound-toggle');
const soundScene = required<HTMLSelectElement>('sound-scene');
const soundVolume = required<HTMLInputElement>('sound-volume');
const soundVolumeOutput = required<HTMLOutputElement>('sound-volume-output');
const soundActivity = required<HTMLElement>('sound-activity');
const layersDisclosure = required<HTMLElement>('layers-disclosure');
const layersSummary = required<HTMLButtonElement>('layers-summary');
const layersPanel = required<HTMLElement>('layers-panel');
const findControl = required<HTMLElement>('find-control');
const findButton = required<HTMLButtonElement>('find-button');
const findPanel = required<HTMLElement>('find-panel');
const nodeSearch = required<HTMLInputElement>('node-search');
const nodeSearchResults = required<HTMLElement>('node-search-results');
const resetButton = required<HTMLButtonElement>('reset-button');
const legend = required<HTMLElement>('legend');
const legendToggle = required<HTMLButtonElement>('legend-toggle');
const focusChip = required<HTMLElement>('focus-chip');
const focusText = required<HTMLElement>('focus-text');
const routeLegend = required<HTMLElement>('route-legend');
const routeWindow = required<HTMLSelectElement>('route-window');
const aboutButton = required<HTMLButtonElement>('about-button');
const aboutDialog = required<HTMLDialogElement>('about-dialog');
const aboutClose = required<HTMLButtonElement>('about-close');
const lastUpdate = required<HTMLElement>('last-update');

let uiPreferences: UiPreferences = loadUiPreferences(localStorage);
let legendExpanded = uiPreferences.legendExpanded;
let lastTrafficPulseAt = -Infinity;
let soundPulseTimer: number | undefined;
let scheduledNoteCount = 0;
let activeViewClass: ViewClass = viewClass();
let trafficWakeTimer: number | undefined;
let recentTraffic: number[] = [];
let screenWakeLock: ScreenWakeLockSentinel | undefined;
let screenWakeLockRequest: Promise<void> | undefined;

interface ScreenWakeLockSentinel extends EventTarget {
  readonly released: boolean;
  release(): Promise<void>;
}

interface ScreenWakeLockAPI {
  request(type: 'screen'): Promise<ScreenWakeLockSentinel>;
}

function mobileScreenAwakeWanted(): boolean {
  return activeViewClass === 'mobile' || window.matchMedia('(pointer: coarse)').matches;
}

function requestScreenAwake(): Promise<void> {
  if (!mobileScreenAwakeWanted()) {
    appElement.dataset.screenAwake = 'desktop';
    return Promise.resolve();
  }
  const api = (navigator as Navigator & { wakeLock?: ScreenWakeLockAPI }).wakeLock;
  if (!api) {
    appElement.dataset.screenAwake = 'unsupported';
    return Promise.resolve();
  }
  if (document.hidden || (screenWakeLock && !screenWakeLock.released)) return Promise.resolve();
  if (screenWakeLockRequest) return screenWakeLockRequest;
  appElement.dataset.screenAwake = 'requesting';
  screenWakeLockRequest = api.request('screen')
    .then(async (sentinel) => {
      if (document.hidden) {
        await sentinel.release();
        return;
      }
      screenWakeLock = sentinel;
      appElement.dataset.screenAwake = 'true';
      sentinel.addEventListener('release', () => {
        if (screenWakeLock !== sentinel) return;
        screenWakeLock = undefined;
        appElement.dataset.screenAwake = 'false';
      }, { once: true });
    })
    .catch(() => {
      appElement.dataset.screenAwake = 'retry';
    })
    .finally(() => {
      screenWakeLockRequest = undefined;
    });
  return screenWakeLockRequest;
}

function releaseScreenAwake(): void {
  const sentinel = screenWakeLock;
  screenWakeLock = undefined;
  if (!sentinel || sentinel.released) return;
  appElement.dataset.screenAwake = 'false';
  void sentinel.release().catch(() => undefined);
}

function setLayersOpen(open: boolean): void {
  layersDisclosure.toggleAttribute('open', open);
  layersSummary.setAttribute('aria-expanded', String(open));
  layersPanel.hidden = activeViewClass === 'mobile' && !open;
}

document.documentElement.dataset.viewClass = activeViewClass;
setLayersOpen(activeViewClass === 'desktop');
layersSummary.hidden = activeViewClass === 'desktop';
layersSummary.style.display = activeViewClass === 'desktop' ? 'none' : '';

legendToggle.addEventListener('click', () => {
  legendExpanded = !legendExpanded;
  uiPreferences = { ...uiPreferences, legendExpanded };
  saveUiPreferences(localStorage, uiPreferences);
  legend.dataset.collapsed = String(!legendExpanded);
  legendToggle.setAttribute('aria-expanded', String(legendExpanded));
  legendToggle.setAttribute('aria-label', legendExpanded ? 'Hide map legend' : 'Show map legend');
});
legend.dataset.collapsed = String(!legendExpanded);
legendToggle.setAttribute('aria-expanded', String(legendExpanded));
legendToggle.setAttribute('aria-label', legendExpanded ? 'Hide map legend' : 'Show map legend');

renderRouteLegend(routeLegend, 'individual-routes');
aboutButton.addEventListener('click', () => aboutDialog.showModal());
aboutClose.addEventListener('click', () => aboutDialog.close());
aboutDialog.addEventListener('click', (event) => {
  if (event.target === aboutDialog) aboutDialog.close();
});
layersSummary.addEventListener('click', () => {
  const opening = !layersDisclosure.hasAttribute('open');
  setLayersOpen(opening);
  if (opening) closeSoundPanel();
});
document.addEventListener('pointerdown', (event) => {
  void requestScreenAwake();
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!soundControl.contains(target)) closeSoundPanel();
  if (!findControl.contains(target)) closeFindPanel();
  if (activeViewClass === 'mobile' && !layersDisclosure.contains(target)) setLayersOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeSoundPanel();
  closeFindPanel();
  if (activeViewClass === 'mobile') setLayersOpen(false);
});

void requestScreenAwake();
void start();

async function start(): Promise<void> {
  let mapView: LiveMap | undefined;
  let animator: PacketAnimator | undefined;
  let sonifier: RouteSonifier | undefined;
  let store: LiveStore | undefined;
  let feed: LiveFeed | undefined;
  let followTimer: number | undefined;
  try {
    // Construct MapLibre before the state request so the basemap can paint while
    // the initial snapshot is in flight.
    const liveMap = new LiveMap(
      mapElement,
      required<HTMLElement>('tooltip'),
      required<HTMLElement>('node-inspector-sheet'),
      {
      onFocusChange: updateFocusChrome,
      onRouteRepresentationChange(representation) {
        renderRouteLegend(routeLegend, representation);
      },
      onRouteWindowChange(label) {
        const option = routeWindow.querySelector<HTMLOptionElement>('option[value="auto"]');
        if (option) option.textContent = label;
      }
      },
    );
    mapView = liveMap;
    const packetCanvas = required<HTMLCanvasElement>('packet-canvas');
    const liveAnimator = new PacketAnimator(liveMap.map, packetCanvas);
    animator = liveAnimator;
    const routeSonifier = new RouteSonifier(liveMap.map, packetCanvas);
    sonifier = routeSonifier;
    soundVolume.value = String(Math.round(routeSonifier.getVolume() * 100));
    soundVolumeOutput.value = `${soundVolume.value}%`;
    soundScene.value = routeSonifier.getScene();
    routeSonifier.setStatusListener((status) => updateSoundChrome(
      status,
      routeSonifier.getVolume(),
      routeSonifier.getScene(),
    ));
    if (!routeSonifier.supported()) {
      soundButton.disabled = true;
      soundToggle.disabled = true;
      soundScene.disabled = true;
      soundButton.title = 'Route sounds are unavailable in this browser';
      soundState.textContent = 'Unavailable';
      soundPanelState.textContent = 'Unavailable';
    }
    wireLayerToggle(routesButton, uiPreferences.routes, 'routes', (visible) => {
      liveMap.setRoutesVisible(visible);
      routeLegend.hidden = !visible;
      persistUiPreference({ routes: visible });
    });
    wireLayerToggle(heatmapButton, uiPreferences.heatmap, 'heatmap', (visible) => {
      liveMap.setHeatmapVisible(visible);
      persistUiPreference({ heatmap: visible });
    });
    wireLayerToggle(clustersButton, uiPreferences.clusters, 'clusters', (visible) => {
      liveMap.setClustersVisible(visible);
      persistUiPreference({ clusters: visible });
    });
    wireLayerToggle(hillshadeButton, uiPreferences.hillshade, 'topography', (visible) => {
      liveMap.setHillshadeVisible(visible);
      persistUiPreference({ hillshade: visible });
    });
    wireLayerToggle(terrainButton, uiPreferences.terrain3D, '3D terrain', (visible) => {
      liveMap.setTerrain3D(visible);
      persistUiPreference({ terrain3D: visible });
    });
    routeWindow.value = uiPreferences.routeWindow;
    liveMap.setRouteWindow(uiPreferences.routeWindow);
    routeWindow.addEventListener('change', () => {
      const window = routeWindow.value as RouteWindow;
      liveMap.setRouteWindow(window);
      persistUiPreference({ routeWindow: window });
    });
    const renderNodeSearch = (): void => {
      const started = performance.now();
      const results = liveMap.findNodes(nodeSearch.value);
      nodeSearchResults.replaceChildren();
      if (!nodeSearch.value.trim()) {
        mapElement.dataset.nodeSearchApplyMs = (performance.now() - started).toFixed(1);
        return;
      } else if (results.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No matching public labels';
        nodeSearchResults.append(empty);
      } else {
        for (const { node } of results) {
          const result = document.createElement('button');
          result.type = 'button';
          result.className = 'node-search-result';
          result.setAttribute('role', 'option');
          result.dataset.nodeId = node.id;
          const label = document.createElement('strong');
          label.textContent = node.label;
          const context = document.createElement('span');
          context.textContent = `${node.role.replace('_', ' ')} · ${relativeNodeTime(node.lastSeen)}`;
          result.append(label, context);
          result.addEventListener('click', () => {
            liveMap.selectNodeByID(node.id, true);
            closeFindPanel();
            if (activeViewClass === 'mobile') setLayersOpen(false);
          });
          nodeSearchResults.append(result);
        }
      }
      mapElement.dataset.nodeSearchApplyMs = (performance.now() - started).toFixed(1);
    };
    findButton.addEventListener('click', () => {
      const opening = findPanel.hidden;
      findPanel.hidden = !opening;
      findButton.setAttribute('aria-expanded', String(opening));
      if (!opening) return;
      closeSoundPanel();
      renderNodeSearch();
      window.requestAnimationFrame(() => nodeSearch.focus());
    });
    nodeSearch.addEventListener('input', renderNodeSearch);
    nodeSearch.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        const first = nodeSearchResults.querySelector<HTMLButtonElement>('button');
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === 'Enter') {
        const first = nodeSearchResults.querySelector<HTMLButtonElement>('button');
        if (first) {
          event.preventDefault();
          first.click();
        }
      }
    });
    let wasHidden = document.hidden;
    document.addEventListener('visibilitychange', () => {
      animator?.setPaused(document.hidden);
      sonifier?.setPaused(document.hidden);
      if (document.hidden) {
        wasHidden = true;
        releaseScreenAwake();
        return;
      }
      void requestScreenAwake();
      if (wasHidden) {
        wasHidden = false;
        void feed?.resume();
      }
    });
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      void requestScreenAwake();
      void feed?.resume();
    });
    window.addEventListener('online', () => {
      void requestScreenAwake();
      void feed?.resume();
    });
    window.addEventListener('beforeunload', () => {
      if (trafficWakeTimer !== undefined) window.clearTimeout(trafficWakeTimer);
      if (followTimer !== undefined) window.clearTimeout(followTimer);
      feed?.stop();
      store?.destroy();
      animator?.destroy();
      sonifier?.destroy();
      mapView?.destroy();
      releaseScreenAwake();
    }, { once: true });

    const initial = await fetchState();
    const liveStore = new LiveStore(initial);
    store = liveStore;
    let streamConnected = false;
    let liveFollow = false;
    let pendingFollow: PacketView | undefined;
    let lastFollowMoveAt = Number.NEGATIVE_INFINITY;

    mapElement.dataset.followDwellMs = String(LIVE_FOLLOW_MIN_INTERVAL_MS);

    const clearFollowQueue = (): void => {
      pendingFollow = undefined;
      if (followTimer !== undefined) window.clearTimeout(followTimer);
      followTimer = undefined;
    };

    const moveToPendingActivity = (): void => {
      followTimer = undefined;
      if (!liveFollow || !pendingFollow) return;
      const packet = pendingFollow;
      pendingFollow = undefined;
      if (!liveMap.shouldFollow(packet)) return;
      if (liveMap.follow(packet)) lastFollowMoveAt = Date.now();
    };

    const queueLiveFollow = (packet: PacketView): void => {
      if (!liveFollow || !liveMap.shouldFollow(packet)) return;
      pendingFollow = packet;
      if (followTimer !== undefined) return;
      const remaining = Math.max(0, lastFollowMoveAt + LIVE_FOLLOW_MIN_INTERVAL_MS - Date.now());
      if (remaining === 0) moveToPendingActivity();
      else followTimer = window.setTimeout(moveToPendingActivity, remaining);
    };

    const setLiveFollow = (enabled: boolean): void => {
      clearFollowQueue();
      liveFollow = enabled;
      if (enabled) lastFollowMoveAt = Number.NEGATIVE_INFINITY;
      followButton.setAttribute('aria-pressed', String(enabled));
      followButton.classList.toggle('selected', enabled);
      followButton.dataset.mode = enabled ? 'director' : 'manual';
      appElement.classList.toggle('director-enabled', enabled);
      followButton.title = enabled ? 'Stop following live packets' : 'Follow live packets';
    };
    setLiveFollow(false);

    liveMap.map.on('dragstart', () => setLiveFollow(false));
    liveMap.map.on('zoomstart', (event) => {
      if (event.originalEvent) setLiveFollow(false);
    });

    const updateStatus = (): void => {
      const display = activityLabel(liveStore.snapshot, streamConnected);
      statusElement.dataset.state = display.state;
      statusText.textContent = display.text;
      statusElement.title = `${liveStore.snapshot.nodes.length} nodes · ${liveStore.snapshot.routes.length} routes`;
    };

    liveStore.subscribe((state, changes) => {
      if (changes) liveMap.render(state, changes);
      updateStatus();
    });
    const savedView = loadSavedView(localStorage, activeViewClass);
    if (savedView) {
      mapElement.dataset.viewSource = liveMap.restore(savedView.center, savedView.zoom, initial.nodes)
        ? 'saved'
        : 'home-no-activity';
    } else {
      mapElement.dataset.viewSource = 'home';
      liveMap.home(initial.nodes);
    }

    liveMap.map.on('moveend', () => {
      if (!liveFollow) saveView(localStorage, activeViewClass, liveMap.view());
    });
    let resizeTimer: number | undefined;
    window.addEventListener('resize', () => {
      if (resizeTimer !== undefined) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        const next = viewClass();
        if (next === activeViewClass) return;
        activeViewClass = next;
        document.documentElement.dataset.viewClass = next;
        setLayersOpen(next === 'desktop');
        layersSummary.hidden = next === 'desktop';
        layersSummary.style.display = next === 'desktop' ? 'none' : '';
        const restored = loadSavedView(localStorage, next);
        if (restored) {
          mapElement.dataset.viewSource = liveMap.restore(restored.center, restored.zoom, liveStore.snapshot.nodes)
            ? 'saved'
            : 'home-no-activity';
        } else {
          mapElement.dataset.viewSource = 'home';
          liveMap.home(liveStore.snapshot.nodes);
        }
      }, 160);
    });

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
        lastUpdate.textContent = formatUpdate(event.at);
        if (!packet) return;
        liveAnimator.add(packet);
        const scheduled = routeSonifier.play(packet);
        if (scheduled > 0) pulseSoundChrome(scheduled);
        pulseTrafficChrome(packet.payloadType);
        queueLiveFollow(packet);
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
        console.warn('Live stream recovery:', error.message);
      }
    });
    feed = liveFeed;
    liveFeed.start();

    followButton.addEventListener('click', () => {
      setLiveFollow(!liveFollow);
    });
    soundButton.addEventListener('click', () => {
      const opening = soundPanel.hidden;
      soundPanel.hidden = !opening;
      soundButton.setAttribute('aria-expanded', String(opening));
      if (opening && activeViewClass === 'mobile') setLayersOpen(false);
    });
    soundToggle.addEventListener('click', async () => {
      const enabled = await routeSonifier.setEnabled(routeSonifier.status() !== 'on');
      if (!enabled && routeSonifier.status() === 'off') {
        if (soundPulseTimer !== undefined) window.clearTimeout(soundPulseTimer);
        soundPulseTimer = undefined;
        soundButton.classList.remove('sounding');
        soundActivity.classList.remove('active');
      }
    });
    soundVolume.addEventListener('input', () => {
      const percent = Math.max(0, Math.min(100, Number(soundVolume.value)));
      routeSonifier.setVolume(percent / 100);
      soundVolumeOutput.value = `${Math.round(percent)}%`;
    });
    soundScene.addEventListener('change', () => routeSonifier.setScene(soundScene.value as SoundScene));
    resetButton.addEventListener('click', () => {
      setLiveFollow(false);
      liveMap.home(liveStore.snapshot.nodes);
    });
    lastUpdate.textContent = formatUpdate(initial.serverTime);
  } catch (error) {
    console.error('CartoLite startup failed:', error);
    feed?.stop();
    store?.destroy();
    animator?.destroy();
    sonifier?.destroy();
    mapView?.destroy();
    statusElement.dataset.state = 'offline';
    statusText.textContent = 'Unavailable';
    fatal.textContent = error instanceof Error ? error.message : 'CartoLite could not start';
    fatal.hidden = false;
  }
}

function updateFocusChrome(focus: LiveMapFocus | null): void {
  legend.dataset.focused = String(Boolean(focus));
  appElement.classList.toggle('focus-active', Boolean(focus));
  focusChip.hidden = !focus;
  if (!focus) {
    focusText.textContent = '';
    legend.setAttribute('aria-label', 'Map legend');
    return;
  }
  const neighbors = `${focus.neighborCount} ${focus.neighborCount === 1 ? 'neighbor' : 'neighbors'}`;
  focusText.textContent = `${focus.label} · ${neighbors}`;
  legend.setAttribute('aria-label', `Selected node: ${focus.label}, ${neighbors}`);
}

function pulseTrafficChrome(payloadType: string | undefined): void {
  const now = performance.now();
  recentTraffic = recentTraffic.filter((timestamp) => now - timestamp < 3_000);
  recentTraffic.push(now);
  const level = recentTraffic.length >= 16 ? 5
    : recentTraffic.length >= 10 ? 4
      : recentTraffic.length >= 6 ? 3
        : recentTraffic.length >= 3 ? 2 : 1;
  trafficMeter.dataset.level = String(level);
  appElement.dataset.trafficKind = normalizePacketKind(payloadType).toLowerCase();
  if (trafficWakeTimer !== undefined) window.clearTimeout(trafficWakeTimer);
  trafficWakeTimer = window.setTimeout(() => {
    trafficWakeTimer = undefined;
    recentTraffic = [];
    trafficMeter.dataset.level = '0';
    appElement.classList.remove('traffic-awake');
  }, 2_400);
  appElement.classList.add('traffic-awake');
  if (now - lastTrafficPulseAt >= 620) {
    lastTrafficPulseAt = now;
    topbar.classList.remove('traffic-pulse');
    void topbar.offsetWidth;
    topbar.classList.add('traffic-pulse');
    window.setTimeout(() => topbar.classList.remove('traffic-pulse'), 720);
  }
}

function pulseSoundChrome(notes: number): void {
  scheduledNoteCount += notes;
  soundActivity.dataset.scheduled = String(scheduledNoteCount);
  if (soundPulseTimer !== undefined) return;
  soundButton.classList.add('sounding');
  soundActivity.classList.add('active');
  soundPulseTimer = window.setTimeout(() => {
    soundButton.classList.remove('sounding');
    soundActivity.classList.remove('active');
    soundPulseTimer = undefined;
  }, 720);
}

function updateSoundChrome(status: SoundStatus, volume: number, scene: SoundScene): void {
  const label = status === 'on' ? 'On' : status === 'resume' ? 'Tap to Resume' : 'Off';
  const percent = Math.round(volume * 100);
  const sceneLabel = scene[0]!.toUpperCase() + scene.slice(1);
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
  soundScene.value = scene;
}

function closeSoundPanel(): void {
  soundPanel.hidden = true;
  soundButton.setAttribute('aria-expanded', 'false');
}

function closeFindPanel(): void {
  findPanel.hidden = true;
  findButton.setAttribute('aria-expanded', 'false');
}

function relativeNodeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (seconds < 60) return 'seen now';
  if (seconds < 3_600) return `seen ${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `seen ${Math.floor(seconds / 3_600)}h ago`;
  return `seen ${Math.floor(seconds / 86_400)}d ago`;
}

function formatUpdate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Waiting for live state…';
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function persistUiPreference(update: Partial<UiPreferences>): void {
  uiPreferences = { ...uiPreferences, ...update };
  saveUiPreferences(localStorage, uiPreferences);
}

function wireLayerToggle(
  button: HTMLButtonElement,
  initiallyVisible: boolean,
  layerName: string,
  setVisible: (visible: boolean) => void
): void {
  let visible = initiallyVisible;
  const update = (): void => {
    button.setAttribute('aria-pressed', String(visible));
    button.classList.toggle('selected', visible);
    button.title = `${visible ? 'Hide' : 'Show'} ${layerName}`;
  };
  setVisible(visible);
  update();
  button.addEventListener('click', () => {
    visible = !visible;
    setVisible(visible);
    update();
  });
}

function renderRouteLegend(container: HTMLElement, representation: RouteRepresentation): void {
  container.replaceChildren();
  if (representation !== 'individual-routes') {
    container.setAttribute('aria-label', 'Grouped route colors show connection density');
    for (const item of [
      { color: '#63bcb2', label: 'Grouped routes', shortLabel: 'Grouped' },
      { color: '#d1b36b', label: 'Dense traffic', shortLabel: 'Dense' }
    ]) {
      const entry = document.createElement('span');
      entry.className = 'route-legend-item';
      entry.setAttribute('aria-label', item.label);
      entry.title = item.label;

      const swatch = document.createElement('i');
      swatch.className = 'route-legend-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      swatch.style.setProperty('--route-color', item.color);

      const label = document.createElement('span');
      label.className = 'route-legend-label';
      label.setAttribute('aria-hidden', 'true');
      label.dataset.short = item.shortLabel;
      label.textContent = item.label;

      entry.append(swatch, label);
      container.append(entry);
    }
    return;
  }
  container.setAttribute('aria-label', 'Route colors show the latest packet type');
  for (const item of ROUTE_LEGEND_ITEMS) {
    const entry = document.createElement('span');
    entry.className = 'route-legend-item';
    entry.setAttribute('aria-label', item.accessibleLabel);
    entry.title = item.accessibleLabel;

    const swatch = document.createElement('i');
    swatch.className = 'route-legend-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    swatch.style.setProperty('--route-color', PACKET_KIND_COLORS[item.kind]);

    const label = document.createElement('span');
    label.className = 'route-legend-label';
    label.setAttribute('aria-hidden', 'true');
    label.dataset.short = item.shortLabel;
    label.textContent = item.label;

    entry.append(swatch, label);
    container.append(entry);
  }
}
