import type { Item } from './types';
export const castellano = 'castellano';
// The audio a title is known to have, from its listing card or its details page. Undefined means it has not been read yet.
export function audioOf(item: Pick<Item, 'audio' | 'translators'>): string[] | undefined {
  if (item.audio) return item.audio;
  return item.translators?.length ? item.translators.map(t => t.id) : undefined;
}
// A title whose audio is not known yet is kept, so a failed check never hides it.
export const hasCastellano = (item: Pick<Item, 'audio' | 'translators'>) => audioOf(item)?.includes(castellano) ?? true;
