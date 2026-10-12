import { isTouch } from './device';
export type Direction = 'left'|'right'|'up'|'down';
export interface FocusRect { id:string; left:number; top:number; width:number; height:number }
export function chooseTarget(current:FocusRect,candidates:FocusRect[],direction:Direction):string|undefined {
  const cx=current.left+current.width/2,cy=current.top+current.height/2,horizontal=direction==='left'||direction==='right',sign=direction==='left'||direction==='up'?-1:1;
  return candidates.filter(c=>c.id!==current.id).map(c=>{const dx=c.left+c.width/2-cx,dy=c.top+c.height/2-cy,primary=(horizontal?dx:dy)*sign,secondary=Math.abs(horizontal?dy:dx),overlap=horizontal?Math.min(current.top+current.height,c.top+c.height)-Math.max(current.top,c.top):Math.min(current.left+current.width,c.left+c.width)-Math.max(current.left,c.left);return {id:c.id,primary,score:primary+secondary*3+(overlap>0?0:400)};}).filter(c=>c.primary>8).sort((a,b)=>a.score-b.score)[0]?.id;
}
export function pivotOffset(top:number,size:number,viewport:number,scroll:number,bias=0){return Math.max(0,scroll+top-Math.max(viewport*.12,(viewport-size)/2)+bias);}
export function rowNeighbor(ids:string[],current:string,direction:'left'|'right',wrap=true){const index=ids.indexOf(current),next=index+(direction==='right'?1:-1);return ids[next]||(wrap&&ids.length>1?ids[(next+ids.length)%ids.length]:undefined);}
const remembered=new Map<string,string>();
const groupSelector='[data-focus-group],.chip-row,.action-row,.keyboard-mode,.keyboard-actions,.tv-keyboard,.episode-track,.people-track,.media-grid,.collection-grid,.history-grid,.genre-track,.shelf-track,.player-actions,.quality-options';
const groupCache=new WeakMap<HTMLElement,HTMLElement>();
const groupFor=(el:HTMLElement)=>{let group=groupCache.get(el);if(!group){group=el.closest<HTMLElement>(groupSelector)||el;groupCache.set(el,group);}return group;};
let indexRoot:ParentNode|undefined,indexElements:HTMLElement[]=[],indexDirty=true;
const groupMembers=new Map<HTMLElement,HTMLElement[]>();
function invalidate(){indexDirty=true;}
function indexed(root:ParentNode){
  if(indexDirty||indexRoot!==root){
    indexRoot=root;indexDirty=false;groupMembers.clear();
    indexElements=[...root.querySelectorAll<HTMLElement>('[data-focus-id]')].filter(el=>!el.hasAttribute('disabled')&&el.getClientRects().length>0);
    for(const el of indexElements){const group=groupFor(el),members=groupMembers.get(group)||[];members.push(el);groupMembers.set(group,members);}
  }
  return indexElements;
}
const alignedContext=new WeakMap<HTMLElement,{context:HTMLElement;row:number}>();
let movingFocus=false;
function scope(){const shell=document.querySelector<HTMLElement>('.app-shell');if(shell?.dataset.interactionBlocked==='true')return shell;const scopes=document.querySelectorAll<HTMLElement>('[data-focus-scope="active"]');return scopes[scopes.length-1]||document;}
function enabled(root:ParentNode){return [...root.querySelectorAll<HTMLElement>('[data-focus-id]')].filter(el=>!el.hasAttribute('disabled')&&el.getClientRects().length>0);}
function key(group:HTMLElement){return `${group.closest<HTMLElement>('[data-focus-page]')?.dataset.focusPage||'global'}:${group.dataset.focusMemory||group.dataset.focusGroup||group.querySelector<HTMLElement>('[data-focus-id]')?.dataset.focusId||''}`;}
function align(target:HTMLElement){
  const modal=target.closest<HTMLElement>('.modal');if(modal){const parent=target.closest<HTMLElement>('[data-focus-scroll],.picker-grid');if(parent){const rect=target.getBoundingClientRect(),view=parent.getBoundingClientRect(),inset=Math.max(18,view.height*.12);let top=parent.scrollTop;if(rect.top<view.top+inset)top+=rect.top-view.top-inset;else if(rect.bottom>view.bottom-inset)top+=rect.bottom-view.bottom+inset;parent.scrollTop=Math.max(0,Math.min(parent.scrollHeight-parent.clientHeight,top));}return;}
  const main=target.closest<HTMLElement>('.search-controls,.search-results')||target.closest<HTMLElement>('.main-scroll');if(!main)return;
  const group=groupFor(target),context=target.closest<HTMLElement>('[data-focus-context]')||group;
  const grid=group.matches('.media-grid,.collection-grid,.history-grid,.category-grid'),row=grid?target.offsetTop:0,previous=alignedContext.get(main);
  // Horizontal steps stay in the same vertical context. Align only on section or row changes.
  if(previous?.context!==context||previous.row!==row){
    let rectangle=context.getBoundingClientRect();const view=main.getBoundingClientRect();
    if(rectangle.height>view.height*.82){rectangle=target.getBoundingClientRect();if(grid){const members=groupMembers.get(group)||enabled(group);const rowItems=members.filter(el=>el.offsetTop===target.offsetTop);const height=Math.max(...rowItems.map(el=>el.offsetHeight));rectangle={...pickRect(rectangle),height} as DOMRect;}}
    const bias=Number(context.dataset.focusScrollBias)||0;
    const top=context.dataset.focusTop==='true'?0:pivotOffset(rectangle.top-view.top,rectangle.height,view.height,main.scrollTop,bias);
    if(Math.abs(main.scrollTop-top)>1)main.scrollTop=Math.max(0,Math.min(main.scrollHeight-main.clientHeight,top));
    alignedContext.set(main,{context,row});
  }
  const track=target.closest<HTMLElement>('.shelf-track,.genre-track,.episode-track,.people-track,.library-toolbar,.detail-section .chip-row,.episode-heading .chip-row,.settings-list section>.chip-row,.detail-tabs,.browse-toolbar,.category-kind-tabs');
  if(track){
    const box=track.getBoundingClientRect(),item=target.getBoundingClientRect();
    const inset=12,preferred=Math.max(inset,Math.min(track.clientWidth*.2,160));
    const left=Math.max(0,Math.min(track.scrollWidth-track.clientWidth,track.scrollLeft+item.left-box.left+(item.width-target.offsetWidth)/2-preferred));
    if(Math.abs(track.scrollLeft-left)>1)track.scrollLeft=left;
  }
}
export function focus(id?:string){
  if(isTouch)return;
  const root=scope(),target=id?root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]:not([disabled])`):root.querySelector<HTMLElement>('[data-focus-default]:not([disabled])')||root.querySelector<HTMLElement>('main [data-focus-id]:not([disabled])')||root.querySelector<HTMLElement>('.nav-item[aria-current="page"]')||root.querySelector<HTMLElement>('[data-focus-id]:not([disabled])');
  if(target){movingFocus=true;target.focus({preventScroll:true});movingFocus=false;align(target);}
}
export function restoreFocus(id?:string){
  if(isTouch){delete document.documentElement.dataset.restoringFocus;return;}
  if(!id){focus();return;}document.documentElement.dataset.restoringFocus=id;const started=Date.now();
  const attempt=()=>{const target=scope().querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`);if(target){focus(id);delete document.documentElement.dataset.restoringFocus;return true;}return false;};
  if(attempt())return;const observer=new MutationObserver(()=>{if(attempt()||Date.now()-started>5000){observer.disconnect();delete document.documentElement.dataset.restoringFocus;}});observer.observe(document.body,{childList:true,subtree:true});setTimeout(()=>{observer.disconnect();delete document.documentElement.dataset.restoringFocus;},5000);
}
export function installRemote(onBack:()=>void){
  let lastContent:string|undefined;
  const focusIn=(event:FocusEvent)=>{if(isTouch)return;const el=event.target as HTMLElement;if(!el.dataset.focusId)return;const group=groupFor(el);remembered.set(key(group),el.dataset.focusId);const main=el.closest<HTMLElement>('.main-scroll');if(main){main.dataset.focusedGroup=group.dataset.focusGroup||'';if(!movingFocus)align(el);lastContent=el.dataset.focusId;}};
  const handler=(event:KeyboardEvent)=>{
    if(event.defaultPrevented)return;
    if(isTouch){if(['Escape','BrowserBack','GoBack'].includes(event.key)){event.preventDefault();onBack();}return;}
    if((document.documentElement.dataset.interactionBlocked==='true'||document.querySelector<HTMLElement>('.app-shell')?.dataset.interactionBlocked==='true')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape','BrowserBack','GoBack'].includes(event.key)){event.preventDefault();return;}
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter','Escape'].includes(event.key))document.documentElement.dataset.remoteInputAt=String(Date.now());
    if(['Escape','BrowserBack','GoBack'].includes(event.key)){event.preventDefault();onBack();return;}
    if(event.target instanceof HTMLElement&&event.target.matches('input,textarea')&&!['ArrowUp','ArrowDown'].includes(event.key))return;
    const direction=({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'} as Record<string,Direction>)[event.key];if(!direction)return;
    event.preventDefault();const root=scope(),elements=indexed(root),current=document.activeElement as HTMLElement;if(!elements.includes(current)){focus();return;}
    if(current.dataset.focusPan==='true'&&(direction==='up'||direction==='down')){const maximum=Math.max(0,current.scrollHeight-current.clientHeight),next=Math.max(0,Math.min(maximum,current.scrollTop+(direction==='down'?1:-1)*Math.max(80,current.clientHeight*.65)));if(Math.abs(next-current.scrollTop)>1){current.scrollTop=next;return;}}
    const direct=current.dataset[`focus${direction[0].toUpperCase()}${direction.slice(1)}Id`];if(direct&&elements.some(el=>el.dataset.focusId===direct)){focus(direct);return;}
    const navigation=current.dataset.focusId?.startsWith('nav-'),content=elements.filter(el=>!el.dataset.focusId?.startsWith('nav-'));
    if(navigation){const nav=elements.filter(el=>el.dataset.focusId?.startsWith('nav-'));if(direction==='right'){focus(content.find(el=>el.dataset.focusId===lastContent)?.dataset.focusId||root.querySelector<HTMLElement>('[data-focus-default]:not([disabled])')?.dataset.focusId||content[0]?.dataset.focusId);}else if(direction==='up'||direction==='down'){const next=rowNeighbor(nav.map(el=>el.dataset.focusId!),current.dataset.focusId!,direction==='down'?'right':'left',false);if(next)focus(next);}return;}
    const group=groupFor(current),members=groupMembers.get(group)||[],grid=group.dataset.focusAxis==='grid'||group.matches('.media-grid,.tv-keyboard,.collection-grid,.history-grid')||getComputedStyle(group).flexWrap==='wrap',row=group.dataset.focusAxis==='row'||!grid&&getComputedStyle(group).display==='flex'&&getComputedStyle(group).flexDirection!=='column';
    if(direction==='left'||direction==='right'){
      const sameRow=grid?members.filter(el=>el.offsetTop===current.offsetTop):members;
      const index=sameRow.indexOf(current);
      const atEdge=direction==='left'?index===0:index===sameRow.length-1;
      const bridge=atEdge?group.dataset[direction==='left'?'focusLeft':'focusRight']:undefined;
      if(bridge){
        const destination=root.querySelector<HTMLElement>(`[data-focus-group="${CSS.escape(bridge)}"]`),candidates=destination?groupMembers.get(destination)||[]:[];
        const next=chooseTarget({id:current.dataset.focusId!,...pickRect(current.getBoundingClientRect())},candidates.map(el=>({id:el.dataset.focusId!,...pickRect(el.getBoundingClientRect())})),direction);
        if(next){focus(next);return;}
      }
      if(direction==='left'&&index===0&&root===document.querySelector('.app-shell')){focus(root.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.dataset.focusId||'nav-home');return;}
      if(row||grid){const next=rowNeighbor(sameRow.map(el=>el.dataset.focusId!),current.dataset.focusId!,direction,group.dataset.focusWrap!=='false');if(next)focus(next);return;}
      if(direction==='left')focus(root.querySelector<HTMLElement>('.nav-item[aria-current="page"]')?.dataset.focusId);return;
    }
    const explicit=direction==='down'?group.dataset.focusDown:group.dataset.focusUp;
    const enter=(destination:HTMLElement)=>{const candidates=groupMembers.get(destination)||[];if(!candidates.length)return false;const previous=candidates.find(el=>el.dataset.focusId===remembered.get(key(destination)));if(previous){focus(previous.dataset.focusId);return true;}const firstTop=(direction==='down'?candidates[0]:candidates.at(-1))?.getBoundingClientRect().top;const edge=candidates.filter(el=>Math.abs(el.getBoundingClientRect().top-(firstTop||0))<20);const cx=current.getBoundingClientRect().left+current.getBoundingClientRect().width/2;edge.sort((a,b)=>Math.abs(a.getBoundingClientRect().left+a.getBoundingClientRect().width/2-cx)-Math.abs(b.getBoundingClientRect().left+b.getBoundingClientRect().width/2-cx));if(edge[0]){focus(edge[0].dataset.focusId);return true;}return false;};
    if(!row){const rects=members.map(el=>({id:el.dataset.focusId!,...pickRect(el.getBoundingClientRect())})),next=chooseTarget({id:current.dataset.focusId!,...pickRect(current.getBoundingClientRect())},rects,direction);if(next){focus(next);return;}}
    if(explicit){const destination=root.querySelector<HTMLElement>(`[data-focus-group="${CSS.escape(explicit)}"]`);if(destination&&enter(destination))return;}
    const groups=[...groupMembers.keys()].filter(g=>g!==group&&!g.matches('.nav-item')),rect=group.getBoundingClientRect(),cy=rect.top+rect.height/2,sign=direction==='down'?1:-1;
    const next=groups.map(g=>({g,distance:(g.getBoundingClientRect().top+g.getBoundingClientRect().height/2-cy)*sign})).filter(g=>g.distance>8).sort((a,b)=>a.distance-b.distance)[0]?.g;if(next)enter(next);
  };
  const observer=new MutationObserver(changes=>{if(changes.some(change=>change.type==='attributes'||[...change.addedNodes,...change.removedNodes].some(node=>node instanceof Element)))invalidate();});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','data-focus-id','data-focus-scope']});
  invalidate();window.addEventListener('resize',invalidate);
  window.addEventListener('keydown',handler);document.addEventListener('focusin',focusIn);return()=>{observer.disconnect();window.removeEventListener('resize',invalidate);window.removeEventListener('keydown',handler);document.removeEventListener('focusin',focusIn);};
}
function pickRect(r:DOMRect){return {left:r.left,top:r.top,width:r.width,height:r.height};}
