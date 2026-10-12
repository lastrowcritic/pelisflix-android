import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Check, ChevronDown, ChevronLeft, CircleUserRound, Clock3, Download as DownloadIcon, Film, FolderOpen, Home, Info, Library, LoaderCircle, Play, Plus, Search, Settings as SettingsIcon, Menu, Shapes, Shield, SlidersHorizontal, Tv, X } from 'lucide-react';
import type { Catalogue, Collection, Comment, Download, Item, Kind, Link, Person, Selection, Settings, Source, WatchRecord } from './core/types';
import { ContentSource, normalizeMirror } from './core/source';
import { countryNames } from './core/countries';
import { VerificationRequired } from './core/challenge';
import { clock, continueWatching, episodeKey, latestWatchRecord, loadState, nextEpisode, recordProgress, resumePosition, saveState, type SavedState } from './core/store';
import { focus, installRemote, restoreFocus } from './core/focus';
import { isNative, makeRecord, TV } from './core/native';
import { isTouch } from './core/device';
import * as offline from './core/offline';
import { Row, Card } from './components/Cards';
import { RatingsProvider } from './components/Ratings';
import { categoryPaths, categoryRoot, categorySlug, genreArtwork, kinds, uniqueCategories } from './core/categories';
import { TVButton } from './components/TVButton';
import {mirrorHosts} from './core/pelisflix-policy';
import { collectionLabel, collectionSorts, loadCollectionSort, sortCollections, type CollectionSort } from './core/collections';
import { BrowserPlayer } from './components/BrowserPlayer';
import { UpdateDialog, UpdateSection, useAppUpdate, type AppUpdate } from './components/Updates';
type Route = {type:'home'|'search'|'library'|'settings'|'collections'|'categories'|'browse'|'detail'|'person';item?:Item;path?:string;name?:string;url?:string;categoryKind?:Kind};
type Playing = {item:Item;selection:Selection;source:Source;position:number};
const nav=[{type:'search',name:'Search',icon:Search},{type:'home',name:'Home',icon:Home},{type:'browse',name:'Browse',icon:Film},{type:'categories',name:'Categories',icon:Shapes},{type:'collections',name:'Collections',icon:FolderOpen},{type:'library',name:'Library',icon:Library},{type:'settings',name:'Settings',icon:SettingsIcon}] as const;
function initialState() {const saved=loadState();if(new URLSearchParams(location.search).get('preview')==='1')saved.settings.mode='demo';return saved;}
export default function App() {
  const [state,setState]=useState<SavedState>(initialState),stateRef=useRef(state);stateRef.current=state;
  const [route,setRoute]=useState<Route>({type:'home'}),stack=useRef<{route:Route;focus?:string;scroll:number}[]>([]);
  const [reload,setReload]=useState(0),[touchMenu,setTouchMenu]=useState(false);
  const appUpdate=useAppUpdate();
  const [notice,setNotice]=useState(''),[verification,setVerification]=useState<string>(),[playing,setPlaying]=useState<Playing>(),[starting,setStarting]=useState(false);
  const [initialContentPending,setInitialContentPending]=useState(true),[verificationWorking,setVerificationWorking]=useState(false);
  const holdLoadingPreview=import.meta.env.DEV&&new URLSearchParams(location.search).get('loading')==='1';
  const [savedDownloads,setSavedDownloads]=useState<Download[]>([]),[downloadProgress,setDownloadProgress]=useState<Record<string,number>>({});
  const countryCache=useRef(new Map<string,string[]>()),fileInput=useRef<HTMLInputElement>(null),nativeGeneration=useRef(0),nativeTimer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commit=useCallback((change:(s:SavedState)=>SavedState)=>{setState(previous=>{const updated=change(previous);stateRef.current=updated;try{saveState(updated);}catch{setNotice('Device storage is full. Free some space to save your viewing progress.');}return updated;});},[]);
  const updateSettings=(patch:Partial<Settings>)=>commit(s=>({...s,settings:{...s.settings,...patch}}));
  const source=useMemo(()=>new ContentSource(state.settings,url=>commit(s=>({...s,settings:{...s.settings,mirror:url}}))),[state.settings.mode,state.settings.mirror,commit,reload]);
  useEffect(()=>{
    if(!isNative)return;let running=false;
    const audit=async()=>{if(running||!(await TV.debugStatus()).enabled)return;running=true;const history=structuredClone(stateRef.current.history.filter(r=>r.item.id!=='audit-offline'));try{const {auditLive}=await import('./core/live-audit');await auditLive(new ContentSource({...stateRef.current.settings,mode:'live'}));}finally{await TV.drainProgress();commit(s=>({...s,history}));running=false;}};
    window.addEventListener('rezka-test-live',audit);return()=>window.removeEventListener('rezka-test-live',audit);
  },[commit]);
  const report=useCallback((error:unknown)=>{if(error instanceof VerificationRequired)setVerification(error.url);else setNotice(error instanceof Error?error.message:'Something could not be loaded. Try again.');},[]);
  const go=(next:Route)=>{stack.current.push({route,focus:(document.activeElement as HTMLElement)?.dataset.focusId,scroll:document.querySelector('.main-scroll')?.scrollTop||0});setRoute(next);};
  const switchTab=(type:Route['type'])=>{setTouchMenu(false);stack.current=[];setRoute({type});};
  const backRef=useRef(()=>{});
  backRef.current=()=>{
    if(touchMenu){setTouchMenu(false);return;}
    if(appUpdate.prompt){appUpdate.dismiss();return;}
    if(verification){setVerification(undefined);return;}
    if(notice){clearTimeout(nativeTimer.current);nativeGeneration.current++;setNotice('');return;}
    if(playing){setPlaying(undefined);return;}
    clearTimeout(nativeTimer.current);nativeGeneration.current++;
    const previous=stack.current.pop();
    if(previous){document.documentElement.dataset.restoringFocus=previous.focus||'';setRoute(previous.route);setTimeout(()=>{const scroller=document.querySelector('.main-scroll');if(scroller)scroller.scrollTop=previous.scroll;restoreFocus(previous.focus);},80);}
    else if(route.type!=='home')switchTab('home');
    else {if(isNative)TV.exit();else focus('nav-home');}
  };
  useEffect(()=>installRemote(()=>backRef.current()),[]);
  useEffect(()=>{const restoring=Boolean(document.documentElement.dataset.restoringFocus),screenChoosesFocus=['home','detail','categories','collections'].includes(route.type);const timer=setTimeout(()=>{if(!restoring&&!screenChoosesFocus&&document.querySelector<HTMLElement>('.app-shell')?.dataset.interactionBlocked!=='true')focus();},80);return()=>clearTimeout(timer);},[route.type,route.item?.id,route.url]);
  useEffect(()=>{if(notice||verification){const timer=setTimeout(()=>focus(),30);return()=>clearTimeout(timer);}},[notice,verification]);
  const blockingLoading=initialContentPending||verificationWorking||starting&&isNative||holdLoadingPreview;
  useEffect(()=>{
    if(blockingLoading){document.documentElement.dataset.interactionBlocked='true';document.querySelector<HTMLElement>('[data-focus-id="blocking-loader"]')?.focus({preventScroll:true});return;}
    delete document.documentElement.dataset.interactionBlocked;
    restoreFocus();
    return()=>{delete document.documentElement.dataset.interactionBlocked;};
  },[blockingLoading]);
  useEffect(()=>{document.documentElement.dataset.reducedMotion=String(state.settings.reducedMotion);},[state.settings.reducedMotion]);
  const progress=useCallback((item:Item,selection:Selection,position:number,duration:number)=>commit(s=>({...s,history:recordProgress(s.history,item,selection,position,duration)})),[commit]);
  const rememberAudio=useCallback((item:Item,translator:string)=>commit(s=>s.audioChoices[item.id]===translator?s:{...s,audioChoices:{...s.audioChoices,[item.id]:translator}}),[commit]);
  useEffect(()=>{
    if(!isNative)return;
    const restore=async()=>{try{const {records}=await TV.drainProgress();if(records.length)commit(s=>{let history=s.history;for(const r of records.sort((a,b)=>a.updatedAt-b.updatedAt))history=recordProgress(history,r.item,r,r.position,r.duration);return {...s,history};});}catch(error){report(error);}};
    restore();const listener=()=>{if(!document.hidden)restore();};document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);
  },[commit,report]);
  const refreshDownloads=useCallback(async()=>{try{setSavedDownloads(await offline.downloads());}catch(e){report(e);}},[report]);
  useEffect(()=>{refreshDownloads();},[refreshDownloads]);
  useEffect(()=>{if(!isNative||route.type!=='library')return;const timer=setInterval(refreshDownloads,2000);return()=>clearInterval(timer);},[route.type,refreshDownloads]);
  const visible=useCallback(async(items:Item[])=>{
    const excluded=stateRef.current.settings.excludedCountries;if(!excluded.length)return items;
    const enriched:Item[]=[];
    for(let i=0;i<items.length;i+=4)enriched.push(...await Promise.all(items.slice(i,i+4).map(async item=>{
      if(item.countries?.length)return item;
      let countries=countryCache.current.get(item.id);
      if(!countries){try{countries=(await source.details(item)).countries||[];countryCache.current.set(item.id,countries);}catch{return item;}}
      return {...item,countries};
    })));
    return enriched.filter(i=>!i.countries?.some(c=>excluded.includes(c)));
  },[source,state.settings.excludedCountries.join(',')]);
  const save=(item:Item)=>commit(s=>({...s,favorites:s.favorites.some(i=>i.id===item.id)?s.favorites.filter(i=>i.id!==item.id):[item,...s.favorites]}));
  const open=(item:Item)=>{
    if(item.stream?.startsWith('blob:')||item.stream?.startsWith('rezka-offline:')){
      const download=savedDownloads.find(r=>r.item.id===item.id||`offline-${r.id}`===item.id);
      if(!download){setNotice('This saved video is no longer available. Find another video in Library.');return;}
      item={...item,stream:download.url};
    }
    go({type:'detail',item});
  };
  const start=async(item:Item,selection:Selection,fromBeginning=false)=>{
    if(selection.translator)rememberAudio(item,selection.translator);
    const generation=++nativeGeneration.current;clearTimeout(nativeTimer.current);setStarting(true);
    try {
      const playback=await source.playback(item,selection);if(generation!==nativeGeneration.current)return;
      const position=fromBeginning?0:resumePosition(stateRef.current.history,item,selection);
      if(!isNative){setPlaying({item,selection,source:playback,position});return;}
      const result=await TV.play({source:playback,quality:stateRef.current.settings.quality,position,record:makeRecord(item,selection,position)});
      progress(item,selection,result.ended?result.duration:result.position,result.duration);
      if(result.error)throw new Error(result.error);
      const next=nextEpisode(item,selection);
      if(result.ended&&next&&stateRef.current.settings.autoplay&&generation===nativeGeneration.current){
        setNotice('Next episode starts in five seconds. Press Back to stay on this title.');
        nativeTimer.current=setTimeout(()=>{if(generation===nativeGeneration.current){setNotice('');start(item,next);}},5000);
      }
    }catch(error){report(error);}finally{setStarting(false);}
  };
  const download=async(item:Item,selection:Selection)=>{
    const id=episodeKey(item,selection);if(savedDownloads.some(d=>d.id===id)||downloadProgress[id]!==undefined)return;
    setDownloadProgress(p=>({...p,[id]:0}));
    try{const playback=await source.playback(item,selection),stream=playback.streams.find(s=>s.quality===stateRef.current.settings.quality)||playback.streams[0];
      await offline.saveDownload({id,item,selection,url:stream.url,headers:playback.headers,progress:0,state:'queued'},p=>setDownloadProgress(s=>({...s,[id]:p})));await refreshDownloads();
      setNotice(isNative?'Download added. Check Library for its progress.':'Video saved. Find it in Downloads.');
    }catch(e){report(e);}finally{setDownloadProgress(p=>{const result={...p};delete result[id];return result;});}
  };
  const addFile=async()=>{
    if(!isNative){fileInput.current?.click();return;}
    try{const file=await TV.pickFile();commit(s=>({...s,custom:[{id:`local-${crypto.randomUUID()}`,title:file.name,kind:'movie',genre:'Personal video',synopsis:'Saved on this device.',stream:file.url},...s.custom]}));}catch(e){report(e);}
  };
  const verify=async()=>{if(!verification)return;if(!isNative){setVerification(undefined);setNotice(isTouch?'Complete protected website verification in the Android app.':'Complete protected website verification in the TV app. You can use Preview mode on this Mac to test navigation and playback.');return;}setVerificationWorking(true);try{await TV.verify({url:verification});setVerification(undefined);setReload(r=>r+1);}catch(e){setVerification(undefined);setVerificationWorking(false);report(e);}};
  const pageProps={source,visible,report,open,go,settings:state.settings,audioChoices:state.audioChoices,rememberAudio};
  return <RatingsProvider source={source}><div className="app-shell" data-interaction-blocked={blockingLoading?'true':undefined} data-focus-scope={blockingLoading||!playing&&!verification&&!notice?'active':'inactive'}>
    <aside className="navigation"><div className="brand"><img className="brand-mark" src="/brand-mark.svg" width={38} height={38} alt="Pelisflix"/><span className="brand-name">pelisflix</span></div><div className="nav-items">{nav.map(({type,name,icon:Icon})=><button key={type} data-focus-id={`nav-${type}`} aria-label={name} aria-current={route.type===type?'page':undefined} className={`nav-item ${route.type===type?'selected':''} ${['categories','collections','settings'].includes(type)?'touch-secondary':''}`}  onClick={()=>switchTab(type)}><Icon size={24}/><span>{name}</span></button>)}{isTouch&&<button className={`nav-item touch-more ${['categories','collections','settings'].includes(route.type)?'selected':''}`} aria-label="More" aria-expanded={touchMenu} onClick={()=>setTouchMenu(true)}><Menu size={24}/><span>More</span></button>}</div></aside>
    <main className="main-scroll" data-focus-page={route.type} key={`${route.type}-${route.item?.id||route.url||route.path||''}`}>
      {route.type==='home'&&<HomeScreen {...pageProps} history={state.history} favorites={state.favorites} onContentSettled={()=>{setInitialContentPending(false);setVerificationWorking(false);}}/>}
      {route.type==='search'&&<SearchScreen {...pageProps}/>}
      {route.type==='browse'&&<BrowseScreen {...pageProps} route={route}/>}
      {route.type==='categories'&&<CategoriesScreen {...pageProps}/>}
      {route.type==='collections'&&<CollectionsScreen {...pageProps}/>}
      {route.type==='person'&&<PersonScreen {...pageProps} url={route.url!}/>}
      {route.type==='detail'&&route.item&&<DetailScreen {...pageProps} item={route.item} history={state.history} favorite={state.favorites.some(i=>i.id===route.item!.id)} save={save} start={start} download={download} starting={starting} onBack={()=>backRef.current()}/>}
      {route.type==='library'&&<LibraryScreen state={state} records={savedDownloads} progress={downloadProgress} open={open} go={go} addFile={addFile} remove={async(id)=>{try{await offline.removeDownload(id);await refreshDownloads();}catch(e){report(e);}}} clear={()=>commit(s=>({...s,history:[]}))} commit={commit}/>}
      {route.type==='settings'&&<SettingsScreen settings={state.settings} update={updateSettings} report={report} appUpdate={appUpdate}/>}
    </main>
    {isTouch&&touchMenu&&<div className="modal-backdrop touch-menu-backdrop" onClick={()=>setTouchMenu(false)}><section className="modal touch-menu" role="dialog" aria-modal="true" aria-label="More destinations" onClick={e=>e.stopPropagation()}><div className="picker-heading"><h2>Explore Pelisflix</h2><TVButton id="touch-menu-close" aria-label="Close menu" onClick={()=>setTouchMenu(false)}><X/></TVButton></div>{nav.filter(n=>['categories','collections','settings'].includes(n.type)).map(({type,name,icon:Icon})=><button key={type} className="touch-menu-item" onClick={()=>switchTab(type)}><Icon size={22}/><span>{name}</span></button>)}</section></div>}
    <input ref={fileInput} type="file" hidden accept="video/*" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{await offline.importFile(file);await refreshDownloads();}catch(error){report(error);}e.target.value='';}}/>
    {playing&&<BrowserPlayer key={`${playing.item.id}-${playing.selection.season}-${playing.selection.episode}`} {...playing} quality={state.settings.quality} autoplay={state.settings.autoplay} onProgress={(p,d)=>progress(playing.item,playing.selection,p,d)} onClose={()=>{setPlaying(undefined);setTimeout(()=>focus('detail-play'),80);}} onNext={selection=>{setPlaying(undefined);start(playing.item,selection);}}/>}
    {(notice||verification)&&<div className="modal-backdrop"><section className="modal" data-focus-scope="active" role="dialog" aria-modal="true" aria-labelledby="notice-title"><p className="eyebrow">{verification?'Content source':'Pelisflix'}</p><h2 id="notice-title">{verification?'Website verification':notice.startsWith('Next episode')?'Up next':'Notice'}</h2><p>{verification?'The content source needs you to complete its verification before continuing. Your pending screen can be retried afterward.':notice}</p><div className="action-row">{verification&&<TVButton id="verify" data-focus-default="true" onClick={verify}>Continue verification</TVButton>}<TVButton id="notice-close" data-focus-default={!verification?'true':undefined} onClick={()=>{clearTimeout(nativeTimer.current);nativeGeneration.current++;setNotice('');setVerification(undefined);setTimeout(()=>focus(),0);}}>Close</TVButton>{verification&&<TVButton id="verify-settings" onClick={()=>{setVerification(undefined);switchTab('settings');}}>Choose another mirror</TVButton>}</div></section></div>}
    {!notice&&!verification&&<UpdateDialog update={appUpdate}/>}
    {blockingLoading&&<LoadingOverlay icon={verificationWorking?Shield:Film} title={verificationWorking?'Checking website access':starting?'Preparing your video':'Loading your catalogue'} caption={verificationWorking?'Please wait while titles reconnect.':starting?'Getting your video ready.':'Preparing titles and artwork.'}/>}
  </div></RatingsProvider>;
}
interface PageProps { source:ContentSource; visible:(items:Item[])=>Promise<Item[]>;report:(e:unknown)=>void;open:(item:Item)=>void;go:(route:Route)=>void;settings:Settings;audioChoices:Record<string,string>;rememberAudio:(item:Item,translator:string)=>void }
function PageTitle({title,caption}:{eyebrow?:string;title:string;caption?:string}) {return <header className="page-title"><h1>{title}</h1>{caption&&<p>{caption}</p>}</header>;}
function Loading() {return <div className="loading"><LoaderCircle className="spinner"/><span>Loading titles</span></div>;}
function LoadingOverlay({icon:Icon,title,caption}:{icon:typeof Film;title:string;caption:string}) {return <div className="loading-overlay" data-focus-id="blocking-loader" data-focus-scope="active" tabIndex={-1} role="status" aria-live="polite" aria-busy="true"><div className="loading-card"><span className="loading-icon"><Icon size={26}/></span><LoaderCircle className="spinner loading-spinner" size={28}/><strong>{title}</strong><span className="loading-caption">{caption}</span></div></div>;}
function useInfiniteScroll(enabled:boolean,load:()=>void|Promise<void>) {const sentinel=useRef<HTMLDivElement>(null),loadRef=useRef(load),inFlight=useRef(false);loadRef.current=load;useEffect(()=>{const target=sentinel.current;if(!enabled||!target||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(([entry])=>{if(entry?.isIntersecting&&!inFlight.current){inFlight.current=true;Promise.resolve(loadRef.current()).finally(()=>{inFlight.current=false;});}},{root:document.querySelector<HTMLElement>('.main-scroll'),rootMargin:'600px 0px'});observer.observe(target);return()=>observer.disconnect();},[enabled]);return sentinel;}
function Empty({title,caption,action,onAction}:{title:string;caption:string;action?:string;onAction?:()=>void}) {return <div className="empty-state"><Tv size={48}/><h2>{title}</h2><p>{caption}</p>{action&&<TVButton id="empty-action" onClick={onAction}>{action}</TVButton>}</div>;}
function Grid({items,open,prefix='grid'}:{items:Item[];open:(item:Item)=>void;prefix?:string}) {return <div className="media-grid" data-focus-group={prefix} data-focus-axis="grid">{items.map(item=><Card key={item.id} item={item} id={`${prefix}-${item.id}`} onOpen={()=>open(item)} poster/>)}</div>;}
function useInitialFocus(ready:boolean,id:string){const openedAt=useRef(Date.now()),done=useRef(Boolean(document.documentElement.dataset.restoringFocus));useEffect(()=>{if(isTouch||!ready||done.current||document.querySelector<HTMLElement>('.app-shell')?.dataset.interactionBlocked==='true')return;done.current=true;if(document.documentElement.dataset.restoringFocus)return;if(Number(document.documentElement.dataset.remoteInputAt||0)<=openedAt.current){const main=document.querySelector('.main-scroll');if(main)main.scrollTop=0;focus(id);}},[ready,id]);}
function catalogueModeItem(item:Item,mode:Settings['mode']) {return mode==='demo'?item.id.startsWith('preview-')||!item.page:!item.id.startsWith('preview-');}
function HomeScreen({source,visible,report,open,go,settings,history,favorites,onContentSettled}:PageProps&{history:WatchRecord[];favorites:Item[];onContentSettled:()=>void}) {
  const [catalogue,setCatalogue]=useState<Catalogue>(),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;setFailed(false);setCatalogue(undefined);source.catalogue().then(async data=>({...data,items:await visible(data.items)})).then(async data=>{if(active){setCatalogue(data);onContentSettled();}if(data.items[0]?.page)try{const featured=await source.details(data.items[0]);if(active)setCatalogue({...data,items:[featured,...data.items.slice(1)]});}catch{/* The catalogue remains available if featured details fail. */}}).catch(e=>{if(active){setFailed(true);onContentSettled();report(e);}});return()=>{active=false;};},[source,visible,retry]);
  const saved=favorites.filter(i=>catalogueModeItem(i,settings.mode)),continuing=continueWatching(history.filter(r=>catalogueModeItem(r.item,settings.mode))),kept=new Set([...continuing.map(r=>r.item.id),...saved.map(i=>i.id)]);
  const hero=catalogue?.items.find(i=>!kept.has(i.id))||catalogue?.items[0];
  const discover=catalogue?.items.filter(i=>i.id!==hero?.id&&!kept.has(i.id))||[],eveningCount=discover.length>20?10:6,watchlist=saved.filter(i=>!continuing.some(r=>r.item.id===i.id));
  useInitialFocus(Boolean(hero),'hero-play');
  return <div className="home-screen">
    {hero?<section className="hero" data-focus-context="true" data-focus-top="true"><img className="hero-art" src={hero.backdrop||hero.poster} decoding="async" fetchPriority="high" alt=""/><div className="hero-shade"/><div className="hero-content">{settings.mode==='demo'&&<p className="eyebrow">Preview catalogue</p>}<h1>{hero.title}</h1><div className="hero-meta"><span>{hero.year}</span><span>{hero.genre.split(',')[0]}</span><span>{hero.kind==='series'?'Series':'Film'}</span></div>{hero.synopsis&&<p className="hero-description">{hero.synopsis}</p>}<div className="action-row" data-focus-group="hero" data-focus-axis="row"><TVButton id="hero-play" className="primary" data-focus-default="true" onClick={()=>open(hero)}><Play fill="currentColor" size={19}/>View title</TVButton></div></div></section>:<div className="hero-placeholder"><PageTitle title="Home"/>{!failed?<Loading/>:<div className="action-row"><TVButton id="home-retry" data-focus-default="true" onClick={()=>setRetry(r=>r+1)}>Retry catalogue</TVButton><TVButton id="home-settings" onClick={()=>go({type:'settings'})}>Open Settings</TVButton></div>}</div>}
    <div className="home-shelves">
      {!!continuing.length&&<Row title="Continue watching" items={continuing.map(r=>r.item)} records={continuing} onOpen={open} prefix="continue"/>}
      {catalogue&&<><Row title="Worth your evening" items={discover.slice(0,eveningCount)} onOpen={open} poster prefix="evening"/>
        <Row title="More to discover" items={discover.slice(eveningCount,eveningCount+10)} onOpen={open} prefix="discover"/>
        {!!watchlist.length&&<Row title="Your watchlist" items={watchlist} onOpen={open} poster prefix="watchlist"/>}
        <section className="shelf" data-focus-context="true" data-focus-scroll-bias="36"><div className="shelf-title"><h2>Browse by mood</h2></div><div className="genre-track" data-focus-group="moods" data-focus-axis="row"><TVButton id="genres-all" className="genre-tile genre-all" onClick={()=>go({type:'categories'})}><Shapes size={32}/><span>All categories</span></TVButton>{uniqueCategories(catalogue.categories).slice(0,12).map((c,i)=>{const artwork=genreArtwork(c);return <TVButton id={`genre-${i}`} key={c.url} className="genre-tile" onClick={()=>go({type:'browse',path:c.url,name:c.name})}>{artwork&&<img src={artwork} loading="lazy" decoding="async" fetchPriority="low" alt=""/>}<span>{c.name}</span></TVButton>;})}</div></section>
      </>}
    </div>
  </div>;
}

