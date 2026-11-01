import { describe, expect, it } from 'vitest';
import { DEFAULT_SCOPES, dominantScope, scopeColor, scopeMembership, scopePalette, scopeProperties, scopeClusterProperties, scopesFromURL, scopesToURL, inScopeBounds, parseScopeSnapshot } from './scopes';
import type { NodeScopes, ScopeSnapshot } from './types';

const node: NodeScopes = { id: 'n_test', scopes: [
  { name:'#YKF', repeats:[0,3,10], heard:[0,0,0], first:1, last:10 },
  { name:'#ykf', repeats:[0,1,3], heard:[1,2,3] },
  { name:'?', repeats:[0,0,2], heard:[0,0,0] },
], reports:[{ source:'mqtt-self', at:0, list:true, entries:[{name:'$constructor'},{name:'#__proto__'}], default:'*', defaultState:'named' }] };

describe('scope evidence, focus and worker transfer inputs',()=>{
  it('keeps reported and receiver-only membership without giving it repeat votes',()=>{
    const members=scopeMembership(node,1);
    expect(members).toEqual(new Map([['#ykf',0],['$constructor',0],['#__proto__',0],['*',0]]));
    const values=scopeProperties(node,{...DEFAULT_SCOPES,enabled:true},['#YKF','#ykf'],false);
    expect(values.scopeNames).toContain('$constructor');
    expect(values.scopeRepeatValues).toEqual([10,3,2,0,0,0]);
    expect(values).not.toHaveProperty('$constructor');
    expect(values).not.toHaveProperty('#__proto__');
    expect(values.scopeColor).toBe(scopeColor('#YKF'));
    expect((values.scopeVotes as number[])).toHaveLength(64);
    expect(Object.getPrototypeOf(values)).toBe(Object.prototype);
    expect(Object.keys(scopeClusterProperties())).toHaveLength(66);
  });
  it('keeps ties, unresolved dominance and palette overflow neutral',()=>{
    const names=['#A','#B','?'];
    expect(dominantScope(names,[5,5,1],names)).toBeNull();
    expect(dominantScope(names,[5,1,6],names)).toBeNull();
    expect(dominantScope(names,[5,1,0],['#B'])).toBeNull();
    expect(dominantScope(names,[5,6,1],names)).toBe('#B');
    expect(dominantScope(names,[0,0,0],names)).toBeNull();
    const many=Array.from({length:80},(_,i)=>({...node,id:`n${i}`,scopes:[{name:`#scope-${i}`,repeats:[1,1,i] as [number,number,number],heard:[0,0,0] as [number,number,number]}]}));
    expect(scopePalette(many,24)).toHaveLength(64);
    expect(scopeColor('#YKF')).not.toBe(scopeColor('#ykf'));
  });
  it('round-trips case, reserved names and separate scope state without changing other preferences',()=>{
    const base=new URL('https://example.test/?node=n_test&camera=unchanged');
    const settings={enabled:true,hours:6 as const,focus:'$constructor',mode:'isolate' as const};
    const url=scopesToURL(base,settings);
    expect(scopesFromURL(url)).toEqual(settings);
    expect(url.searchParams.get('node')).toBe('n_test');
    expect(base.searchParams.has('scope_focus')).toBe(false);
    expect(scopesFromURL(new URL('https://example.test/?repeater_scopes=on&scope_hours=999&scope_focus=%0Abad'))).toEqual({...DEFAULT_SCOPES,enabled:true});
  });
  it('counts visible memberships across the date line and wrapped world copies',()=>{
    expect(inScopeBounds(-179,40,[175,39,185,41])).toBe(true);
    expect(inScopeBounds(179,40,[-185,39,-175,41])).toBe(true);
    expect(inScopeBounds(-179,40,[175,39,-175,41])).toBe(true);
    expect(inScopeBounds(0,40,[175,39,-175,41])).toBe(false);
    expect(inScopeBounds(179,42,[175,39,-175,41])).toBe(false);
  });
  it('rejects malformed evidence without treating it as an empty successful report',()=>{
    const snapshot: ScopeSnapshot={schemaVersion:1,serverTime:10,since:1,sessionStart:1,lastGap:1,connected:true,nodes:[node]};
    expect(parseScopeSnapshot(snapshot)).toBe(snapshot);
    expect(()=>parseScopeSnapshot({...snapshot,nodes:[{...node,scopes:[{name:'#A',repeats:[-1,0,0],heard:[0,0,0]}]}]})).toThrow();
    expect(()=>parseScopeSnapshot({...snapshot,nodes:[node,node]})).toThrow();
  });
});
