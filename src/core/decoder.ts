import * as cheerio from 'cheerio';
import type { Stream, Subtitle } from './types';
const symbols = ['@','#','!','^','$'];
let words = symbols;
const noise: string[] = [];
for (let length = 2; length <= 3; length++) {
  words = symbols.flatMap(symbol => words.map(word => symbol + word));
  noise.push(...words.map(word => btoa(word)));
}
export function decode(payload: string): string {
  let value = payload.trim();
  if (value.startsWith('[')) return value;
  value = value.replaceAll('#h', '').replaceAll('//_//','');
  for (const word of noise.sort((a,b) => b.length-a.length)) value = value.replaceAll(word,'');
  if (value.startsWith('[')) return value;
  value = value.replace(/\s/g,'').replaceAll('-','+').replaceAll('_','/').replace(/=+$/,'');
  value += '='.repeat((4-value.length%4)%4);
  try {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0))).trim();
    if (!decoded.startsWith('[')) throw new Error();
    return decoded;
  } catch { throw new Error('The video response could not be read. Try another mirror.'); }
}
function entries(value: string) {
  return Array.from(value.matchAll(/\[(.*?)\]\s*(https?:\/\/.*?)(?=,\s*\[|$)/gs));
}
function alternatives(value: string) {
  return [...new Set(value.split(/\s+or\s+/i).map(url => url.trim()).filter(url => {
    try { return ['https:','http:'].includes(new URL(url).protocol); } catch { return false; }
  }))];
}
export function parseStreams(payload: string): Stream[] {
  const streams = new Map<string,Stream>();
  for (const [,label,value] of entries(decode(payload))) {
    if (label.includes('pjs-prem-quality')) continue;
    const urls = alternatives(value);
    if (!urls.length) continue;
    const quality = cheerio.load(label).text();
    const existing = streams.get(quality);
    if (existing) existing.alternatives = [...new Set([...existing.alternatives,...urls])].filter(url=>url!==existing.url);
    else streams.set(quality, { quality, url: urls[0], alternatives: urls.slice(1) });
  }
  if (!streams.size) throw new Error('No playable video was returned.');
  return [...streams.values()].sort((a,b) => (parseInt(b.quality)||0)-(parseInt(a.quality)||0));
}
export function parseSubtitles(payload: string, languages: Record<string,string> = {}): Subtitle[] {
  return entries(payload).flatMap(([,label,value]) => {
    const url = alternatives(value)[0];
    return url ? [{label,language:languages[label] || label,url}] : [];
  });
}