function SearchScreen({source,visible,report,open}:PageProps) {
  const [query,setQuery]=useState(''),[data,setData]=useState<Catalogue>(),[busy,setBusy]=useState(false),[page,setPage]=useState(1),[cyrillic,setCyrillic]=useState(false);
  useEffect(()=>{let active=true;setPage(1);setData(undefined);setBusy(true);const timer=setTimeout(()=>{(query.trim()?source.search(query):source.catalogue()).then(async d=>({...d,items:await visible(d.items)})).then(d=>{if(active)setData(d);}).catch(e=>{if(active)report(e);}).finally(()=>{if(active)setBusy(false);});},350);return()=>{active=false;clearTimeout(timer);};},[query,source,visible]);
  const more=async()=>{if(busy||!data?.hasNext)return;setBusy(true);try{const d=await (query.trim()?source.search(query,page+1):source.catalogue(undefined,page+1));d.items=await visible(d.items);setData(p=>({...d,items:[...(p?.items||[]),...d.items.filter(i=>!p?.items.some(j=>j.id===i.id))],hasNext:d.items.some(i=>!p?.items.some(j=>j.id===i.id))?d.hasNext:false}));setPage(page+1);}catch(e){report(e);}finally{setBusy(false);}};
  const sentinel=useInfiniteScroll(Boolean(data?.hasNext)&&!busy,more);
  const showTitles=()=>{const first=data?.items[0];if(first)focus(`search-${first.id}`);};
  const letters=(cyrillic?'ABCDEFGHIJKLMNÑOPQRSTUVWXYZÁÉÍÓÚÜ0123456789':'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').split('');
  return <div className="page search-page"><PageTitle title="Search"/><div className="search-layout"><section className="search-controls" data-focus-context="true"><label className="search-field"><Search size={25}/><input data-focus-id="search-input" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search titles" placeholder="Search titles" type={isTouch?'search':'text'} enterKeyHint="search" autoComplete="off" onKeyDown={e=>{if(isTouch&&e.key==='Enter')e.currentTarget.blur();}}/>{isTouch&&busy&&<LoaderCircle className="spinner search-busy" size={20} aria-label="Searching titles"/>}{isTouch&&query&&!busy&&<button className="search-clear" aria-label="Clear search" onClick={()=>setQuery('')}><X size={20}/></button>}</label><div className="keyboard-mode"><TVButton id="keyboard-latin" className={!cyrillic?'active':''} onClick={()=>setCyrillic(false)}>ABC</TVButton><TVButton id="keyboard-cyrillic" className={cyrillic?'active':''} onClick={()=>setCyrillic(true)}>Ñ Á É</TVButton></div><div className={`tv-keyboard${cyrillic?' keyboard-cyrillic':''}`} data-focus-group="search-keyboard" data-focus-axis="grid" data-focus-down="search-actions" data-focus-right="search" data-focus-wrap="false">{letters.map(letter=><TVButton id={`key-${letter}`} key={letter} onClick={()=>setQuery(q=>q+letter)}>{letter.toLowerCase()}</TVButton>)}</div><div className="keyboard-actions" data-focus-group="search-actions" data-focus-axis="row"><TVButton id="key-space" onClick={()=>setQuery(q=>q+' ')}>Space</TVButton><TVButton id="key-delete" onClick={()=>setQuery(q=>q.slice(0,-1))}>Delete</TVButton><TVButton id="key-clear" onClick={()=>setQuery('')}>Clear</TVButton><TVButton id="search-show-titles" disabled={!data?.items.length} onClick={showTitles}>Show titles</TVButton></div></section><section className="search-results" data-focus-context="true"><h2>{query?'Search results':'Explore'}</h2>{busy&&!data?<Loading/>:data?.items.length?<div className="media-grid" data-focus-group="search" data-focus-axis="grid" data-focus-up="search-keyboard" data-focus-left="search-keyboard" data-focus-wrap="false">{data.items.map(item=><Card key={item.id} item={item} id={`search-${item.id}`} onOpen={()=>open(item)} poster/>)}</div>:<Empty title="No titles found" caption="Try a different name or a shorter search."/>}{data?.hasNext&&<div ref={sentinel} className="infinite-sentinel" aria-hidden="true">{busy&&<LoaderCircle className="spinner" size={18}/>}</div>}</section></div></div>;
}
const browseQueries=new Map<string,{data:Catalogue;page:number}>();
const browseViews=new Map<string,{root:string;genre:string;sort:string;data?:Catalogue;page:number}>();
function BrowseScreen({source,visible,report,open,route}:PageProps&{route:Route}) {
  const viewKey=`${source.settings.mode}:${source.settings.mirror}:${route.path||''}:${route.categoryKind||''}`,saved=browseViews.get(viewKey),initialGenre=route.path&&categoryRoot(route.path)&&categorySlug(route.path)!==categoryRoot(route.path)?categorySlug(route.path):'',kindRoot:Record<Kind,string>={movie:'films',series:'series',animation:'cartoons',anime:'animation'};
  const initialRoot=route.categoryKind?`${kindRoot[route.categoryKind]}/`:!initialGenre&&categoryRoot(route.path||'')?`${categoryRoot(route.path!)}/`:'';
  const [root,setRoot]=useState(saved?.root??initialRoot),[genre,setGenre]=useState(saved?.genre??initialGenre),[sort,setSort]=useState(saved?.sort||'last'),[data,setData]=useState<Catalogue|undefined>(saved?.data),[page,setPage]=useState(saved?.page||1),[busy,setBusy]=useState(false),[categories,setCategories]=useState<Link[]>(saved?.data?.categories||[]),[picker,setPicker]=useState<'genre'|'sort'>();
  const collection=route.path&&!categoryRoot(route.path)?route.path:undefined;
  const memory=`browse-${root}-${genre}-${sort}`,genreName=uniqueCategories(categories).find(c=>categorySlug(c.url)===genre)?.name||route.name||'Genre';
  const request=async(number:number)=>{
    const links=categories.length?categories:(await source.catalogue()).categories;
    if(!categories.length)setCategories(links);
    const paths=collection&&root===''&&!genre?[collection]:categoryPaths(links,genre,root);
    if(!paths.length)return {items:[],categories:links as Catalogue['categories'],hasNext:false} as Catalogue;
    const results=await Promise.all(paths.map(path=>source.catalogue(path,number,sort)));
    const items=results.flatMap(r=>r.items).filter((i,index,all)=>all.findIndex(n=>n.id===i.id)===index);
    return {items:await visible(items),categories:links as Catalogue['categories'],hasNext:results.some(r=>r.hasNext)};
  };
  useEffect(()=>{let active=true;const cached=browseQueries.get(`${viewKey}:${memory}`);setData(cached?.data);setPage(cached?.page||1);if(cached){setBusy(false);return;}setBusy(true);
    request(1).then(d=>{if(active){browseQueries.set(`${viewKey}:${memory}`,{data:d,page:1});setData(d);setPage(1);}}).catch(e=>{if(active)report(e);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[source,visible,root,genre,sort]);
  useEffect(()=>{browseViews.set(viewKey,{root,genre,sort,data,page});},[viewKey,root,genre,sort,data,page]);
  useEffect(()=>{if(picker){setTimeout(()=>focus(picker==='genre'?`choose-genre-${genre||'all'}`:`choose-sort-${sort}`),30);}},[picker]);
  useEffect(()=>{if(!picker)return;const handler=(event:KeyboardEvent)=>{if(['Escape','BrowserBack','GoBack'].includes(event.key)){event.preventDefault();event.stopPropagation();const id=picker==='genre'?'browse-genres':'browse-sort';setPicker(undefined);setTimeout(()=>focus(id),30);}};window.addEventListener('keydown',handler,true);return()=>window.removeEventListener('keydown',handler,true);},[picker]);
  const closePicker=()=>{const id=picker==='genre'?'browse-genres':'browse-sort';setPicker(undefined);setTimeout(()=>focus(id),30);};
  const more=async()=>{if(busy||!data?.hasNext)return;setBusy(true);try{const d=await request(page+1);setData(p=>{const added=d.items.filter(i=>!p?.items.some(j=>j.id===i.id)),next={...d,items:[...(p?.items||[]),...added],hasNext:added.length?d.hasNext:false};browseQueries.set(`${viewKey}:${memory}`,{data:next,page:page+1});return next;});setPage(page+1);}catch(e){report(e);}finally{setBusy(false);}};
  const sentinel=useInfiniteScroll(Boolean(data?.hasNext)&&!busy&&!picker,more);
  return <div className="page browse-page"><PageTitle title={collection?route.name||'Catalogue':'Catalogue'}/><div className="browse-controls" data-focus-context="true" data-focus-top="true"><div className="browse-toolbar chip-row" data-focus-group="browse-filters" data-focus-axis="row" data-focus-down="grid">{kinds.map(([path,name])=><TVButton key={path} id={`kind-${name}`} aria-pressed={root===path} className={root===path?'active':''} onClick={()=>setRoot(path)}>{name}</TVButton>)}<TVButton id="browse-genres" className={genre?'active filter-button':'filter-button'} onClick={()=>setPicker('genre')}><Shapes size={18}/>{genre?genreName:'Genres'}</TVButton>{source.settings.mode==='demo'&&<TVButton id="browse-sort" className="filter-button" onClick={()=>setPicker('sort')}><SlidersHorizontal size={18}/>{({last:'Latest',popular:'Popular',watching:'Watching now'} as Record<string,string>)[sort]}</TVButton>}</div></div>
    <div data-focus-memory={memory}>{busy&&!data?<Loading/>:data?.items.length?<div className="media-grid" data-focus-group="grid" data-focus-axis="grid" data-focus-memory={memory} data-focus-up="browse-filters">{data.items.map(item=><Card key={item.id} item={item} id={`grid-${item.id}`} onOpen={()=>open(item)} poster/>)}</div>:<Empty title="No titles to show" caption="Try another genre or content type."/>}</div>
    {data?.hasNext&&<div ref={sentinel} className="infinite-sentinel" aria-hidden="true">{busy&&<LoaderCircle className="spinner" size={18}/>}</div>}
    {picker&&<div className="modal-backdrop"><section className="modal filter-modal" data-focus-scope="active" role="dialog" aria-modal="true"><div className="picker-heading"><h2>{picker==='genre'?'Genres':'Sort titles'}</h2><TVButton id="picker-close" onClick={closePicker} aria-label="Close"><X size={20}/></TVButton></div><div className="picker-grid" data-focus-group="picker" data-focus-axis="grid">{(picker==='genre'?[{name:'All genres',url:''},...uniqueCategories(categories)]:[{name:'Latest',url:'last'},{name:'Popular',url:'popular'},{name:'Watching now',url:'watching'}]).map(c=>{const value=picker==='genre'?categorySlug(c.url):c.url,selected=picker==='genre'?genre===value:sort===value;return <TVButton id={`choose-${picker}-${value||'all'}`} key={value} className={selected?'active':''} aria-pressed={selected} onClick={()=>{if(picker==='genre')setGenre(value);else setSort(value);closePicker();}}>{c.name}{selected&&<Check size={18}/>}</TVButton>;})}</div></section></div>}
  </div>;
}
function CategoriesScreen({source,go,report}:PageProps){
  const [links,setLinks]=useState<Catalogue['categories']>(),[selectedKind,setSelectedKind]=useState<Kind>('movie');
  useEffect(()=>{let active=true;source.catalogue().then(d=>{if(active)setLinks(d.categories);}).catch(report);return()=>{active=false;};},[source,report]);
  const kindOptions: {kind:Kind;label:string;icon:typeof Film}[]=[{kind:'movie',label:'Movies',icon:Film},{kind:'series',label:'TV series',icon:Tv},{kind:'animation',label:'Animation',icon:Shapes},{kind:'anime',label:'Anime',icon:Shapes}];
  const availableKinds=kindOptions.filter(option=>links?.some(category=>category.kind===option.kind));
  const activeKind=availableKinds.some(option=>option.kind===selectedKind)?selectedKind:availableKinds[0]?.kind||'movie';
  const categories=links?uniqueCategories(links.filter(category=>category.kind===activeKind)):[];
  useInitialFocus(Boolean(links?.length),'category-tile-0');
  return <div className="categories-page"><div className="categories-heading"><PageTitle title="Categories"/></div>{!links?<Loading/>:<>
    <div className="categories-tools"><div className="category-kind-tabs" data-focus-group="category-kinds" data-focus-axis="row" data-focus-down="category-grid">{availableKinds.map(({kind,label,icon:Icon})=><TVButton key={kind} id={`category-kind-${kind}`} className={activeKind===kind?'active':''} aria-pressed={activeKind===kind} onClick={()=>setSelectedKind(kind)}><Icon size={19}/>{label}</TVButton>)}</div><span className="category-count">{categories.length} categories</span></div>
    {categories.length?<div className="category-grid" data-focus-context="true" data-focus-group="category-grid" data-focus-axis="grid" data-focus-up="category-kinds">{categories.map((category,index)=>{const artwork=genreArtwork(category);return <TVButton key={category.url} id={`category-tile-${index}`} className="category-card" aria-label={category.name} onClick={()=>go({type:'browse',path:category.url,name:category.name,categoryKind:activeKind})}>{artwork&&<img src={artwork} loading="lazy" decoding="async" fetchPriority="low" alt=""/>}<span>{category.name}</span></TVButton>;})}</div>:<Empty title="No categories to show" caption="Choose another content type."/>}
  </>}</div>;
}

const collectionLimits=new Map<CollectionSort,number>();
function CollectionsScreen({source,report,go}:PageProps) {
  const [items,setItems]=useState<Collection[]>(),[sort,setSort]=useState<CollectionSort>(()=>source.settings.mode==='live'?'name':loadCollectionSort()),[limit,setLimit]=useState(()=>collectionLimits.get(loadCollectionSort())||36),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;setFailed(false);source.collectionIndex().then(data=>{if(active)setItems(data);}).catch(error=>{if(active){setFailed(true);report(error);}});return()=>{active=false;};},[source,retry,report]);
  const ordered=useMemo(()=>sortCollections(items||[],sort),[items,sort]);
  useEffect(()=>{collectionLimits.set(sort,limit);},[sort,limit]);
  const chooseSort=(value:CollectionSort)=>{setSort(value);setLimit(collectionLimits.get(value)||36);try{localStorage.setItem('rezka.collections.sort',value);}catch{}};
  const loadMore=()=>setLimit(value=>Math.min(value+36,ordered.length));
  const sentinel=useInfiniteScroll(Boolean(items&&limit<ordered.length),loadMore);
  useInitialFocus(Boolean(items?.length),'collection-0');
  return <div className="page collections-page"><PageTitle title="Collections"/><div className="collections-toolbar" data-focus-context="true" data-focus-top="true"><div className="chip-row" data-focus-group="collection-sorts" data-focus-axis="row" data-focus-down="collections-grid">{collectionSorts.filter(option=>source.settings.mode==='demo'||option.id==='name').map(option=><TVButton key={option.id} id={`collection-sort-${option.id}`} className={sort===option.id?'active':''} aria-pressed={sort===option.id} onClick={()=>chooseSort(option.id)}>{option.name}</TVButton>)}</div>{items&&<span className="collection-total">{items.length} collections</span>}</div>{!items?(failed?<TVButton id="collections-retry" onClick={()=>setRetry(r=>r+1)}>Retry collections</TVButton>:<div className="loading"><LoaderCircle className="spinner"/><span>Loading collections</span></div>):<div className="collection-grid" data-focus-group="collections-grid" data-focus-axis="grid" data-focus-up="collection-sorts" data-focus-memory={sort}>{ordered.slice(0,limit).map((collection,index)=><button key={collection.url} className="collection-card" data-focus-id={`collection-${index}`} onClick={()=>go({type:'browse',path:collection.url,name:collection.name})}><img src={collection.image||'/artwork/arthouse.jpg'} loading="lazy" decoding="async" fetchPriority="low" alt=""/><div><h2>{collection.name}</h2><p>{collectionLabel(collection.count)}</p></div></button>)}</div>}{items&&limit<ordered.length&&<div ref={sentinel} className="infinite-sentinel" aria-hidden="true"/>}</div>;
}
function PersonScreen({source,visible,report,open,go,url}:PageProps&{url:string}) {
  const [person,setPerson]=useState<Person>();useEffect(()=>{let active=true;source.person(url).then(async p=>({...p,filmography:await visible(p.filmography)})).then(p=>{if(active)setPerson(p);}).catch(report);return()=>{active=false;};},[source,visible,url]);
  return <div className="page">{person?<><div className="person-heading">{person.image&&<img src={person.image} loading="lazy" decoding="async" fetchPriority="low" alt=""/>}<PageTitle eyebrow={person.jobs.join(', ')} title={person.name} caption={[person.originalName,person.birthDate,...person.jobs].filter(Boolean).join(', ')}/></div>{!!person.careers.length&&<div className="chip-row wrap person-careers">{person.careers.map((c,i)=><TVButton key={c.url} id={`career-${i}`} onClick={()=>go({type:'person',url:c.url})}>{c.name}</TVButton>)}</div>}<h2 className="section-heading">Filmography</h2><Grid items={person.filmography} open={open}/></>:<Loading/>}</div>;
}
function DetailScreen({item:initial,source,report,open,go,history,favorite,save,start,download,starting,onBack,audioChoices,rememberAudio}:PageProps&{item:Item;history:WatchRecord[];favorite:boolean;save:(i:Item)=>void;start:(i:Item,s:Selection,beginning?:boolean)=>void;download:(i:Item,s:Selection)=>void;starting:boolean;onBack:()=>void}) {
  const [item,setItem]=useState(initial),[busy,setBusy]=useState(true),[selection,setSelection]=useState<Selection>({}),[tab,setTab]=useState(''),[moreOpen,setMoreOpen]=useState(false),[comments,setComments]=useState<Comment[]>([]),[commentPage,setCommentPage]=useState(1),[commentsMore,setCommentsMore]=useState(false),[commentsBusy,setCommentsBusy]=useState(false);
  const currentSelection=useRef(selection);currentSelection.current=selection;
  const manualSelection=useRef(false),lastRecord=latestWatchRecord(history,initial.id);
  useInitialFocus(!busy,initial.stream||selection.translator&&(!item.isSeries||selection.episode)?'detail-play':'detail-save');
  useEffect(()=>{let active=true;setBusy(true);source.details(initial).then(async detailed=>{
    const translators=detailed.translators?.filter(t=>!t.premium)||[],savedTranslator=audioChoices[initial.id]||lastRecord?.translator;
    const translator=translators.find(t=>t.id===savedTranslator)?.id||translators.find(t=>t.selected)?.id||translators[0]?.id;
    const sourceTranslator=translators.find(t=>t.selected)?.id;
    if(detailed.isSeries&&translator&&(translator!==sourceTranslator||!detailed.seasons?.some(s=>s.episodes.length))){detailed={...detailed,seasons:await source.episodes(detailed,translator)};}
    const season=detailed.seasons?.find(s=>s.id===lastRecord?.season)||detailed.seasons?.[0],episode=season?.episodes.find(e=>e.id===lastRecord?.episode)||season?.episodes[0];
    if(active){setItem(detailed);setSelection({translator,season:season?.id,episode:episode?.id});}
  }).catch(report).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[initial.id,source]);
  useEffect(()=>{
    if(busy||manualSelection.current||!item.isSeries||!lastRecord)return;
    const translators=item.translators?.filter(t=>!t.premium)||[],preferred=audioChoices[initial.id]||lastRecord.translator;
    const translator=translators.find(t=>t.id===preferred)?.id||selection.translator;
    if(!translator)return;
    const matchingSeason=item.seasons?.find(s=>s.id===lastRecord.season),matchingEpisode=matchingSeason?.episodes.find(e=>e.id===lastRecord.episode);
    const alreadyRestored=selection.translator===translator&&selection.season===matchingSeason?.id&&selection.episode===matchingEpisode?.id;
    if(alreadyRestored)return;
    let active=true;
    const restore=async()=>{
      let seasons=item.seasons;
      if(translator!==selection.translator||!matchingEpisode)seasons=await source.episodes(item,translator);
      if(!active||manualSelection.current)return;
      const season=seasons?.find(s=>s.id===lastRecord.season)||seasons?.[0],episode=season?.episodes.find(e=>e.id===lastRecord.episode)||season?.episodes[0];
      if(seasons!==item.seasons)setItem(previous=>({...previous,seasons}));
      setSelection({translator,season:season?.id,episode:episode?.id});
    };
    restore().catch(report);
    return()=>{active=false;};
  },[audioChoices[initial.id],busy,history.length,lastRecord?.updatedAt,item.id,item.isSeries,item.seasons,item.translators,selection.translator,selection.season,selection.episode,source]);
  useEffect(()=>{if(tab!=='Comments')return;let active=true;setCommentsBusy(true);source.comments(item,1).then(d=>{if(active){setComments(d.comments);setCommentsMore(d.hasNext);setCommentPage(1);}}).catch(report).finally(()=>{if(active)setCommentsBusy(false);});return()=>{active=false;};},[tab,item.id]);
  useEffect(()=>{if(!moreOpen)return;const closeOnBack=(event:KeyboardEvent)=>{if(['Escape','BrowserBack','GoBack'].includes(event.key)){event.preventDefault();event.stopPropagation();setMoreOpen(false);setTimeout(()=>focus('detail-more-open'),30);}};window.addEventListener('keydown',closeOnBack,true);const timer=setTimeout(()=>focus('detail-more-overview'),30);return()=>{window.removeEventListener('keydown',closeOnBack,true);clearTimeout(timer);};},[moreOpen]);
  const chooseTranslator=async(translator:string)=>{manualSelection.current=true;rememberAudio(item,translator);setBusy(true);try{const seasons=item.isSeries?await source.episodes(item,translator):item.seasons;setItem(p=>({...p,seasons}));const current=currentSelection.current,season=seasons?.find(s=>s.id===current.season)||seasons?.[0],episode=season?.episodes.find(e=>e.id===current.episode)||season?.episodes[0];setSelection({translator,season:season?.id,episode:episode?.id});}catch(e){report(e);}finally{setBusy(false);setTimeout(()=>focus(`translator-${translator}`),40);}};
  const position=resumePosition(history,item,selection),hasResume=position>=1,record=history.find(r=>episodeKey(r.item,r)===episodeKey(item,selection)),season=item.seasons?.find(s=>s.id===selection.season);
  const continueLabel=selection.season?`Continue S${selection.season} E${selection.episode} at ${clock(position)}`:`Continue at ${clock(position)}`;
  const tabs=[...(item.actors?.length||item.directors?.length?['Cast']:[]),...(item.schedule?.length?['Schedule']:[]),];
  const playable=Boolean(item.stream||selection.translator&&(!item.isSeries||selection.episode));
  const canDownload=!item.stream||item.stream.startsWith('/')||/^https?:/i.test(item.stream);
  const audioSection=!!item.translators?.filter(t=>!t.premium).length&&<section className="detail-section audio-section" data-focus-context="true" aria-busy={busy||undefined}><h2>Audio</h2><div className="chip-row wrap" data-focus-group={`detail-audio-${item.id}`} data-focus-axis="row">{item.translators!.filter(t=>!t.premium).map(t=><TVButton key={t.id} id={`translator-${t.id}`} aria-pressed={selection.translator===t.id} className={selection.translator===t.id?'active':''} disabled={busy} onClick={()=>chooseTranslator(t.id)}>{t.name}</TVButton>)}</div></section>;
  const episodeSection=item.isSeries&&<section className="detail-section episodes-section" data-focus-context="true" aria-busy={busy||undefined}>
    <div className="episode-heading"><div className="episode-heading-copy"><h2>Episodes</h2>{season&&<p>{!isTouch?season.title||`Season ${season.id}`:item.seasons?.length===1?`Season ${season.id}`:null}<span>{season.episodes.length} episodes</span></p>}</div><>{isTouch?(item.seasons&&item.seasons.length>1&&<label className="touch-season-picker"><select aria-label="Season" value={selection.season||''} disabled={busy} onChange={event=>{const chosen=item.seasons?.find(s=>s.id===event.target.value);if(chosen){manualSelection.current=true;setSelection(p=>({...p,season:chosen.id,episode:chosen.episodes[0]?.id}));}}}>{item.seasons.map(s=><option key={s.id} value={s.id}>Season {s.id}</option>)}</select><ChevronDown size={18} aria-hidden="true"/></label>):<div className="chip-row" data-focus-group={`detail-seasons-${item.id}`} data-focus-axis="row">{item.seasons?.map(s=><TVButton key={s.id} id={`season-${s.id}`} aria-pressed={s.id===selection.season} className={s.id===selection.season?'active':''} disabled={busy} onClick={()=>{manualSelection.current=true;setSelection(p=>({...p,season:s.id,episode:s.episodes[0]?.id}));}}>Season {s.id}</TVButton>)}</div>}</></div>
    {busy?<div className="episode-loading"><LoaderCircle className="spinner" size={19}/><span>Loading episodes</span></div>:!season?.episodes.length?<p className="episode-empty">Episodes are not available for this audio choice.</p>:<div className="episode-track" data-focus-group={`detail-episodes-${item.id}`} data-focus-axis="row">{season?.episodes.map(e=>{
      const r=history.find(entry=>episodeKey(entry.item,entry)===episodeKey(item,{season:e.season,episode:e.id})),selected=selection.season===e.season&&selection.episode===e.id;
      const status=r?.completed?'Watched':r&&r.position>=1?`Continue at ${clock(r.position)}${r.duration?` of ${clock(r.duration)}`:''}`:'';
      const action=r&&r.position>=1&&!r.completed?`Continue season ${e.season}, episode ${e.id} at ${clock(r.position)}`:`Play season ${e.season}, episode ${e.id}: ${e.title||`episode ${e.id}`}`;
      return <button key={`${e.season}-${e.id}`} data-focus-id={`episode-${e.season}-${e.id}`} aria-label={action} aria-pressed={selected} disabled={busy} className={`episode-card ${selected?'active':''} ${r&&r.position>=1&&!r.completed?'in-progress':''}`} onClick={()=>{manualSelection.current=true;const next={...selection,season:e.season,episode:e.id};setSelection(next);start(item,next);}}>
        <div className="episode-art">{(item.backdrop||item.poster)&&<img src={e.image||item.backdrop||item.poster} loading="lazy" decoding="async" fetchPriority="low" alt=""/>}<span className="episode-number">{e.id.padStart(2,'0')}</span>{r&&<div className="watch-progress"><span style={{width:`${r.completed?100:r.duration?Math.min(100,r.position/r.duration*100):0}%`}}/></div>}</div>
        <div className="episode-copy"><strong>{e.title||`Episode ${e.id}`}</strong>{status&&<span>{status}</span>}</div>
      </button>;
    })}</div>}
  </section>;
  const formatLabel=item.isSeries?'Series':item.kind==='anime'?'Anime film':item.kind==='animation'?'Animated film':'Film';
  const resumePercent=record?.duration?Math.min(100,Math.max(0,position/record.duration*100)):0;
  const detailFacts:Array<[string,string]>=[
    ['Format',formatLabel],
    ...(item.year?[["Year",String(item.year)] as [string,string]]:[]),
    ...(item.genre?[["Genre",item.genre] as [string,string]]:[]),
    ...(item.isSeries&&item.seasons?.length?[["Seasons",String(item.seasons.length)] as [string,string]]:[]),
    ...(!item.isSeries&&item.duration?[["Runtime",`${item.duration} minutes`] as [string,string]]:[])
  ];
  const informationFacts=Object.entries(item.information||{}).filter(([label])=>!['Рейтинги','Жанр','Ratings','Genre','IMDb rating'].includes(label));
  const relatedGroups=[...(item.collections?.length?['detail-more-collections']:[]),...(item.franchise?.length?['detail-more-franchise']:[]),...(item.rankings?.length?['detail-more-rankings']:[])];
  const nextDetailsGroup=(group:string)=>relatedGroups[relatedGroups.indexOf(group)+1]||'detail-more-footer';
  const previousDetailsGroup=(group:string)=>relatedGroups[relatedGroups.indexOf(group)-1]||'detail-more-facts';
  const description=item.synopsis||'Choose your audio and start watching.';
  const closeMore=()=>{setMoreOpen(false);setTimeout(()=>focus('detail-more-open'),30);};
  return <div className="detail-screen">
    <section className="detail-hero" data-focus-context="true" data-focus-top="true">
      <img className="hero-art" src={item.backdrop||item.poster} decoding="async" fetchPriority="high" alt=""/>
      <div className="hero-shade"/>
      <div className="detail-content">
        <TVButton id="detail-back" className="back-button" onClick={onBack}><ChevronLeft size={20}/>Back</TVButton>
        <h1>{item.title}</h1>
        {item.originalTitle&&<p className="original-title">{item.originalTitle}</p>}
        <div className="hero-meta">
          <span className="title-format">{item.isSeries?<Tv size={16}/>:<Film size={16}/>} {formatLabel}</span>
          {item.year&&<span>{item.year}</span>}
          {item.genre&&<span>{item.genre.split(',').slice(0,2).join(', ')}</span>}
          {item.isSeries&&item.seasons?.length?<span>{item.seasons.length} {item.seasons.length===1?'season':'seasons'}</span>:!item.isSeries&&item.duration?<span>{item.duration} min</span>:null}
          {item.rating&&<span className="rating">IMDb {item.rating}</span>}
        </div>
        <p className="hero-description">{description}</p>
        <div className="action-row" data-focus-group={`detail-actions-${item.id}`} data-focus-axis="row" data-focus-down={item.isSeries?`detail-episodes-${item.id}`:`detail-audio-${item.id}`}>
          <TVButton id="detail-play" className="primary" aria-label={hasResume?continueLabel:undefined} data-focus-default="true" disabled={busy||starting||!playable} onClick={()=>start(item,selection)}>{busy||starting?<LoaderCircle className="spinner" size={20}/>:<Play fill="currentColor" size={20}/>}{busy?'Loading details':!playable?'Not available':hasResume?'Continue':record?.completed?'Watch again':'Play'}</TVButton>
          <TVButton id="detail-save" onClick={()=>save(item)}>{favorite?<Check/>:<Plus/>}{favorite?'In your watchlist':'Add to watchlist'}</TVButton>
          {canDownload&&<TVButton id="detail-download" disabled={busy||!playable} onClick={()=>download(item,selection)}><DownloadIcon/>Download</TVButton>}
          {hasResume&&<TVButton id="detail-restart" aria-label="Start from the beginning" disabled={busy} onClick={()=>start(item,selection,true)}>Restart</TVButton>}
          <TVButton id="detail-more-open" onClick={()=>setMoreOpen(true)}><Info size={19}/>More details</TVButton>
        </div>
        {hasResume&&<div className="resume-status"><p className="resume-caption"><Clock3 size={16}/><span>{selection.season?`Season ${selection.season}, episode ${selection.episode}`:'Saved position'}</span><strong>{clock(position)}{record?.duration?` of ${clock(record.duration)}`:''}</strong></p>{record?.duration&&record.duration>0&&<div className="resume-progress" aria-hidden="true"><span style={{width:`${resumePercent}%`}}/></div>}</div>}
      </div>
    </section>
    <div className="detail-body">
      {item.isSeries?episodeSection:audioSection}
      {item.isSeries&&audioSection}
      {tabs.length>0&&<div className="detail-tabs chip-row">{tabs.map(t=><TVButton key={t} id={`detail-tab-${t}`} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</TVButton>)}</div>}
      {tab==='Cast'&&<section className="detail-section" data-focus-context="true"><h2>Cast and crew</h2><div className="people-track">{[...(item.directors||[]),...(item.actors||[])].map((p,i)=><button key={`${p.url}-${i}`} data-focus-id={`person-${i}`} className="person-card" onClick={()=>go({type:'person',url:p.url})}>{p.image?<img src={p.image} loading="lazy" decoding="async" fetchPriority="low" alt=""/>:<CircleUserRound size={64}/>}<strong>{p.name}</strong><span>{item.directors?.some(d=>d.url===p.url)?'Director':'Cast'}</span></button>)}</div></section>}
      {tab==='Schedule'&&item.schedule?.map((s,i)=><section key={i} className="detail-section" data-focus-context="true" data-focus-group={`schedule-${i}`} data-focus-axis="column"><h2>{s.title||'Release schedule'}</h2><table className="schedule-table"><thead><tr><th>Episode</th><th>Title</th><th>Release date</th></tr></thead><tbody>{s.rows.map((r,j)=><tr key={j} tabIndex={0} data-focus-id={`schedule-${i}-${j}`}><td>{r.episode}</td><td>{r.title}</td><td>{r.date}</td></tr>)}</tbody></table></section>)}
      {tab==='Comments'&&<section className="detail-section" data-focus-context="true"><h2>Comments</h2>{commentsBusy&&!comments.length?<Loading/>:!comments.length?<p className="secondary">No comments available for this title.</p>:<div className="comment-list">{comments.map(c=><article key={c.id} tabIndex={0} data-focus-id={`comment-${c.id}`} className="comment" style={{marginLeft:Math.min(c.indent,3)*24}}><header><strong>{c.author}</strong><span>{c.date}</span></header><p>{c.text}</p><span>{c.likes?`${c.likes} likes`:''}</span></article>)}</div>}{commentsMore&&<TVButton id="comments-more" onClick={async()=>{setCommentsBusy(true);try{const d=await source.comments(item,commentPage+1);setComments(c=>[...c,...d.comments.filter(n=>!c.some(r=>r.id===n.id))]);setCommentPage(p=>p+1);setCommentsMore(d.hasNext&&d.comments.length>0);}catch(e){report(e);}finally{setCommentsBusy(false);}}}>More comments</TVButton>}</section>}
    </div>
    {moreOpen&&<div className="modal-backdrop detail-more-backdrop"><section className="modal detail-more-modal" data-focus-scope="active" role="dialog" aria-modal="true" aria-labelledby="detail-more-title">
      <header className="detail-more-header"><div><p className="eyebrow">Title details</p><h2 id="detail-more-title">{item.title}</h2>{item.originalTitle&&<p className="detail-more-original">{item.originalTitle}</p>}</div></header>
      <div className="detail-more-layout">
        <section className="detail-more-summary" tabIndex={0} data-focus-id="detail-more-overview" data-focus-default="true" data-focus-group="detail-more-overview" data-focus-axis="column" data-focus-pan="true" data-focus-right-id="detail-fact-0" data-focus-down-id="detail-more-done" aria-label="Overview"><h3>Overview</h3><p>{item.synopsis||'No description is available for this title.'}</p></section>
        <div className="detail-more-scroll" data-focus-scroll="true" data-focus-context="true" aria-label="Title information">
          {!!item.ratings?.length&&<section className="detail-more-ratings"><h3>Ratings</h3><div className="ratings-row">{item.ratings.map(r=><span key={r.name}>{r.name}{' '}<strong>{r.value}</strong></span>)}</div></section>}
          <section><h3>Details</h3><div className="detail-facts" data-focus-group="detail-more-facts" data-focus-axis="column" data-focus-down={relatedGroups[0]||'detail-more-footer'}>{detailFacts.map(([label,value],i)=><div key={label} tabIndex={0} data-focus-id={`detail-fact-${i}`} data-focus-left-id="detail-more-overview"><span>{label}</span><strong>{value}</strong></div>)}{informationFacts.map(([label,value],i)=><div key={label} tabIndex={0} data-focus-id={`detail-info-${i}`} data-focus-left-id="detail-more-overview"><span>{label}</span><strong>{value}</strong></div>)}</div></section>
          {!!item.collections?.length&&<section className="detail-more-related"><h3>Collections</h3><div className="chip-row wrap" data-focus-group="detail-more-collections" data-focus-axis="grid" data-focus-left="detail-more-overview" data-focus-up={previousDetailsGroup('detail-more-collections')} data-focus-down={nextDetailsGroup('detail-more-collections')}>{item.collections.map((link,i)=><TVButton key={link.url} id={`detail-collection-${i}`} onClick={()=>go({type:'browse',path:link.url,name:link.name})}>{link.name}</TVButton>)}</div></section>}
          {!!item.franchise?.length&&<section className="detail-more-related"><h3>{item.franchiseTitle||'More in this story'}</h3><div className="chip-row wrap" data-focus-group="detail-more-franchise" data-focus-axis="grid" data-focus-left="detail-more-overview" data-focus-up={previousDetailsGroup('detail-more-franchise')} data-focus-down={nextDetailsGroup('detail-more-franchise')}>{item.franchise.map((link,i)=><TVButton key={link.url} id={`franchise-${i}`} onClick={()=>open({id:new URL(link.url).pathname.match(/\/(\d+)-/)?.[1]||link.url,title:link.name,kind:item.kind,page:link.url,genre:'',synopsis:''})}>{link.name}</TVButton>)}</div></section>}
          {!!item.rankings?.length&&<section className="detail-more-related"><h3>Featured lists</h3><div className="chip-row wrap" data-focus-group="detail-more-rankings" data-focus-axis="grid" data-focus-left="detail-more-overview" data-focus-up={previousDetailsGroup('detail-more-rankings')} data-focus-down={nextDetailsGroup('detail-more-rankings')}>{item.rankings.map((link,i)=><TVButton key={link.url} id={`ranking-${i}`} onClick={()=>go({type:'browse',path:link.url,name:link.name})}>{link.name}</TVButton>)}</div></section>}
        </div>
      </div>
      <footer className="detail-more-footer" data-focus-group="detail-more-footer" data-focus-axis="row" data-focus-up={relatedGroups.at(-1)||'detail-more-facts'}><TVButton id="detail-more-done" onClick={closeMore}>Done</TVButton></footer>
    </section></div>}
  </div>;
}
function LibraryScreen({state,records,progress,open,go,addFile,remove,clear,commit}:{state:SavedState;records:Download[];progress:Record<string,number>;open:(i:Item)=>void;go:(r:Route)=>void;addFile:()=>void;remove:(id:string)=>void;clear:()=>void;commit:(change:(s:SavedState)=>SavedState)=>void}) {
  const [tab,setTab]=useState('Watchlist'),[addLink,setAddLink]=useState(false),[link,setLink]=useState(''),[name,setName]=useState(''),[confirmClear,setConfirmClear]=useState(false),[linkError,setLinkError]=useState('');
  const favorites=state.favorites.filter(i=>catalogueModeItem(i,state.settings.mode)),downloads=records.filter(r=>catalogueModeItem(r.item,state.settings.mode));
  const history=state.history.filter((r,i,all)=>catalogueModeItem(r.item,state.settings.mode)&&all.findIndex(j=>j.item.id===r.item.id)===i);
  const custom=[...state.custom,...records.filter(r=>r.id.startsWith('local-')).map(r=>({...r.item,stream:r.url}))];
  return <div className="page"><PageTitle title="Library"/><div className="library-toolbar" data-focus-group="library-toolbar" data-focus-axis="row"><div className="library-tabs">{['Watchlist','History','Downloads','Personal videos'].map(t=><TVButton key={t} id={`library-${t}`} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</TVButton>)}</div>{tab==='History'&&history.length>0&&<TVButton id="clear-history" onClick={()=>setConfirmClear(true)}>Clear history</TVButton>}{tab==='Personal videos'&&<div className="library-actions"><TVButton id="add-file" onClick={addFile}><FolderOpen/>Add video file</TVButton><TVButton id="add-link" onClick={()=>setAddLink(!addLink)}><Plus/>Add video link</TVButton></div>}</div>
    {confirmClear&&<div className="inline-confirm" data-focus-group="clear-confirmation" data-focus-axis="row"><p>Clear all saved viewing positions and episode history?</p><TVButton id="confirm-clear" onClick={()=>{clear();setConfirmClear(false);}}>Clear all history</TVButton><TVButton id="cancel-clear" onClick={()=>setConfirmClear(false)}>Keep history</TVButton></div>}
    {addLink&&<form className="add-link-form" data-focus-group="personal-form" data-focus-axis="column" onSubmit={e=>{e.preventDefault();try{const url=new URL(link);if(!['https:','http:'].includes(url.protocol))throw new Error();commit(s=>({...s,custom:[{id:`personal-${crypto.randomUUID()}`,title:name.trim()||'Personal video',kind:'movie',genre:'Personal video',synopsis:'Your own video link.',stream:url.href},...s.custom]}));setAddLink(false);setLink('');setName('');setLinkError('');}catch{setLinkError('Enter a valid video address.');}}}><label>Video name<input data-focus-id="link-name" value={name} onChange={e=>setName(e.target.value)} placeholder="A name you will recognize"/></label><label>Video address<input data-focus-id="link-url" value={link} onChange={e=>setLink(e.target.value)} placeholder="Paste a video link"/></label><TVButton id="link-save" type="submit">Save video</TVButton>{linkError&&<p>{linkError}</p>}</form>}
    {tab==='Watchlist'&&(favorites.length?<Grid items={favorites} open={open}/>:<Empty title="Your watchlist is empty" caption="Add a title to your watchlist from its detail page." action="Explore titles" onAction={()=>go({type:'browse'})}/>)}
    {tab==='History'&&(history.length?<div className="history-grid">{history.map(r=><div key={r.item.id}><Card item={r.item} id={`history-${r.item.id}`} record={r} onOpen={()=>open(r.item)}/><p className="history-date">{r.completed?'Finished watching':`Saved at ${clock(r.position)}`}<br/>{new Date(r.updatedAt).toLocaleDateString(undefined,{month:'long',day:'numeric'})}</p></div>)}</div>:<Empty title="No viewing history" caption="Play a title and your viewing history will appear here." action="Browse titles" onAction={()=>go({type:'browse'})}/>)}
    {tab==='Downloads'&&<>{Object.entries(progress).map(([id,p])=><div key={id} className="download-pending"><LoaderCircle className="spinner"/><span>Saving video</span><span>{Math.round(p*100)} percent</span></div>)}{downloads.filter(r=>!r.id.startsWith('local-')).length?<div className="downloads-grid" data-focus-group="downloads" data-focus-axis="grid">{downloads.filter(r=>!r.id.startsWith('local-')).map(r=><article key={r.id} className="download-card" data-focus-context="true"><Card item={{...r.item,stream:r.url,page:undefined}} id={`download-${r.id}`} onOpen={()=>{if(r.state==='completed')open({...r.item,id:`offline-${r.id}`,title:r.selection.season?`${r.item.title}, season ${r.selection.season} episode ${r.selection.episode}`:r.item.title,stream:r.url,page:undefined,kind:'movie',isSeries:false,seasons:[],translators:r.item.translators?.filter(t=>t.id===r.selection.translator).map(t=>({...t,selected:true}))});}}/><p>{r.state==='completed'?'Available offline':r.state==='failed'?'Download failed':`Downloading. ${Math.round(r.progress*100)} percent`}</p><TVButton id={`remove-${r.id}`} onClick={()=>remove(r.id)}>Remove download</TVButton></article>)}</div>:!Object.keys(progress).length&&<Empty title="No saved videos" caption="Download a film or episode from its detail page to watch without a connection." action="Explore titles" onAction={()=>go({type:'browse'})}/>}</>}
    {tab==='Personal videos'&&(custom.length?<><Grid items={custom} open={open} prefix="personal"/><div className="personal-removals" data-focus-group="personal-removals" data-focus-axis="grid">{custom.map(i=><TVButton id={`personal-remove-${i.id}`} key={i.id} onClick={()=>{if(i.id.startsWith('local-')&&!isNative)remove(i.id);else commit(s=>({...s,custom:s.custom.filter(c=>c.id!==i.id)}));}}>Remove {i.title}</TVButton>)}</div></>:<Empty title="Add personal videos" caption={isTouch?"Add a video link or import a file to watch on this device.":"Add a video link or import a file to watch it on the big screen."} action="Add video file" onAction={addFile}/>)}
  </div>;
}
function SettingsScreen({settings,update,report,appUpdate}:{settings:Settings;update:(p:Partial<Settings>)=>void;report:(e:unknown)=>void;appUpdate:AppUpdate}) {
  const [mirror,setMirror]=useState(settings.mirror),[countryQuery,setCountryQuery]=useState(''),[countryExpanded,setCountryExpanded]=useState(false);
  const countries=Object.entries(countryNames).filter(([code,name])=>settings.excludedCountries.includes(code)||countryQuery&&name.toLowerCase().includes(countryQuery.toLowerCase())).sort((a,b)=>a[1].localeCompare(b[1])).slice(0,40);
  return <div className="page settings-page"><div className="settings-list">
    <section data-focus-context="true" data-focus-top="true"><PageTitle title="Settings"/><h2>Catalogue</h2><div className="setting-row"><div><h3>Catalogue mode</h3></div><div className="chip-row" data-focus-group="settings-mode" data-focus-axis="row"><TVButton id="mode-live" className={settings.mode==='live'?'active':''} onClick={()=>update({mode:'live'})}>Live catalogue</TVButton><TVButton id="mode-demo" className={settings.mode==='demo'?'active':''} onClick={()=>update({mode:'demo'})}>Preview</TVButton></div></div></section>
    <section data-focus-context="true"><h2>Mirror domain</h2><form className="mirror-form" onSubmit={e=>{e.preventDefault();try{const value=normalizeMirror(mirror);update({mirror:value});setMirror(value);}catch(error){report(error);}}}><p>Choose a source that works on your network.</p><div className="mirror-input" data-focus-group="settings-mirror" data-focus-axis="row"><input onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();focus('mirror-save');}}} id="mirror" data-focus-id="mirror-input" value={mirror} onChange={e=>setMirror(e.target.value)} aria-label="Mirror domain"/><TVButton id="mirror-save" type="submit">Apply</TVButton></div></form><div className="chip-row" data-focus-group="settings-mirrors" data-focus-axis="row">{mirrorHosts.map(host=><TVButton id={`mirror-${host}`} key={host} onClick={()=>{const value=normalizeMirror(host);setMirror(value);update({mirror:value});}}>{host}</TVButton>)}</div></section>
    <UpdateSection update={appUpdate}/>
    <section data-focus-context="true"><h2>Playback</h2><div className="setting-row" data-focus-group="settings-autoplay" data-focus-axis="row"><div><h3>Play the next episode</h3><p>Continue after a five second countdown.</p></div><TVButton id="autoplay" aria-pressed={settings.autoplay} className="toggle-button" onClick={()=>update({autoplay:!settings.autoplay})}><span className={`switch ${settings.autoplay?'on':''}`}/>{settings.autoplay?'On':'Off'}</TVButton></div><div className="setting-row"><div><h3>Preferred quality</h3><p>The best available quality is used if this one is unavailable.</p></div><div className="chip-row">{['720p','1080p','2160p'].map(q=><TVButton id={`preferred-${q}`} key={q} className={q===settings.quality?'active':''} onClick={()=>update({quality:q})}>{q}</TVButton>)}</div></div><div className="setting-row" data-focus-group="settings-motion" data-focus-axis="row"><div><h3>Reduce motion</h3><p>Use quieter transitions and focus effects.</p></div><TVButton id="motion" aria-pressed={settings.reducedMotion} className="toggle-button" onClick={()=>update({reducedMotion:!settings.reducedMotion})}><span className={`switch ${settings.reducedMotion?'on':''}`}/>{settings.reducedMotion?'On':'Off'}</TVButton></div></section>
    <section data-focus-context="true"><h2>Country exclusions</h2><p className="secondary">Hide titles made in selected countries from discovery. Your library stays available.</p><div className="chip-row wrap">{['RU','SU','US','GB','UA'].map(c=><TVButton id={`exclude-${c}`} key={c} aria-pressed={settings.excludedCountries.includes(c)} className={settings.excludedCountries.includes(c)?'active':''} onClick={()=>update({excludedCountries:settings.excludedCountries.includes(c)?settings.excludedCountries.filter(x=>x!==c):[...settings.excludedCountries,c]})}>{settings.excludedCountries.includes(c)&&<Check size={17}/>} {countryNames[c]}</TVButton>)}<TVButton id="all-countries" onClick={()=>setCountryExpanded(!countryExpanded)}>More countries</TVButton></div>{countryExpanded&&<div className="country-picker"><input data-focus-id="country-search" aria-label="Find a country" placeholder="Find a country" value={countryQuery} onChange={e=>setCountryQuery(e.target.value)}/><div className="chip-row wrap">{countries.map(([c,name])=><TVButton id={`country-${c}`} key={c} className={settings.excludedCountries.includes(c)?'active':''} onClick={()=>update({excludedCountries:settings.excludedCountries.includes(c)?settings.excludedCountries.filter(x=>x!==c):[...settings.excludedCountries,c]})}>{name}</TVButton>)}</div></div>}{settings.excludedCountries.length>0&&<TVButton id="reset-countries" onClick={()=>update({excludedCountries:[]})}>Show all countries</TVButton>}</section>
  </div></div>;
}
