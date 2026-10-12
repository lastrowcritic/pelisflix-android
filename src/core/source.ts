import type { Catalogue, Collection, Comment, Item, Selection, Settings, Source } from './types';
import { VerificationRequired, isChallenge } from './challenge';
import { isNative, TV } from './native';
import { demoCategories, demoItems } from './demo';
import { categoryRoot, categorySlug } from './categories';
import { HTTPFailure, InvalidCatalogue, MirrorManager } from './mirrors';
import { VerificationCoordinator } from './verification';
import { contentURL,defaultMirror,trustedPlayerURL,sourceURL,mediaURL } from './pelisflix-policy';
export { normalizeMirror } from './mirrors';
const verification=new VerificationCoordinator();
export function catalogueURL(base:string,page=1,_filter?:string){const url=new URL(base);url.pathname=url.pathname.replace(/\/page\/\d+\/?$/,'/');url.searchParams.delete('page');url.searchParams.delete('filter');if(page>1)url.pathname=url.pathname.replace(/\/?$/,'/')+`page/${page}/`;return url.href;}
export class ContentSource {
  private mirrors:MirrorManager;
  private genrePages=new Map<string,Map<number,number>>();
  private catalogueCache=new Map<string,{time:number;value:Promise<Catalogue>}>();
  private detailCache=new Map<string,{time:number;value:Promise<Item>}>();
  private htmlCache=new Map<string,{time:number;value:Promise<{text:string;url:string;status:number}>}>();
  constructor(public settings:Settings,public onMirror?:(url:string)=>void){this.mirrors=new MirrorManager((...args)=>this.request(...args),()=>this.settings.mirror,url=>{this.settings={...this.settings,mirror:url};this.onMirror?.(url);});}
  async request(url:string,form?:Record<string,string>,referer?:string,timeout=18000){
    if(!sourceURL(url,this.settings.mirror)&&!trustedPlayerURL(url))throw new Error('This link is outside the supported content source.');
    const method=form?'POST':'GET',body=form?new URLSearchParams(form).toString():undefined,options={url,method,body,referer,timeout};
    const response=isNative?await verification.request(options,o=>TV.request(o),(url,request)=>TV.verify({url,request}),isChallenge):await fetch(`/api/content?url=${encodeURIComponent(url)}`,{method,body,headers:{...(form?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(referer?{'X-Rezka-Referer':referer}:{}),'X-Rezka-Timeout':String(timeout)},signal:AbortSignal.timeout(timeout+1000)}).then(async r=>({text:await r.text(),status:r.status,url:r.headers.get('X-Rezka-URL')||url}));
    if(!sourceURL(response.url,this.settings.mirror)&&!trustedPlayerURL(response.url))throw new Error('The source redirected to an unsupported website.');
    if(isChallenge(response.text))throw new VerificationRequired(response.url);
    if(response.status<200||response.status>=300)throw new HTTPFailure(response.status);return response;
  }
  rebase(raw:string,base=this.settings.mirror){const url=new URL(raw,base);if(!sourceURL(url.href,base))throw new Error('This catalog link is outside the selected mirror.');url.host=new URL(base).host;return url.href;}
  async withMirror<T>(operation:(base:string)=>Promise<T>):Promise<T>{return this.mirrors.run(operation);}
  private html(url:string,ttl=300000){const saved=this.htmlCache.get(url);if(saved&&Date.now()-saved.time<ttl)return saved.value;const value=this.request(url);this.htmlCache.set(url,{time:Date.now(),value});value.catch(()=>this.htmlCache.delete(url));while(this.htmlCache.size>80)this.htmlCache.delete(this.htmlCache.keys().next().value!);return value;}
  private cached(key:string,operation:()=>Promise<Catalogue>){const saved=this.catalogueCache.get(key);if(saved&&Date.now()-saved.time<60000)return saved.value;const value=operation();this.catalogueCache.set(key,{time:Date.now(),value});value.catch(()=>this.catalogueCache.delete(key));while(this.catalogueCache.size>80)this.catalogueCache.delete(this.catalogueCache.keys().next().value!);return value;}
  async catalogue(path?:string,page=1,filter?:string):Promise<Catalogue>{
    if(this.settings.mode==='demo'){const root=path?categoryRoot(path):'',slug=path?categorySlug(path):'',genre=slug&&slug!==root?slug.replaceAll('-',' '):'';return {items:demoItems.filter(i=>(!root||i.kind===({films:'movie',series:'series',cartoons:'animation',animation:'anime'} as Record<string,string>)[root])&&(!genre||i.genre.toLowerCase()===genre)),hasNext:false,categories:demoCategories};}
    return this.cached(`catalogue:${path||''}:${page}:${filter||''}`,()=>this.withMirror(async base=>{
      const {parsePelisflixCatalogue}=await import('./pelisflix');let url=new URL(path||base,base),kind:string|undefined;
      const match=url.pathname.match(/^\/(films|series|cartoons|animation)\/(?:([^/]+)\/)?$/);
      if(match){kind=match[1]==='series'?'series':match[1]==='films'?'movie':undefined;url=new URL(match[2]?`genero/${match[2]}/`:match[1]==='series'?'series-online/':match[1]==='films'?'peliculas-online/':'genero/animacion/',base);}
      else url=new URL(this.rebase(url.href,base));
      const key=`${url.href}:${kind||''}`,pages=this.genrePages.get(key)||new Map<number,number>();this.genrePages.set(key,pages);
      if(kind&&page>1&&!pages.has(page-1))await this.catalogue(path,page-1,filter);
      let physical=kind?(pages.get(page-1)||0)+1:page;
      while(true){
        const address=catalogueURL(url.href,physical),r=await this.html(address,60000),data=parsePelisflixCatalogue(r.text,r.url,physical);
        if(!data.items.length&&physical===1&&!/búsqueda|sin resultados|no se encontr/i.test(r.text)){this.htmlCache.delete(address);throw new InvalidCatalogue('The catalogue could not be read. Try again shortly.');}
        if(kind)data.items=data.items.filter(i=>i.kind===kind);
        if(data.items.length||!kind||!data.hasNext){pages.set(page,physical);return data;}
        physical++;
      }
    }));
  }
  async search(query:string,page=1):Promise<Catalogue>{
    if(this.settings.mode==='demo')return {items:demoItems.filter(i=>(i.title+' '+i.genre).toLowerCase().includes(query.toLowerCase())),hasNext:false,categories:[]};
    const term=query.trim();if(!term)return {items:[],hasNext:false,categories:[]};
    return this.cached(`search:${term.toLocaleLowerCase('es')}:${page}`,()=>this.withMirror(async base=>{const {parsePelisflixCatalogue}=await import('./pelisflix');const url=new URL(catalogueURL(base,page));url.searchParams.set('s',term);const r=await this.html(url.href,60000);return parsePelisflixCatalogue(r.text,r.url,page);}));
  }
  async details(item:Item):Promise<Item>{
    if(!item.page)return item;const saved=this.detailCache.get(item.page);if(saved&&Date.now()-saved.time<1800000)return saved.value;
    const value=this.withMirror(async base=>{const {parsePelisflixDetails,parsePelisflixEpisodes,parsePelisflixAudio}=await import('./pelisflix');const r=await this.html(this.rebase(item.page!,base));let detailed=parsePelisflixDetails(r.text,r.url,item);
      if(detailed.isSeries&&detailed.seasons?.length){const seasons=[...detailed.seasons];let cursor=0;await Promise.all(Array.from({length:Math.min(3,seasons.length)},async()=>{while(cursor<seasons.length){const index=cursor++,season=seasons[index];if(!season.page)continue;const response=await this.html(season.page);seasons[index]={...season,episodes:parsePelisflixEpisodes(response.text,response.url,season.id)};}}));
        detailed={...detailed,seasons};const first=seasons.flatMap(s=>s.episodes)[0];if(first?.page){const response=await this.html(first.page);detailed.translators=parsePelisflixAudio(response.text,response.url);}}
      if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('rezka-rating',{detail:{id:detailed.id,rating:detailed.ratings?.find(r=>r.name==='IMDb')?.value||null}}));return detailed;
    });this.detailCache.set(item.page,{time:Date.now(),value});value.catch(()=>this.detailCache.delete(item.page!));while(this.detailCache.size>100)this.detailCache.delete(this.detailCache.keys().next().value!);return value;
  }
  async rating(item:Item):Promise<string|null>{return item.ratings?.find(r=>r.name==='IMDb')?.value||null;}
  async episodes(item:Item,_translator:string){return (await this.details(item)).seasons||[];}
  // A playable playlist can still point to deleted files. Read only a small media prefix before opening the player.
  async checkStream(source:Source):Promise<void>{
    const read=async(url:string,probe=false)=>{
      if(!mediaURL(url))throw new Error('Unsupported video address');const referer=source.headers.Referer;
      if(isNative){const r=await TV.request({url,method:'GET',referer,timeout:8000,probe});if(!mediaURL(r.url)||r.status<200||r.status>=300)throw new Error('The video server is unavailable.');return {text:r.text,url:r.url};}
      const address=`/api/media?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer)}`;
      const r=await fetch(address,{signal:AbortSignal.timeout(8000),headers:probe?{Range:'bytes=0-1023'}:{}});if(!r.ok)throw new Error('The video server is unavailable.');
      if(!probe)return {text:await r.text(),url};
      const reader=r.body?.getReader();if(!reader)throw new Error('The video server returned no media.');let text='',length=0;
      try{while(length<1024){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value.subarray(0,1024-length));length+=chunk.value.length;}}finally{await reader.cancel();}
      if(!length)throw new Error('The video server returned no media.');return {text,url};
    };
    const validate=(text:string)=>{if(/file deleted|DMCA request/i.test(text))throw new Error('This video file has been removed by the source. Choose another available audio or title.');if(/^\s*(?:<!doctype|<html|<body)/i.test(text))throw new Error('The source returned a web page instead of video. Choose another audio or title.');};
    let address=source.streams[0].url;
    if(source.streams[0].mimeType==='application/x-mpegURL'){
      for(let depth=0;depth<3;depth++){const r=await read(address);validate(r.text);if(!r.text.trimStart().startsWith('#EXTM3U'))throw new Error('The video playlist is unavailable.');
        const line=r.text.split('\n').find(l=>l.trim()&&!l.startsWith('#'));if(!line)throw new Error('The video playlist has no media.');
        address=new URL(line.trim(),r.url).href;if(address.includes('/api/media?'))address=new URL(address).searchParams.get('url')||address;
        if(!r.text.includes('#EXT-X-STREAM-INF')){validate((await read(address,true)).text);return;}
      }throw new Error('This video playlist is not supported.');
    }validate((await read(address,true)).text);
  }
  async playback(item:Item,selection:Selection):Promise<Source>{
    if(item.stream)return {streams:[{quality:'Original',url:item.stream,alternatives:[]}],subtitles:[],headers:{}};
    const {parsePelisflixAudio,parsePelisflixHost}=await import('./pelisflix');const detailed=await this.details(item);let page=detailed.page!,audio=detailed.translators||[];
    if(detailed.isSeries){const episode=detailed.seasons?.find(s=>s.id===selection.season)?.episodes.find(e=>e.id===selection.episode);if(!episode?.page)throw new Error('Choose a season and episode.');page=episode.page;const response=await this.html(page);audio=parsePelisflixAudio(response.text,response.url);}
    const preferred=audio.find(a=>a.id===selection.translator);if(selection.translator&&!preferred)throw new Error('This episode does not have the selected audio. Choose another language.');
    const translator=preferred||audio[0];if(!translator?.sources?.length)throw new Error('No playable server is available for this title.');
    let lastError:unknown,removed:Error|undefined;for(const option of translator.sources){try{const response=await this.request(option.url,undefined,page),resolved=parsePelisflixHost(response.text,response.url);await this.checkStream(resolved);return isNative?resolved:{...resolved,streams:resolved.streams.map(stream=>({...stream,url:`/api/media?url=${encodeURIComponent(stream.url)}&referer=${encodeURIComponent(response.url)}`}))};}catch(error){lastError=error;if(error instanceof Error&&/removed by the source/.test(error.message))removed=error;}}
    throw new Error(`The available video servers could not be opened. ${removed?.message||(lastError instanceof Error?lastError.message:'Try another audio choice.')}`);
  }
  async collections(_page=1):Promise<Collection[]>{if(this.settings.mode==='demo')return [{name:'An evening elsewhere',url:'preview:collection',image:'/artwork/scifi.jpg',count:'12 stories'}];const {parsePelisflixCollections}=await import('./pelisflix');const r=await this.html(this.settings.mirror);return parsePelisflixCollections(r.text,r.url);}
  async collectionIndex(){return this.collections();}
  async comments(_item:Item,_page=1):Promise<{comments:Comment[];hasNext:boolean}>{return {comments:[],hasNext:false};}
  async person(url:string){const {parsePelisflixCatalogue}=await import('./pelisflix');const r=await this.html(this.rebase(url));const parsed=parsePelisflixCatalogue(r.text,r.url);return {name:new URL(url).searchParams.get('s')||'Filmography',originalName:'',birthDate:'',jobs:[],careers:[],filmography:parsed.items};}
}
