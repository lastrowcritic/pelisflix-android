import {describe,it,expect,vi,afterEach} from 'vitest';
import {genreArtwork} from '../src/core/categories';
import {existsSync,readFileSync} from 'node:fs';
import {ContentSource,catalogueURL} from '../src/core/source';
import {sourceURL} from '../src/core/pelisflix-policy';
import {defaults} from '../src/core/store';
import {contentURL,defaultMirror,parsePelisflixAudio,parsePelisflixCatalogue,parsePelisflixDetails,parsePelisflixEpisodes,parsePelisflixCollections,parsePelisflixHost,titleID,trustedPlayerURL} from '../src/core/pelisflix';
const fixture=(name:string)=>readFileSync(`tests/fixtures/pelisflix/${name}.html`,'utf8');
const film={id:titleID(defaultMirror+'pelicula/primitive-war/'),title:'Primitive War',kind:'movie' as const,page:defaultMirror+'pelicula/primitive-war/',genre:'Action',synopsis:'A real synopsis'};
afterEach(()=>{vi.useRealTimers();localStorage.clear();vi.unstubAllGlobals();});
describe('Pelisflix catalog and advertisement isolation',()=>{
 it('extracts real movie and series cards without duplicates or off-site links',()=>{const data=parsePelisflixCatalogue(fixture('home'),defaultMirror);expect(data.items.length).toBeGreaterThan(40);expect(new Set(data.items.map(i=>i.id)).size).toBe(data.items.length);expect(data.items.every(i=>new URL(i.page!).hostname==='pelisflix1.dog')).toBe(true);expect(data.categories.some(c=>c.name==='Acción')).toBe(true);});
 it('ignores advertising cards even when they use real card markup and spoofed hostnames',()=>{const ad='<article><a href="https://pelisflix1.dog.ads.example/pelicula/ad/"><h2 class="Title">Advertisement</h2></a></article><article><a href="javascript:alert(1)"><h2 class="Title">Click me</h2></a></article>';expect(parsePelisflixCatalogue(ad,defaultMirror).items).toEqual([]);expect(contentURL('https://pelisflix1.dog@ads.example/pelicula/ad/',defaultMirror)).toBeUndefined();});
 it('reads real series pagination and search cards',()=>{const data=parsePelisflixCatalogue(fixture('series'),defaultMirror+'series-online/');expect(data.items).toHaveLength(40);expect(data.hasNext).toBe(true);expect(parsePelisflixCatalogue(fixture('search'),defaultMirror+'?s=matrix').items.length).toBeGreaterThan(0);expect(catalogueURL(defaultMirror+'series-online/?s=test',2)).toBe(defaultMirror+'series-online/page/2/?s=test');});
 it('discovers the source collections without fetching their contents',()=>{const collections=parsePelisflixCollections(fixture('home'),defaultMirror);expect(collections).toHaveLength(10);expect(collections.map(c=>c.name)).toContain('NETFLIX');});
});
describe('Pelisflix title and series behavior',()=>{
 it('keeps the real synopsis rather than the title page marketing copy',()=>{const detail=parsePelisflixDetails(fixture('movie'),film.page,film);expect(detail.title).toBe('Primitive War');expect(detail.duration).toBe(135);expect(detail.synopsis).toBe('A real synopsis');expect(detail.translators?.map(t=>t.id)).toEqual(['latino','castellano','subtitulado']);expect(detail.rating).toBeUndefined();});
 it('reads seasons and stable episode IDs and artwork from live captured pages',()=>{const series={...film,id:'show',kind:'series' as const,isSeries:true,page:defaultMirror+'serie/el-secreto/'};const detail=parsePelisflixDetails(fixture('show'),series.page,series);expect(detail.seasons?.[0].id).toBe('1');const episodes=parsePelisflixEpisodes(fixture('season'),defaultMirror+'temporada/el-secreto-1/','1');expect(episodes.length).toBeGreaterThan(1);expect(episodes[0]).toMatchObject({id:'1',season:'1',page:defaultMirror+'episodio/el-secreto-1x1/'});expect(episodes[0].image).toContain('cnddim.xyz');expect(parsePelisflixAudio(fixture('episode'),defaultMirror).map(t=>t.id)).toEqual(['castellano']);});
 it('never accepts a player from an advertising domain',()=>{expect(trustedPlayerURL('https://nupload.my.ads.example/watch/id')).toBeUndefined();const html='<div class="optns-bx"><div class="drpdn"><button class="bstd"><span>LATINO</span></button><div data-url="'+btoa('https://ads.example/watch/id')+'"></div></div></div>';expect(parsePelisflixAudio(html,defaultMirror)).toEqual([]);});
 it('decodes provider data without executing its scripts and identifies extensionless HLS',()=>{(globalThis as any).pelisflixUnsafe=false;const data=parsePelisflixHost(fixture('provider')+'<script>globalThis.pelisflixUnsafe=true</script>','https://nupload.my/watch/example');expect(data.streams[0]).toMatchObject({url:'https://sv3.ibra.lat/?s=TestSession',quality:'Auto',mimeType:'application/x-mpegURL'});expect((globalThis as any).pelisflixUnsafe).toBe(false);expect(()=>parsePelisflixHost('<script>file:"https://ads.example/ad.mp4"</script>','https://nupload.my/watch/example')).toThrow();});
});
describe('Pelisflix source caching',()=>{
 const makeSource=()=>{const source=new ContentSource({...structuredClone(defaults.settings),mirror:defaultMirror});const request=vi.spyOn(source,'request').mockImplementation(async url=>({url,status:200,text:fixture(url.includes('pelicula/')?'movie':'home')}));return {source,request};};
 it('shares in-flight and repeated catalog reads and refreshes after expiry',async()=>{vi.useFakeTimers();vi.setSystemTime(100000);const {source,request}=makeSource();const [a,b]=await Promise.all([source.catalogue(),source.catalogue()]);expect(a).toBe(b);expect(request).toHaveBeenCalledTimes(1);vi.setSystemTime(160001);await source.catalogue();expect(request).toHaveBeenCalledTimes(2);});
 it('shares title details and search results with normalized queries',async()=>{const {source,request}=makeSource();const a=await source.details(film),b=await source.details(film);expect(a).toBe(b);await source.search(' Matrix ');await source.search('matrix');expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls[1][0]).toContain('s=Matrix');});
 it('rejects an unsupported network URL before any HTTP request',async()=>{const source=new ContentSource({...defaults.settings,mirror:defaultMirror});await expect(source.request('https://ads.example/ad')).rejects.toThrow('outside');});
 it('restores a specific episode for playback and rejects unavailable audio without falling back silently',async()=>{const {source,request}=makeSource();vi.spyOn(source,'checkStream').mockResolvedValue();request.mockImplementation(async url=>({url,status:200,text:fixture(url.includes('/serie/')?'show':url.includes('/temporada/')?'season':url.includes('/episodio/')?'episode':url.includes('nupload.my')?'provider':'movie')}));const show=await source.details({...film,kind:'series',isSeries:true,page:defaultMirror+'serie/el-secreto/'});const selected=show.seasons![0].episodes[1];const result=await source.playback(show,{translator:'castellano',season:'1',episode:selected.id});expect(result.streams[0].mimeType).toBe('application/x-mpegURL');expect(request.mock.calls.some(([url])=>url===selected.page)).toBe(true);await expect(source.playback(show,{translator:'latino',season:'1',episode:selected.id})).rejects.toThrow('selected audio');});
});

