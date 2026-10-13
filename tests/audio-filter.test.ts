import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { audioOf, hasCastellano } from '../src/core/audio';
import { discoverable, readPages, screenful } from '../src/core/visibility';
import type { Facts } from '../src/core/visibility';
import { forteCardAudio, parseForteCatalogue } from '../src/core/providers/pelisforte-parse';
import { parseFeed, parseFuegoCard } from '../src/core/providers/fuegocine-parse';
import { defaults, loadState } from '../src/core/store';
import type { Catalogue, Item } from '../src/core/types';

const forte = (name: string) => parseForteCatalogue(readFileSync(`tests/fixtures/pelisforte/${name}.html`, 'utf8'), 'https://www2.pelisforte.se/');
const fuego = (name: string, edit = (text: string) => text) => parseFeed(edit(readFileSync(`tests/fixtures/fuegocine/${name}.json`, 'utf8'))).entries.map(parseFuegoCard);
const title = (id: string, extra: Partial<Item> = {}): Item => ({ id, title: id, kind: 'movie', genre: '', synopsis: '', ...extra });

describe('audio of a title', () => {
  it('comes from the listing first, then from the details translators, and is unknown otherwise', () => {
    expect(audioOf({ audio: ['latino'], translators: [{ id: 'castellano', name: 'Castellano', selected: true, premium: false }] })).toEqual(['latino']);
    expect(audioOf({ translators: [{ id: 'castellano', name: 'Castellano', selected: true, premium: false }, { id: 'latino', name: 'Latino', selected: false, premium: false }] })).toEqual(['castellano', 'latino']);
    expect(audioOf({})).toBeUndefined();
    expect(audioOf({ translators: [] })).toBeUndefined();
  });
  it('keeps a title whose audio is not known and drops one that is known to lack Castellano', () => {
    expect(hasCastellano({})).toBe(true);
    expect(hasCastellano({ audio: ['castellano', 'latino'] })).toBe(true);
    expect(hasCastellano({ audio: ['latino', 'subtitulado'] })).toBe(false);
    expect(hasCastellano({ audio: [] })).toBe(false);
  });
});

describe('listings that name the audio', () => {
  it('reads the audio tags around each Pelisforte card, movies and series', () => {
    expect(forte('listing').items.map(i => i.audio)).toEqual([['castellano', 'latino', 'subtitulado'], ['latino', 'subtitulado'], ['castellano', 'latino', 'subtitulado'], ['castellano', 'latino', 'subtitulado']]);
    expect(forte('listing-2').items.map(i => i.audio)).toEqual([['latino'], ['latino']]);
    expect(forte('series-list').items.map(i => [i.title, i.audio])).toEqual([['Chespirito: Sin querer queriendo', ['latino']], ['El juego del calamar', ['castellano', 'latino', 'subtitulado']]]);
  });
  it('leaves the audio unknown when a Pelisforte card carries no tag', () => {
    expect(forteCardAudio(undefined)).toBeUndefined();
    expect(forteCardAudio('post-1 movies type-movies hentry category-accion')).toBeUndefined();
    expect(forteCardAudio('post-1 idiomas-subtituladas-p02 idiomas-castellano idiomas-castellano')).toEqual(['subtitulado', 'castellano']);
  });
  it('reads the audio a Fuegocine movie lists and claims none for a series', () => {
    expect(fuego('listing').map(c => c?.audio)).toEqual([['latino'], ['latino'], ['latino']]);
    expect(fuego('listing-series').map(c => [c?.kind, c?.audio])).toEqual([['series', []], ['series', []], ['series', []]]);
  });
  it('recognises Castellano on a Fuegocine movie that lists it', () => {
    const spanish = fuego('listing', text => text.replaceAll('lang: \\"lat\\"', 'lang: \\"es\\"'));
    expect(spanish.map(c => c?.audio)).toEqual([['castellano'], ['castellano'], ['castellano']]);
  });
});

