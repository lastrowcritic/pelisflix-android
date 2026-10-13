import type { Catalogue, Item } from './types';
import { audioOf, hasCastellano } from './audio';
export interface Facts { countries: string[]; audio?: string[] }
export interface Rules { excluded: string[]; castellano: boolean }
// Discovery hides titles from excluded countries and, when asked, titles without Castellano. A listing that does not say is settled from the
// details page, a few at a time. A title whose details cannot be read is kept, so a failed check never hides it.
export async function discoverable(items: Item[], rules: Rules, details: (item: Item) => Promise<Item>, known: Map<string, Facts>, batch = 4): Promise<Item[]> {
  const { excluded, castellano } = rules;
  if (!excluded.length && !castellano) return items;
  const checked: Item[] = [];
  for (let i = 0; i < items.length; i += batch) checked.push(...await Promise.all(items.slice(i, i + batch).map(async item => {
    const needCountries = excluded.length > 0 && !item.countries?.length, needAudio = castellano && !audioOf(item);
    if (!needCountries && !needAudio) return item;
    let facts = known.get(item.id);
    if (!facts) { try { const detailed = await details(item); facts = { countries: detailed.countries || [], audio: audioOf(detailed) }; known.set(item.id, facts); } catch { return item; } }
    return { ...item, ...(needCountries ? { countries: facts.countries } : {}), ...(!audioOf(item) && facts.audio ? { audio: facts.audio } : {}) };
  })));
  return checked.filter(i => !i.countries?.some(c => excluded.includes(c)) && (!castellano || hasCastellano(i)));
}
// Filtering can leave a page nearly empty, so while it is on, the next pages are read until a screenful is found.
export const screenful = 12, extraPages = 3;
export async function readPages(load: (page: number) => Promise<Catalogue>, visible: (items: Item[]) => Promise<Item[]>, start: number, fill: boolean): Promise<Catalogue & { last: number }> {
  let last = start, data = await load(start), items = await visible(data.items);
  const { categories } = data;
  while (fill && items.length < screenful && data.hasNext && last - start < extraPages) {
    last++; data = await load(last);
    const more = await visible(data.items); items = [...items, ...more.filter(i => !items.some(j => j.id === i.id))];
  }
  return { ...data, categories, items, last };
}