describe('Pelisflix supplied mirrors',()=>{
 it('allows exact supplied mirror hosts while keeping advertisements outside the source',()=>{
  expect(sourceURL('https://pelisflix200.dog/pelicula/example/',defaultMirror)).toBe(true);
  expect(sourceURL('https://pelisflix200.watch/serie/example/',defaultMirror)).toBe(true);
  expect(sourceURL('https://pelisflix200.dog.ads.example/pelicula/ad/',defaultMirror)).toBe(false);
  expect(titleID('https://pelisflix200.dog/pelicula/example/')).toBe(titleID(defaultMirror+'pelicula/example/'));
 });
 it('selects a working supplied mirror after a connection failure',async()=>{
  let selected=defaultMirror;
  const source=new ContentSource({...defaults.settings,mirror:defaultMirror},url=>selected=url);
  vi.spyOn(source,'request').mockImplementation(async url=>{if(new URL(url).hostname==='pelisflix1.dog')throw new TypeError('fetch failed');return {url,status:200,text:fixture('home').replaceAll('pelisflix1.dog','pelisflix200.dog')};});
  const data=await source.catalogue();expect(data.items.length).toBeGreaterThan(0);expect(selected).toBe('https://pelisflix200.dog/');
  expect(source.rebase(defaultMirror+'pelicula/example/')).toBe('https://pelisflix200.dog/pelicula/example/');
 });
 it('continues filtered genres across source pages containing only the other format',async()=>{
  const source=new ContentSource({...defaults.settings,mirror:defaultMirror});const seen:string[]=[];
  vi.spyOn(source,'request').mockImplementation(async url=>{seen.push(url);const page=url.includes('/page/2/')?2:url.includes('/page/3/')?3:1;const html=page===2?fixture('home'):fixture('series');return {url,status:200,text:html};});
  const data=await source.catalogue('films/accion/');expect(data.items.length).toBeGreaterThan(0);expect(data.items.every(i=>i.kind==='movie')).toBe(true);expect(seen.some(u=>u.includes('/page/2/'))).toBe(true);
 });
});

