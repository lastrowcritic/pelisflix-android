import {describe,it,expect,vi} from 'vitest';
import {ContentSource} from '../src/core/source';
import {defaults} from '../src/core/store';
import {sourceURL,defaultMirror,trustedPlayerURL} from '../src/core/pelisflix-policy';
import {genreArtwork} from '../src/core/categories';
import {existsSync} from 'node:fs';

const userAgent='Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
const live=process.env.PELISFLIX_LIVE==='1';
function source(mirror=defaultMirror){
 vi.unstubAllGlobals();const nativeFetch=globalThis.fetch;
 vi.stubGlobal('fetch',((input:RequestInfo|URL,init?:RequestInit)=>nativeFetch(typeof input==='string'&&input.startsWith('/api/media')?'http://127.0.0.1:5181'+input:input,init)) as typeof fetch);
 const source=new ContentSource({...defaults.settings,mirror});
 const request=vi.spyOn(source,'request').mockImplementation(async(url,form,referer)=>{
  if(!sourceURL(url,source.settings.mirror)&&!trustedPlayerURL(url))throw new Error('Unsupported test address');
  const response=await fetch(url,{signal:AbortSignal.timeout(18000),method:form?'POST':'GET',body:form?new URLSearchParams(form):undefined,headers:{'User-Agent':userAgent,Referer:referer||new URL(url).origin+'/'}});
  if(!response.ok)throw new Error(`Source returned ${response.status}`);
  return {url:response.url,status:response.status,text:await response.text()};
 });return {source,request};
}
describe.skipIf(!live)('Live Pelisflix source',()=>{
 it('loads real catalog, search, pagination and details and reuses cached reads',async()=>{
  const {source:api,request}=source();const home=await api.catalogue();expect(home.items.length).toBeGreaterThan(20);
  const count=request.mock.calls.length;await api.catalogue();expect(request.mock.calls.length).toBe(count);
  for(const c of home.categories)expect(existsSync(`public${genreArtwork(c)}`),c.name).toBe(true);
  const films=await api.catalogue('films/'),second=await api.catalogue('films/',2);expect(films.items.length).toBeGreaterThan(0);expect(second.items.length).toBeGreaterThan(0);expect(second.items[0].id).not.toBe(films.items[0].id);
  const search=await api.search('spider-man');expect(search.items.length).toBeGreaterThan(0);
  const title=search.items.find(i=>i.page?.includes('spider-man-un-nuevo-dia'));expect(title).toBeTruthy();
  const detail=await api.details(title!);expect(detail.translators?.length).toBeGreaterThan(0);const before=request.mock.calls.length;await api.details(title!);expect(request.mock.calls.length).toBe(before);
 },90000);
 it('resolves Spider-Man without running advertisements and reads actual HLS media bytes',async()=>{
  const {source:api}=source();const search=await api.search('spider-man');const item=search.items.find(i=>i.page?.includes('spider-man-un-nuevo-dia'))!;
  const detail=await api.details(item),result=await api.playback(detail,{translator:'latino'}),stream=result.streams[0];
  expect(stream.mimeType).toBe('application/x-mpegURL');const address=new URL(stream.url,'http://localhost').searchParams.get('url')||stream.url;
  const manifest=await fetch(address,{headers:result.headers,signal:AbortSignal.timeout(18000)});expect(manifest.status).toBe(200);const text=await manifest.text();expect(text.startsWith('#EXTM3U')).toBe(true);
  const line=text.split('\n').find(l=>l.trim()&&!l.startsWith('#'))!;const segment=await fetch(new URL(line,manifest.url),{headers:{...result.headers,Range:'bytes=0-1023'},signal:AbortSignal.timeout(18000)});expect([200,206]).toContain(segment.status);
  const reader=segment.body!.getReader(),first=await reader.read();expect(first.value?.length).toBeGreaterThan(0);await reader.cancel();
 },90000);
 it('plays a saved title from another mirror with the same stable identity and audio choice',async()=>{
  const {source:original}=source();const result=await original.search('spider-man');const item=result.items.find(i=>i.page?.includes('spider-man-un-nuevo-dia'))!;
  const {source:switched}=source('https://pelisflix200.dog/');const detail=await switched.details(item);expect(detail.id).toBe(item.id);expect(new URL(detail.page!).hostname).toBe('pelisflix200.dog');
  const playback=await switched.playback(detail,{translator:'latino'});expect(playback.streams[0].mimeType).toBe('application/x-mpegURL');
 },90000);
});
