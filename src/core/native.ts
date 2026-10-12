import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Download, Item, Selection, Source, WatchRecord } from './types';
export const isNative = Capacitor.isNativePlatform();
export interface NativePlayback { position: number; duration: number; ended: boolean; error?: string }
export const TV = registerPlugin<{
  request(options: { url: string; method: string; body?: string; referer?: string; timeout?:number; probe?:boolean }): Promise<{text:string;url:string;status:number}>;
  rating(options:{url:string}):Promise<{rating:string|null}>;
  play(options: { source: Source; quality: string; position: number; record: WatchRecord; testDurationSeconds?: number }): Promise<NativePlayback>;
  debugStatus(): Promise<{enabled:boolean}>;
  saveTestReport(options:{report:string}): Promise<void>;
  exit(): Promise<void>;
  drainProgress(): Promise<{records:WatchRecord[]}>;
  verify(options:{url:string;request?:{url:string;method:string;body?:string;referer?:string;timeout?:number}}): Promise<void>;
  pickFile(): Promise<{url:string;name:string}>;
  download(options:Download): Promise<void>;
  downloads(): Promise<{items:Download[]}>;
  removeDownload(options:{id:string}): Promise<void>;
  appInfo(): Promise<{version:string;updateRepo:string}>;
  installUpdate(options:{url:string}): Promise<void>;
  addListener(event:'updateProgress',listener:(value:{progress:number})=>void): Promise<{remove():Promise<void>}>;
}>('RezkaTV');
export function makeRecord(item: Item, selection: Selection, position=0): WatchRecord {
  return {item,...selection,position,duration:0,updatedAt:Date.now(),completed:false};
}