describe('Pelisflix category artwork',()=>{
 it('matches every category in the captured live catalog to an existing bundled image',()=>{
  for(const category of parsePelisflixCatalogue(fixture('home'),defaultMirror).categories){
   const image=genreArtwork(category);expect(image,category.name).toBeTruthy();expect(existsSync(`public${image}`),category.name).toBe(true);
  }
 });
});

describe('Pelisflix media validation',()=>{
 it('detects a deleted media file even when the playlist and segment return successful HTTP codes',async()=>{
  const source=new ContentSource({...defaults.settings,mirror:defaultMirror});const fetch=vi.fn().mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:4,\nhttps://sv4.ibra.lat/video.ts\n#EXT-X-ENDLIST')).mockResolvedValueOnce(new Response('<html><body><h1>File deleted by DMCA request</h1></body></html>'));
  vi.stubGlobal('fetch',fetch);
  await expect(source.checkStream({streams:[{url:'https://sv4.ibra.lat/?s=test',quality:'Auto',alternatives:[],mimeType:'application/x-mpegURL'}],headers:{Referer:'https://nupload.my/watch/example'},subtitles:[]})).rejects.toThrow('removed by the source');expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('accepts real video bytes and bounds the segment probe',async()=>{
  const source=new ContentSource({...defaults.settings,mirror:defaultMirror});const fetch=vi.fn().mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:4,\nhttps://sv5.ibra.lat/video.ts\n#EXT-X-ENDLIST')).mockResolvedValueOnce(new Response(new Uint8Array([0x47,0x40,0,0x10])));
  vi.stubGlobal('fetch',fetch);await source.checkStream({streams:[{url:'https://sv5.ibra.lat/?s=test',quality:'Auto',alternatives:[],mimeType:'application/x-mpegURL'}],headers:{Referer:'https://nupload.my/watch/example'},subtitles:[]});expect(fetch.mock.calls[1][1].headers.Range).toBe('bytes=0-1023');
 });
});

describe('Pelisflix details after changing mirrors',()=>{
 it('updates the canonical title page while preserving the stable ID and cached viewing metadata',()=>{
  const item={...film,page:defaultMirror+'pelicula/primitive-war/'};
  const base='https://pelisflix200.dog/pelicula/primitive-war/';
  const detail=parsePelisflixDetails(fixture('movie').replaceAll('pelisflix1.dog','pelisflix200.dog'),base,item);
  expect(detail.page).toBe(base);expect(detail.id).toBe(item.id);expect(detail.translators?.[0].id).toBe('latino');
 });
});
