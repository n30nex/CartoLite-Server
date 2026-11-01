import type { ExpressionSpecification } from 'maplibre-gl';
import type { NodeScopes, ScopeSnapshot } from './types';

export interface ScopeSettings { enabled: boolean; hours: 1 | 6 | 24; focus: string | null; mode: 'highlight' | 'isolate' }
export const DEFAULT_SCOPES: ScopeSettings = { enabled: false, hours: 24, focus: null, mode: 'highlight' };
export const SCOPE_STORAGE = 'cartolite-repeater-scopes-v1';
export const SCOPE_PALETTE_LIMIT = 64;
export const scopeWindowIndex = (hours: ScopeSettings['hours']): number => hours === 1 ? 0 : hours === 6 ? 1 : 2;

export function validScopeName(value: unknown): value is string {
  return typeof value === 'string' && (value === '*' || value === '?' || (/^[#$].+/u.test(value)
    && new TextEncoder().encode(value).length <= 65 && !/[\p{Cc}\p{Cf},]/u.test(value)
    && value === value.trim() && !/^[#$](?:[a-f\d]{2}){8,}$/i.test(value)));
}

export function normalizeScopeSettings(value: unknown): ScopeSettings {
  const raw = value && typeof value === 'object' ? value as Partial<ScopeSettings> : {};
  return { enabled: raw.enabled === true, hours: raw.hours === 1 || raw.hours === 6 ? raw.hours : 24,
    focus: validScopeName(raw.focus) ? raw.focus : null, mode: raw.mode === 'isolate' ? 'isolate' : 'highlight' };
}

export function scopesFromURL(url: URL, fallback: ScopeSettings = DEFAULT_SCOPES): ScopeSettings {
  if (!url.searchParams.has('repeater_scopes')) return { ...fallback };
  return normalizeScopeSettings({ enabled: url.searchParams.get('repeater_scopes') === 'on',
    hours: Number(url.searchParams.get('scope_hours')), focus: url.searchParams.get('scope_focus'), mode: url.searchParams.get('scope_mode') });
}

export function scopesToURL(url: URL, settings: ScopeSettings): URL {
  const result = new URL(url);
  result.searchParams.set('repeater_scopes', settings.enabled ? 'on' : 'off');
  result.searchParams.set('scope_hours', String(settings.hours));
  result.searchParams.set('scope_mode', settings.mode);
  if (settings.focus) result.searchParams.set('scope_focus', settings.focus); else result.searchParams.delete('scope_focus');
  return result;
}

export function scopeColor(name: string, light = false): string {
  if (name === '?') return scopeNeutral(light);
  let hash = 2166136261;
  for (const c of name) hash = Math.imul(hash ^ c.codePointAt(0)!, 16777619);
  return `hsl(${(hash >>> 0) % 360}, ${light ? 74 : 83}%, ${light ? 31 : 70}%)`;
}
export const scopeNeutral = (light: boolean): string => light ? '#576775' : '#b0bdc9';
export const scopeLabel = (name: string): string => name === '*' ? '* · Unscoped flood' : name === '?' ? '? · Unresolved scope' : name;
export const scopeConfigLabel = (name: string): string => name === '*' ? '* · Wildcard configuration' : scopeLabel(name);
export const scopeLegendLabel = (name: string): string => name === '*' ? '* · Unscoped / wildcard' : scopeLabel(name);

export function scopeMembership(node: NodeScopes | undefined, hours: ScopeSettings['hours']): Map<string, number> {
  const names = new Map<string, number>();
  const index = scopeWindowIndex(hours);
  for (const e of node?.scopes ?? []) if (e.repeats[index]! > 0 || e.heard[index]! > 0) names.set(e.name, e.repeats[index]!);
  for (const report of node?.reports ?? []) {
    for (const e of report.entries) if (!names.has(e.name)) names.set(e.name, 0);
    if (report.defaultState === 'named' && report.default && !names.has(report.default)) names.set(report.default, 0);
  }
  return names;
}

export function scopePalette(nodes: readonly NodeScopes[], hours: ScopeSettings['hours']): string[] {
  const totals = new Map<string, number>();
  for (const node of nodes) for (const [name, count] of scopeMembership(node, hours)) if (name !== '?') totals.set(name, (totals.get(name) ?? 0) + count);
  return [...totals].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0,SCOPE_PALETTE_LIMIT).map(([name]) => name);
}

export function dominantScope(names: readonly string[], values: readonly number[], palette: readonly string[]): string | null {
  let best = 0; let winner: string | null = null;
  for (let i=0; i<names.length; i++) {
    const count=values[i] ?? 0;
    if (count > best) { best=count; winner=names[i]!; } else if (count === best) winner=null;
  }
  return winner && winner !== '?' && palette.includes(winner) ? winner : null;
}

export function scopeProperties(node: NodeScopes | undefined, settings: ScopeSettings, palette: readonly string[], light: boolean): Record<string, unknown> {
  const membership=scopeMembership(node,settings.hours);
  const names=[...membership.keys()]; const values=[...membership.values()];
  const votes=palette.map(name=>membership.get(name) ?? 0);
  const other=names.reduce((sum,name,i)=>sum+(palette.includes(name) ? 0 : values[i]!),0);
  const winner=dominantScope(names,values,palette);
  return { scopeNames:names, scopeRepeatValues:values, scopeVotes:votes.concat(Array(SCOPE_PALETTE_LIMIT-votes.length).fill(0)),
    scopeOther:other, scopeMatch:!settings.focus || membership.has(settings.focus) ? 1 : 0,
    scopeColor:winner ? scopeColor(winner,light) : scopeNeutral(light) };
}

// Worker-bound names are array values, never object keys. Cluster slots have a
// fixed schema so new names do not require replacing sources/layers or the map.
export function scopeClusterProperties(): Record<string, ExpressionSpecification> {
  const properties: Record<string, ExpressionSpecification> = {
    scopeOther: ['+', ['coalesce', ['get', 'scopeOther'], 0]],
    scopeMatch: ['+', ['coalesce', ['get', 'scopeMatch'], 0]],
  };
  for (let i=0;i<SCOPE_PALETTE_LIMIT;i++) properties[`scope${i}`] = ['+', ['at', i, ['coalesce', ['get','scopeVotes'], ['literal',Array(SCOPE_PALETTE_LIMIT).fill(0)]]]];
  return properties;
}

export function scopeClusterColor(palette: readonly string[], light: boolean): ExpressionSpecification {
  const values: ExpressionSpecification[] = palette.map((_,i)=>['coalesce',['get',`scope${i}`],0]);
  values.push(['coalesce',['get','scopeOther'],0]);
  const matches: ExpressionSpecification[] = values.map(value=>['case',['==',value,['var','largest']],1,0]);
  const cases: unknown[] = [];
  palette.forEach((name,i)=>cases.push(['==',values[i],['var','largest']],scopeColor(name,light)));
  if (!palette.length) return ['literal',scopeNeutral(light)];
  return ['let','largest',['max',...values],['case',['any',['==',['var','largest'],0],['!=',['+',...matches],1]],scopeNeutral(light),
    ['case',...cases,scopeNeutral(light)]]] as unknown as ExpressionSpecification;
}

export function inScopeBounds(lng: number, lat: number, bounds: readonly [number,number,number,number]): boolean {
  const [west,south,east,north]=bounds;
  if (lat<south || lat>north) return false;
  const span=east>=west ? east-west : east-west+360;
  return span>=360 || ((lng-west)%360+360)%360<=span;
}

// Validate the optional endpoint independently: malformed or unavailable scope
// evidence must not take down the existing state/event feed.
export function parseScopeSnapshot(value: unknown): ScopeSnapshot {
  const v=value as ScopeSnapshot;
  const time=(n: unknown): boolean=>typeof n==='number' && Number.isSafeInteger(n) && n>=0;
  if (!v || v.schemaVersion!==1 || !time(v.serverTime) || !time(v.since) || !time(v.sessionStart) || !time(v.lastGap)
    || v.limitedAt!==undefined && !time(v.limitedAt) || typeof v.connected!=='boolean' || !Array.isArray(v.nodes) || v.nodes.length>10000) throw new Error('Scope evidence is unavailable');
  let evidenceCount=0; const ids=new Set<string>();
  for (const node of v.nodes) {
    if (!node || typeof node.id!=='string' || !/^[\w-]{1,96}$/.test(node.id) || ids.has(node.id) || !Array.isArray(node.scopes) || !Array.isArray(node.reports) || node.reports.length>10000) throw new Error('Invalid scope node');
    ids.add(node.id); const names=new Set<string>();
    for (const e of node.scopes) {
      if (!e || !validScopeName(e.name) || names.has(e.name) || !Array.isArray(e.repeats) || !Array.isArray(e.heard)
        || e.repeats.length!==3 || e.heard.length!==3 || [...e.repeats,...e.heard].some(n=>!time(n))
        || e.first!==undefined && !time(e.first) || e.last!==undefined && !time(e.last)) throw new Error('Invalid scope counts');
      names.add(e.name); evidenceCount++;
    }
    for (const r of node.reports) {
      if (!r || !['mqtt-self','mqtt-neighbor','mqtt-status','meshmapper-reported','meshmapper-uploaded','meshmapper-default'].includes(r.source)
        || typeof r.list!=='boolean' || r.at!==undefined && !time(r.at) || !Array.isArray(r.entries) || r.entries.length>64
        || r.defaultState!==undefined && !['named','none','unknown'].includes(r.defaultState)
        || r.defaultState==='named' && !validScopeName(r.default)
        || r.defaultSource!==undefined && !['advert','reported'].includes(r.defaultSource)
        || r.default!==undefined && !validScopeName(r.default)
        || r.entries.some(e=>!e || !validScopeName(e.name) || e.at!==undefined && !time(e.at))) throw new Error('Invalid scope report');
      evidenceCount+=r.entries.length;
    }
    if (evidenceCount>750000) throw new Error('Scope evidence limit exceeded');
  }
  return v;
}