describe('discovery filter', () => {
  const rules = { excluded: [] as string[], castellano: true };
  it('does nothing and asks for nothing while no rule is on', async () => {
    const details = vi.fn(), items = [title('a')];
    expect(await discoverable(items, { excluded: [], castellano: false }, details, new Map())).toBe(items);
    expect(details).not.toHaveBeenCalled();
  });
  it('filters by the audio a listing already named, without any request', async () => {
    const details = vi.fn(), items = [title('yes', { audio: ['castellano'] }), title('no', { audio: ['latino'] }), title('none', { audio: [] })];
    expect((await discoverable(items, rules, details, new Map())).map(i => i.id)).toEqual(['yes']);
    expect(details).not.toHaveBeenCalled();
  });
  it('settles an unknown title from its details once, and remembers the answer', async () => {
    const known = new Map<string, Facts>(), details = vi.fn(async (item: Item) => ({ ...item, translators: item.id === 'es' ? [{ id: 'castellano', name: 'Castellano', selected: true, premium: false }] : [{ id: 'latino', name: 'Latino', selected: true, premium: false }] }));
    const items = [title('es'), title('lat')];
    const first = await discoverable(items, rules, details, known);
    expect(first.map(i => [i.id, i.audio])).toEqual([['es', ['castellano']]]);
    await discoverable(items, rules, details, known);
    expect(details).toHaveBeenCalledTimes(2);
  });
  it('keeps a title whose details cannot be read', async () => {
    const details = vi.fn(async () => { throw new Error('offline'); });
    expect((await discoverable([title('x')], rules, details, new Map())).map(i => i.id)).toEqual(['x']);
  });
  it('shares one details read between the country and the audio rule', async () => {
    const details = vi.fn(async (item: Item) => ({ ...item, countries: ['RU'], translators: [{ id: 'castellano', name: 'Castellano', selected: true, premium: false }] }));
    expect(await discoverable([title('a')], { excluded: ['RU'], castellano: true }, details, new Map())).toEqual([]);
    expect(details).toHaveBeenCalledTimes(1);
    expect((await discoverable([title('b')], { excluded: ['US'], castellano: true }, details, new Map())).map(i => [i.id, i.audio, i.countries])).toEqual([['b', ['castellano'], ['RU']]]);
  });
  it('still excludes countries on their own, as before', async () => {
    const details = vi.fn(async (item: Item) => ({ ...item, countries: item.id === 'ru' ? ['RU'] : ['FR'] }));
    expect((await discoverable([title('ru'), title('fr', { countries: ['FR'] })], { excluded: ['RU'], castellano: false }, details, new Map())).map(i => i.id)).toEqual(['fr']);
    expect(details).toHaveBeenCalledTimes(1);
  });
});

describe('reading enough pages', () => {
  const pages = (counts: number[]) => vi.fn(async (page: number): Promise<Catalogue> => ({ items: Array.from({ length: counts[page - 1] ?? 0 }, (_, i) => title(`p${page}-${i}`, { audio: i === 0 ? ['castellano'] : ['latino'] })), hasNext: page < counts.length, categories: [] }));
  const onlyCastellano = async (items: Item[]) => items.filter(i => i.audio?.includes('castellano'));
  it('reads one page when not filtering', async () => {
    const load = pages([20, 20, 20]), data = await readPages(load, async items => items, 1, false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(data).toMatchObject({ last: 1, hasNext: true });
  });
  it('keeps reading pages while the filter leaves less than a screenful, up to a limit', async () => {
    const load = pages(Array(10).fill(20)), data = await readPages(load, onlyCastellano, 1, true);
    expect(load).toHaveBeenCalledTimes(4);
    expect(data.items).toHaveLength(4);
    expect(data).toMatchObject({ last: 4, hasNext: true });
  });
  it('stops as soon as a screenful is found and when the source runs out of pages', async () => {
    const rich = pages(Array(10).fill(40)), full = await readPages(rich, async items => items.slice(0, screenful), 1, true);
    expect(rich).toHaveBeenCalledTimes(1); expect(full.items).toHaveLength(screenful);
    const short = pages([20, 20]), data = await readPages(short, onlyCastellano, 1, true);
    expect(short).toHaveBeenCalledTimes(2); expect(data).toMatchObject({ last: 2, hasNext: false });
  });
  it('continues from the page it was asked to start at', async () => {
    const load = pages(Array(10).fill(20)), data = await readPages(load, onlyCastellano, 5, true);
    expect(load.mock.calls.map(c => c[0])).toEqual([5, 6, 7, 8]);
    expect(data.last).toBe(8);
  });
});

describe('setting', () => {
  it('is off by default and for settings saved before it existed', () => {
    expect(defaults.settings.castellanoOnly).toBe(false);
    const old = { settings: { mode: 'live', mirror: 'https://pelisflix1.dog/' } };
    expect(loadState({ getItem: () => JSON.stringify(old) }).settings.castellanoOnly).toBe(false);
    expect(loadState({ getItem: () => JSON.stringify({ settings: { castellanoOnly: true } }) }).settings.castellanoOnly).toBe(true);
  });
});
