import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewNavigation } from './viewNavigation';

beforeEach(()=>{document.body.innerHTML='<div class="controls"><a id="netgraph-link" href="/netgraph/">Netgraph</a><a id="labs-link" href="/labs/">Labs</a></div>';});
afterEach(()=>window.dispatchEvent(new Event('pagehide')));
describe('grouped view navigation',()=>{
  it('keeps core views direct and groups the available experiments and Labs',()=>{
    const nav=createViewNavigation('Pachinko',new Set(['terminal','chronoscope','firehose','pachinko']),true);document.querySelector('.controls')!.append(nav);
    expect([...nav.querySelectorAll(':scope > a')].map(a=>a.textContent)).toEqual(['Map','Netgraph','Terminal']);
    expect([...nav.querySelectorAll('#experimental-options a')].map(a=>a.textContent)).toEqual(['Chronoscope','Firehose','Pachinko']);
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/pachinko/');
    expect(nav.querySelectorAll('#labs-options a')).toHaveLength(4);
    expect([...nav.querySelectorAll('a')].every(a=>a.querySelector('svg[aria-hidden="true"]'))).toBe(true);
  });
  it('does not advertise disabled operator pages',()=>{
    const nav=createViewNavigation('Map',new Set(),false);
    expect([...nav.querySelectorAll('a')].map(a=>a.textContent)).toEqual(['Map','Netgraph']);expect(nav.querySelector('details')).toBeNull();
    const subset=createViewNavigation('Firehose',new Set(['firehose']),false);
    expect([...subset.querySelectorAll('#experimental-options a')].map(a=>a.textContent)).toEqual(['Firehose']);expect(subset.querySelector('#labs-options')).toBeNull();
  });
});

it('follows the existing Labs picker without leaving a stale current-view marker',()=>{
 const picker=document.createElement('select');picker.id='experiment-select';picker.innerHTML='<option value="packet-pond">Pond</option><option value="mesh-loom">Loom</option>';document.body.append(picker);
 const nav=createViewNavigation('Labs',new Set(),true);document.body.append(nav);
 expect(nav.querySelector('[data-lab="packet-pond"]')?.getAttribute('aria-current')).toBe('page');
 picker.value='mesh-loom';picker.dispatchEvent(new Event('change'));
 expect(nav.querySelector('[data-lab="packet-pond"]')?.hasAttribute('aria-current')).toBe(false);
 expect(nav.querySelector('[data-lab="mesh-loom"]')?.getAttribute('aria-current')).toBe('page');
});
