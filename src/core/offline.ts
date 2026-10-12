import { isNative, TV } from './native';
import type { Download, Item } from './types';
const dbPromise=()=>new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open('rezka-tv-offline',1);request.onupgradeneeded=()=>request.result.createObjectStore('videos',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
const localURLs=new Map<string,string>();
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await dbPromise();return new Promise((resolve,reject)=>{const tx=db.transaction('videos',mode),request=run(tx.objectStore('videos'));tx.oncomplete=()=>{resolve(request.result);db.close();};tx.onerror=()=>{reject(tx.error);db.close();};});
}
export async function downloads():Promise<Download[]> {
  if(isNative)return (await TV.downloads()).items;
  const records=await transaction('readonly',s=>s.getAll());
  for(const [id,url] of localURLs)if(!records.some((r:Download)=>r.id===id)){URL.revokeObjectURL(url);localURLs.delete(id);}
  return records.map(({blob,...record}:{blob:Blob}&Download)=>{let url=localURLs.get(record.id);if(!url){url=URL.createObjectURL(blob);localURLs.set(record.id,url);}return {...record,url};});
}
export async function saveDownload(record:Download,onProgress:(progress:number)=>void) {
  if(isNative){await TV.download(record);return;}
  if(/\.m3u8(?:\?|$)/i.test(record.url))throw new Error('HLS downloads are available in the TV app. Choose a progressive quality to download in this preview.');
  const response=await fetch(record.url);if(!response.ok)throw new Error('This video could not be downloaded.');
  const reader=response.body?.getReader();if(!reader)throw new Error('This browser cannot save this video.');
  const length=Number(response.headers.get('content-length')),chunks:Uint8Array<ArrayBuffer>[]= [];let received=0;
  while(true){const {value,done}=await reader.read();if(done)break;chunks.push(new Uint8Array(value));received+=value.length;onProgress(length?received/length:0);}
  await transaction('readwrite',s=>s.put({...record,state:'completed',progress:1,blob:new Blob(chunks,{type:response.headers.get('content-type')||'video/mp4'})}));
}
export async function removeDownload(id:string) {if(isNative)await TV.removeDownload({id});else{await transaction('readwrite',s=>s.delete(id));const url=localURLs.get(id);if(url)URL.revokeObjectURL(url);localURLs.delete(id);}}
export async function importFile(file:File):Promise<Item> {
  const id=`local-${crypto.randomUUID()}`;const item:Item={id,title:file.name.replace(/\.[^.]+$/,''),kind:'movie',genre:'Personal video',synopsis:'Saved on this device.'};
  const record:Download={id,item,selection:{},url:'',headers:{},progress:1,state:'completed'};
  await transaction('readwrite',s=>s.put({...record,blob:file}));return item;
}
