import type { Item, Selection, Settings, WatchRecord } from './types';
export interface SavedState { settings: Settings; favorites: Item[]; history: WatchRecord[]; custom: Item[]; audioChoices: Record<string,string> }
export const defaults: SavedState = {
  settings: { mode: 'live', mirror: 'https://pelisflix1.dog/', quality: '1080p', autoplay: true, excludedCountries: [], reducedMotion: false },
  favorites: [], history: [], custom: [], audioChoices: {}
};
export const STORE_KEY = 'pelisflix.personal.v1';
export function loadState(storage: Pick<Storage,'getItem'> = localStorage): SavedState {
  try {
    const saved = JSON.parse(storage.getItem(STORE_KEY) || 'null');
    if (!saved) return structuredClone(defaults);
    const audioChoices = saved.audioChoices && typeof saved.audioChoices === 'object' && !Array.isArray(saved.audioChoices)
      ? Object.fromEntries(Object.entries(saved.audioChoices).filter((entry): entry is [string,string] => typeof entry[1] === 'string' && entry[1].length > 0))
      : {};
    return { settings: {...defaults.settings,...saved.settings}, favorites: Array.isArray(saved.favorites)?saved.favorites:[], history: Array.isArray(saved.history)?saved.history.map(normalizeRecord).filter((r:WatchRecord|undefined):r is WatchRecord=>!!r):[], custom: Array.isArray(saved.custom)?saved.custom:[], audioChoices };
  } catch { return structuredClone(defaults); }
}
export function saveState(state: SavedState, storage: Pick<Storage,'setItem'> = localStorage) { storage.setItem(STORE_KEY,JSON.stringify(state)); }
export function episodeKey(item: Item, selection: Selection) { return `${item.id}:${selection.season ?? 'movie'}:${selection.episode ?? 'movie'}`; }
export function recordProgress(history: WatchRecord[], item: Item, selection: Selection, position: number, duration: number): WatchRecord[] {
  if (!Number.isFinite(position) || position < 0) return history;
  const key = episodeKey(item, selection);
  const previous = history.find(r => episodeKey(r.item,r)===key);
  const knownDuration = Number.isFinite(duration) && duration > 0 ? duration : previous?.duration || 0;
  const record: WatchRecord = { item, ...selection, position, duration:knownDuration, updatedAt:Date.now(), completed: knownDuration>0 && position>=knownDuration-1 };
  return [record,...history.filter(r=>episodeKey(r.item,r)!==key)].slice(0,500);
}
export function resumePosition(history: WatchRecord[], item: Item, selection: Selection): number {
  const record = history.find(r=>episodeKey(r.item,r)===episodeKey(item,selection));
  return record && !record.completed && Number.isFinite(record.position) ? record.position : 0;
}
export function latestWatchRecord(history: WatchRecord[], item: Item | string): WatchRecord | undefined {
  const id = typeof item === 'string' ? item : item.id;
  return history.reduce<WatchRecord | undefined>((latest, record) => {
    if (record.item.id !== id) return latest;
    return !latest || record.updatedAt > latest.updatedAt ? record : latest;
  }, undefined);
}
export function continueWatching(history: WatchRecord[]) {
  const seen = new Set<string>();
  return history.filter(record => {
    if (seen.has(record.item.id)) return false;
    seen.add(record.item.id);
    return !record.completed && record.position > 0;
  });
}
export function nextEpisode(item: Item, selection: Selection): Selection | undefined {
  const episodes = item.seasons?.flatMap(s=>s.episodes) || [];
  const index = episodes.findIndex(e=>e.season===selection.season && e.id===selection.episode);
  const next = index>=0 ? episodes[index+1] : undefined;
  return next ? {...selection,season:next.season,episode:next.id} : undefined;
}
export function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds)?seconds:0));
  const h = Math.floor(value/3600), m = Math.floor(value%3600/60), s = value%60;
  return h>0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}
const text=(value:unknown)=>typeof value==='string'&&value.length>0?value:undefined;
// iOS keeps the Rezka page, translations and episodes under item.rezka and uses ID suffixed selection keys.
export function normalizeRecord(raw: unknown): WatchRecord | undefined {
  const record=raw as Record<string,any>|null;
  if(!record||typeof record!=='object'||!record.item||typeof record.item.id!=='string'||!Number.isFinite(record.position)||!Number.isFinite(record.updatedAt))return undefined;
  const source=record.item,rezka=source.rezka&&typeof source.rezka==='object'?source.rezka:undefined;
  const item:Item={...source,genre:text(source.genre)??'',synopsis:text(source.synopsis)??'',page:text(source.page)??text(rezka?.pageURL),rezkaID:text(source.rezkaID)??text(rezka?.movieID),poster:text(source.poster)??text(source.posterURL)};
  if(typeof item.isSeries!=='boolean'&&typeof rezka?.isSeries==='boolean')item.isSeries=rezka.isSeries;
  if(!Array.isArray(item.translators)&&Array.isArray(rezka?.translators))item.translators=rezka.translators.filter((t:any)=>text(t?.id)&&typeof t.name==='string').map((t:any)=>({id:t.id,name:t.name,selected:Boolean(t.isSelected??t.selected),premium:Boolean(t.isPremium??t.premium)}));
  if(!Array.isArray(item.seasons)&&Array.isArray(rezka?.seasons)&&rezka.seasons.length)item.seasons=rezka.seasons.filter((s:any)=>text(s?.id)).map((s:any)=>({id:s.id,title:text(s.title)??`Season ${s.id}`,episodes:(Array.isArray(s.episodes)?s.episodes:[]).filter((e:any)=>text(e?.id)).map((e:any)=>({id:e.id,title:text(e.title)??`Episode ${e.id}`,season:text(e.season)??text(e.seasonID)??s.id}))}));
  const duration=Number.isFinite(record.duration)&&record.duration>0?record.duration:0;
  return {...record,item,translator:text(record.translator)??text(record.translatorID),season:text(record.season)??text(record.seasonID),episode:text(record.episode)??text(record.episodeID),position:record.position,duration,updatedAt:record.updatedAt,completed:typeof record.completed==='boolean'?record.completed:duration>0&&record.position>=duration-1} as WatchRecord;
}
