import { afterEach,describe,expect,it,vi } from 'vitest';
import { focus,installRemote } from '../src/core/focus';
let cleanup:(()=>void)|undefined;
afterEach(()=>{cleanup?.();cleanup=undefined;vi.restoreAllMocks();vi.unstubAllGlobals();document.body.innerHTML='';});
function setup(){
  vi.stubGlobal('CSS',{escape:(value:string)=>value});
  document.body.innerHTML=`<div class="app-shell" data-focus-scope="active"><button class="nav-item" aria-current="page" data-focus-id="nav-home">Home</button><main class="main-scroll" data-focus-page="home"><section data-focus-context="true"><h2>Films</h2><div class="shelf-track" data-focus-group="films" data-focus-axis="row">${Array.from({length:300},(_,i)=>`<button data-focus-id="film-${i}">Film ${i}</button>`).join('')}</div></section></main></div>`;
  const rect=vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return {left:100,top:120,width:160,height:260,bottom:380,right:260,x:100,y:120,toJSON(){return {};}};});
  const visible=vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  HTMLElement.prototype.scrollTo=vi.fn();
  cleanup=installRemote(()=>{});focus('film-0');
  window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true}));
  rect.mockClear();visible.mockClear();
  return {rect,visible};
}
describe('remote focus work',()=>{
  it('keeps full-screen detail navigation inside its scope and scrolls a long overview before moving to Done',()=>{
    vi.stubGlobal('CSS',{escape:(value:string)=>value});
    document.body.innerHTML=`<div class="app-shell" data-focus-scope="active"><button data-focus-id="nav-home">Home</button><section class="modal" data-focus-scope="active"><section tabindex="0" data-focus-id="overview" data-focus-group="overview" data-focus-pan="true" data-focus-right-id="fact-0" data-focus-down-id="done">Long overview</section><div data-focus-group="facts" data-focus-axis="column"><div tabindex="0" data-focus-id="fact-0" data-focus-left-id="overview">Year</div></div><button data-focus-id="done">Done</button></section></div>`;
    vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const overview=document.querySelector<HTMLElement>('[data-focus-id="overview"]')!;
    Object.defineProperty(overview,'scrollHeight',{value:1000});Object.defineProperty(overview,'clientHeight',{value:400});
    cleanup=installRemote(()=>{});focus('overview');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',cancelable:true}));
    expect(document.activeElement).toBe(overview);expect(overview.scrollTop).toBe(260);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true}));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('fact-0');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',cancelable:true}));
    expect(document.activeElement).toBe(overview);
    overview.scrollTop=600;
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',cancelable:true}));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('done');
  });
  it('steps inside a large shelf without remeasuring the full catalogue or scrolling it vertically',()=>{
    const {rect,visible}=setup();const scroll=vi.spyOn(document.querySelector('.main-scroll')!,'scrollTo');scroll.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true}));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('film-2');
    expect(visible.mock.calls.length).toBe(0);expect(rect.mock.calls.length).toBeLessThan(8);expect(scroll).not.toHaveBeenCalled();
  });
  it('invalidates focus membership when a card becomes disabled',async()=>{
    setup();document.querySelector('[data-focus-id="film-2"]')!.setAttribute('disabled','');await Promise.resolve();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true}));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('film-3');
  });
  it('blocks remote navigation while a blocking loading overlay is active',()=>{
    setup();const shell=document.querySelector<HTMLElement>('.app-shell')!;const overlay=document.createElement('div');overlay.dataset.focusId='blocking-loader';overlay.tabIndex=-1;shell.append(overlay);shell.dataset.interactionBlocked='true';focus('blocking-loader');const focused=document.activeElement;
    expect(focused).toBe(overlay);
    const event=new KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true});window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);expect(document.activeElement).toBe(focused);
  });
  it('moves right from the last search key into the nearest result',()=>{
    vi.stubGlobal('CSS',{escape:(value:string)=>value});
    document.body.innerHTML=`<div class="app-shell" data-focus-scope="active"><main class="main-scroll" data-focus-page="search"><section class="search-controls"><div class="tv-keyboard" data-focus-group="search-keyboard" data-focus-axis="grid" data-focus-right="search" data-focus-wrap="false"><button data-focus-id="key-s">s</button><button data-focus-id="key-x">x</button></div></section><section class="search-results" data-focus-context="true"><div class="media-grid" data-focus-group="search" data-focus-axis="grid"><button data-focus-id="search-title-1">Title</button></div></section></main></div>`;
    const positions:Record<string,{left:number;top:number;width:number;height:number}>={'key-s':{left:300,top:420,width:44,height:44},'key-x':{left:352,top:420,width:44,height:44},'search-title-1':{left:620,top:260,width:150,height:220}};
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const id=this.dataset.focusId;const rect=id&&positions[id]||{left:0,top:0,width:1920,height:1080};return {...rect,right:rect.left+rect.width,bottom:rect.top+rect.height,x:rect.left,y:rect.top,toJSON(){return {};}} as DOMRect;});
    vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    Object.defineProperty(document.querySelector('[data-focus-id="key-s"]'),'offsetTop',{value:420});
    Object.defineProperty(document.querySelector('[data-focus-id="key-x"]'),'offsetTop',{value:420});
    cleanup=installRemote(()=>{});
    focus('key-x');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',cancelable:true}));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('search-title-1');
  });
  it('scrolls category rows into view as focus moves down',()=>{
    vi.stubGlobal('CSS',{escape:(value:string)=>value});
    document.body.innerHTML=`<div class="app-shell" data-focus-scope="active"><main class="main-scroll" data-focus-page="categories"><div class="category-grid" data-focus-context="true" data-focus-group="categories" data-focus-axis="grid"><button data-focus-id="category-0">One</button><button data-focus-id="category-1">Two</button><button data-focus-id="category-2">Three</button></div></main></div>`;
    const positions:Record<string,{left:number;top:number;width:number;height:number}>={'category-0':{left:100,top:120,width:180,height:100},'category-1':{left:100,top:520,width:180,height:100},'category-2':{left:100,top:920,width:180,height:100}};
    vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const id=this.dataset.focusId,rect=(id&&positions[id])||(this.matches('.category-grid')?{left:80,top:100,width:1200,height:1500}:{left:0,top:0,width:1200,height:600});return {...rect,right:rect.left+rect.width,bottom:rect.top+rect.height,x:rect.left,y:rect.top,toJSON(){return {};}} as DOMRect;});
    vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const scroller=document.querySelector<HTMLElement>('.main-scroll')!;
    Object.defineProperty(scroller,'scrollHeight',{value:1800});Object.defineProperty(scroller,'clientHeight',{value:600});
    for(const [id,top] of Object.entries({"category-0":100,"category-1":500,"category-2":900}))Object.defineProperty(document.querySelector(`[data-focus-id="${id}"]`),'offsetTop',{value:top});
    cleanup=installRemote(()=>{});focus('category-0');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',cancelable:true}));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('category-1');
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });
});
