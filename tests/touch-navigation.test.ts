import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../src/core/device',()=>({isTouch:true}));
vi.mock('../src/core/offline',()=>({downloads:async()=>[]}));
import App from '../src/App';
import {ContentSource} from '../src/core/source';
import {demoItems} from '../src/core/demo';

let root:Root;
const button=(id:string)=>document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`)!;
async function tap(id:string){await act(async()=>button(id).click());}
beforeEach(async()=>{
  vi.useFakeTimers();localStorage.clear();window.history.replaceState({},'', '/?preview=1');
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  document.body.innerHTML='<div id="test-root"></div>';root=createRoot(document.getElementById('test-root')!);
});
afterEach(async()=>{await act(async()=>root.unmount());vi.restoreAllMocks();vi.useRealTimers();});
async function openSeries(){await act(async()=>root.render(createElement(App)));await tap('hero-play');}
describe('handheld title and search interactions',()=>{
  it('changes seasons with the system select and updates the episode list',async()=>{
    await openSeries();
    const selector=document.querySelector<HTMLSelectElement>('select[aria-label="Season"]')!;
    expect(selector.options.length).toBe(2);
    expect(document.querySelectorAll('.episode-card')).toHaveLength(2);
    await act(async()=>{selector.value='2';selector.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(document.querySelectorAll('.episode-card')).toHaveLength(1);
    expect(button('episode-2-1').textContent).toContain('The way home');
    expect(document.querySelector('[data-focus-id="season-1"]')).toBeNull();
  });
  it('does not offer a redundant selector for a single-season series',async()=>{
    vi.spyOn(ContentSource.prototype,'details').mockResolvedValue({...demoItems[0],seasons:demoItems[0].seasons!.slice(0,1)});
    await openSeries();
    expect(document.querySelector('select[aria-label="Season"]')).toBeNull();
    expect(document.querySelector('[data-focus-id="season-1"]')).toBeNull();
    expect(document.querySelector('.episode-heading-copy')?.textContent).toContain('Season 1');
  });
  it('uses a search input and dismisses it on the system search action',async()=>{
    await act(async()=>root.render(createElement(App)));await tap('nav-search');
    const input=button('search-input') as HTMLInputElement;
    expect(input.type).toBe('search');expect(input.getAttribute('enterkeyhint')).toBe('search');
    input.focus();expect(document.activeElement).toBe(input);
    await act(async()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    expect(document.activeElement).not.toBe(input);
  });
});
