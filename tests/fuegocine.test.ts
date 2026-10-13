import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContentSource } from '../src/core/source';
import { defaults } from '../src/core/store';
import { defaultMirror } from '../src/core/pelisflix';
import { InvalidCatalogue } from '../src/core/mirrors';
import { discoverable } from '../src/core/visibility';
import { SpanishAnswers } from '../src/core/providers/fuegocine-spanish';
import { mediaPolicy, providerIdOf, sourceAllowed } from '../src/core/providers/policy';
import { fuegoAllowed, fuegoContentURL, fuegoDirectVideo, fuegoMedia, fuegoOkruURL, fuegoReferer, fuegoUnlimplayURL, fuegoVoeURL, fuegoWrappedVideo, fuegocineBase } from '../src/core/providers/fuegocine-policy';
import { feedURL, fuegoAudio, fuegoCategories, fuegoDirect, fuegoGenres, fuegoID, fuegoSpanish, fuegoUnlimplay, parseFeed, parseFuegoCard, parseFuegoDetails, parseFuegoEpisodes, parseFuegoLinks, parseOkru, parseUnlimplay, unlimplayOffers } from '../src/core/providers/fuegocine-parse';
import type { FeedEntry } from '../src/core/providers/fuegocine-parse';
import type { Item } from '../src/core/types';

const text = (name: string) => readFileSync(`tests/fixtures/fuegocine/${name}`, 'utf8');
const feed = (name: string) => parseFeed(text(`${name}.json`));
const base = fuegocineBase;
const hoppersPage = base + '2026/05/hoppers-operacion-castor-2026.html', avatarPage = base + '2026/10/avatar-los-siete-refugios-2026.html', avatarEpisode = base + '2026/10/avatar-los-siete-refugios-1x3.html';
const movie: Item = { id: fuegoID(hoppersPage), title: 'Hoppers: Operacion Castor', kind: 'movie', page: hoppersPage, genre: '', synopsis: '' };
const show: Item = { id: fuegoID(avatarPage), title: 'Avatar: Los Siete Refugios', kind: 'series', isSeries: true, page: avatarPage, genre: '', synopsis: '' };
const voeId = 'uaegeh45bypq', mp4 = 'https://1a-1791.com/video/fww1/d7/s8/2/U/-/z/j/U-zjA.aaa.mp4';

// VOE embeds hide their stream data in a JSON script. This is the inverse of the app's decoder, so the tests never need a live token.
const rot13 = (value: string) => value.replace(/[a-z]/gi, c => { const start = c <= 'Z' ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - start + 13) % 26 + start); });
function voePayload(data: object) {
  const reversed = [...Buffer.from(JSON.stringify(data)).toString('base64')].reverse().join(''), shifted = [...reversed].map(c => String.fromCharCode(c.charCodeAt(0) + 3)).join('');
  const junk = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'], encoded = Buffer.from(shifted, 'latin1').toString('base64');
  return rot13(encoded.match(/.{1,9}/g)!.map((part, index) => part + junk[index % junk.length]).join(''));
}
const voeStream = `https://cdn-test.cloudwindow-route.com/engine/hls2-c/01/1/${voeId}/master.m3u8?t=TestToken`;
const voeEmbed = `<html><body><script type="application/json">${JSON.stringify([voePayload({ source: voeStream })])}</script></body></html>`;
// The saved unlimplay page only lists Latino. This gives it the Spanish option too, the way the site does for some titles.
const serverList = /const\s+EMBEDS\s*=\s*(\{[^\n]*\})\s*;/;
function withSpanish(page: string) {
  const list = JSON.parse(page.match(serverList)![1]);
  return page.replace(serverList, () => `const EMBEDS = ${JSON.stringify({ ...list, 'español': list.latino })};`);
}

describe('Fuegocine feed', () => {
  it('reads the entries, the labels and the total of a feed', () => {
    const data = feed('listing');
    expect(data.entries).toHaveLength(3);
    expect(data.total).toBe(3140);
    expect(feed('labels').labels).toContain('Acción');
    expect(feed('labels').entries).toHaveLength(0);
  });
  it('reports an unreadable answer as an invalid catalogue', () => {
    for (const body of ['', '<html>blocked</html>', '{"feed":null}', '[]']) expect(() => parseFeed(body)).toThrow(InvalidCatalogue);
  });
  it('builds the feed address for labels, search and one post', () => {
    expect(feedURL({ size: 0 })).toBe(base + 'feeds/posts/default?alt=json&max-results=0');
    expect(feedURL({ labels: ['Movie', 'Acción'], size: 30, start: 31 })).toBe(base + 'feeds/posts/default/-/Movie/Acci%C3%B3n?alt=json&max-results=30&start-index=31');
    expect(feedURL({ labels: ['Movie'], size: 30, start: 1 })).toBe(base + 'feeds/posts/default/-/Movie?alt=json&max-results=30');
    expect(feedURL({ query: 'el juego', size: 30 })).toBe(base + 'feeds/posts/default?alt=json&max-results=30&q=el+juego');
    expect(feedURL({ path: '/2026/05/hoppers-operacion-castor-2026.html' })).toBe(base + 'feeds/posts/default?alt=json&path=%2F2026%2F05%2Fhoppers-operacion-castor-2026.html');
  });
  it('keeps only genres, studios and premieres as categories', () => {
    const genres = fuegoGenres(feed('labels').labels);
    expect(genres.map(g => g.slug)).toContain('accion');
    expect(genres.map(g => g.slug)).toContain('ciencia-ficcion');
    for (const hidden of ['movie', 'serie', 'episode', '2025', '2026']) expect(genres.map(g => g.slug)).not.toContain(hidden);
    expect(genres.some(g => /^id-/.test(g.label))).toBe(false);
    expect(fuegoGenres(['Estreno', 'Animación']).map(g => [g.slug, g.name])).toEqual([['estrenos', 'Estrenos'], ['animacion', 'Animación']]);
    const categories = fuegoCategories(['Acción']);
    expect(categories).toEqual([{ name: 'Acción', kind: 'movie', url: base + 'films/accion/' }, { name: 'Acción', kind: 'series', url: base + 'series/accion/' }]);
  });
});

describe('Fuegocine titles', () => {
  it('turns movie and series posts into cards and leaves episodes out', () => {
    const cards = feed('home').entries.map(parseFuegoCard);
    expect(cards.filter(Boolean).length).toBe(feed('home').entries.length - 1);
    const hoppers = parseFuegoCard(feed('movie').entries[0])!;
    expect(hoppers).toMatchObject({ id: 'fuegocine:/2026/05/hoppers-operacion-castor-2026.html', title: 'Hoppers: Operacion Castor', kind: 'movie', year: 2026, page: hoppersPage, isSeries: false });
    expect(hoppers.poster).toMatch(/^https:\/\/media\.themoviedb\.org\//);
    expect(hoppers.synopsis).toContain('Mabel');
    const avatar = parseFuegoCard(feed('series').entries[0])!;
    expect(avatar).toMatchObject({ kind: 'series', isSeries: true, title: 'Avatar: Los Siete Refugios' });
    expect(parseFuegoCard(feed('episodes').entries[0])).toBeUndefined();
  });
  it('reads the details of a movie and its servers', () => {
    const detail = parseFuegoDetails(feed('movie').entries[0], movie);
    expect(detail).toMatchObject({ duration: 105, originalTitle: 'Hoppers', year: 2026 });
    expect(detail.genre).toBe('Aventura, Animación, Comedia, Familia, Ciencia ficción');
    expect(detail.backdrop).toBe('https://image.tmdb.org/t/p/original/kKvcnXN9QwjqST1C1d79H8gLJBq.jpg');
    expect(detail.rating).toBe('7.7');
    expect(detail.ratings).toEqual([{ name: 'IMDb', value: '7.7' }]);
    expect(detail.translators).toHaveLength(1);
    const [latino] = detail.translators!;
    expect(latino).toMatchObject({ id: 'latino', name: 'Latino', selected: true });
    // The plain file comes first, then unlimplay. Drive, the other player and the address that needs an api key are not offered.
    expect(latino.sources!.map(s => s.url)).toEqual([expect.stringContaining('repfuegocinefree.blogspot.com'), 'https://unlimplay.com/f/embed/movie/1327819']);
    expect(latino.sources!.map(s => s.name)).toEqual(['FC', 'UA']);
  });
  it('reads the servers of a post without running its script', () => {
    const links = parseFuegoLinks(feed('movie').entries[0].content!.$t);
    expect(links.map(l => l.lang)).toEqual(['lat', 'lat', 'lat', 'lat', 'lat']);
    expect(parseFuegoLinks('<!-- const _SV_LINKS = [{lang: "lat", name: "A", url: "https://voe.sx/e/abc"}] -->')).toEqual([]);
    expect(parseFuegoLinks('<script>const _SV_LINKS = [{lang: "lat", name: "A", url: ""},{lang: "es", name: "B", url: "https://ok.ru/videoembed/1?a=1&amp;b=2"}]</script>')).toEqual([{ lang: 'es', name: 'B', url: 'https://ok.ru/videoembed/1?a=1&b=2' }]);
    expect(parseFuegoLinks('<p>nothing here</p>')).toEqual([]);
  });
  it('groups servers by audio, in a usable order, and skips unknown languages', () => {
    const wrapper = `https://repfuegocinefree.blogspot.com/?link=${encodeURIComponent(mp4)}`;
    const audio = fuegoAudio([
      { lang: 'es', name: 'Voe ✅', url: 'https://voe.sx/e/abc123' }, { lang: 'lat', name: 'OK', url: 'https://ok.ru/videoembed/55' },
      { lang: 'lat', name: 'UA', url: 'https://unlimplay.com/play/embed/tv/1/1/1' }, { lang: 'lat', name: 'FC', url: wrapper },
      { lang: 'fr', name: 'Frembed', url: 'https://voe.sx/e/zzz' }, { lang: 'lat', name: 'Other', url: 'https://example.com/x' }, { lang: 'lat', name: 'FC again', url: wrapper }
    ]);
    expect(audio.map(a => [a.id, a.name, a.selected])).toEqual([['castellano', 'Castellano', true], ['latino', 'Latino', false]]);
    expect(audio[1].sources!.map(s => s.name)).toEqual(['FC', 'UA', 'OK']);
    expect(audio[0].sources![0].name).toBe('Voe');
  });
  it('offers a Spanish option from the unlimplay link of a post, unless the post lists Castellano itself', () => {
    const links = parseFuegoLinks(feed('movie').entries[0].content!.$t), latino = fuegoAudio(links), link = fuegoUnlimplay(links)!;
    expect(link.url).toBe('https://unlimplay.com/f/embed/movie/1327819');
    const offered = fuegoSpanish(latino, link);
    expect(offered.map(t => [t.id, t.name, t.selected])).toEqual([['latino', 'Latino', true], ['castellano', 'Castellano', false]]);
    expect(offered[1].sources).toEqual([{ url: link.url, name: 'UA' }]);
    expect(fuegoSpanish([], link)[0].selected).toBe(true);
    expect(fuegoSpanish(latino, undefined)).toBe(latino);
    const listed = fuegoAudio([{ lang: 'es', name: 'Voe', url: 'https://voe.sx/e/abc123' }]);
    expect(fuegoSpanish(listed, link)).toBe(listed);
    expect(fuegoUnlimplay([{ lang: 'lat', name: 'Other', url: 'https://example.com/x' }, { lang: 'lat', name: 'FC', url: 'https://voe.sx/e/abc123' }])).toBeUndefined();
  });
  it('lists the seasons and episodes of a series from its episode posts', () => {
    const { seasons, audio } = parseFuegoEpisodes(feed('episodes').entries);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({ id: '1', title: 'Season 1' });
    expect(seasons[0].episodes.map(e => e.id)).toEqual(['1', '2', '3']);
    expect(seasons[0].episodes[2]).toMatchObject({ page: avatarEpisode, season: '1', title: 'Episode 3' });
    expect(seasons[0].episodes[2].image).toMatch(/^https:\/\/image\.tmdb\.org|themoviedb\.org/);
    expect(audio[0]).toMatchObject({ id: 'latino', name: 'Latino' });
    expect(audio[0].sources!.some(s => /unlimplay/.test(s.url))).toBe(true);
    // The first episode's unlimplay link is what tells whether the series has a Spanish option.
    expect(parseFuegoEpisodes(feed('episodes').entries).unlimplay?.url).toBe('https://unlimplay.com/play/embed/tv/284833/1/1');
    expect(parseFuegoEpisodes([])).toEqual({ seasons: [], audio: [] });
  });
});

describe('Fuegocine players', () => {
  it('opens a plain file directly', () => {
    expect(fuegoDirect(mp4)).toMatchObject({ streams: [{ url: mp4, mimeType: 'video/mp4' }], subtitles: [] });
    expect(fuegoDirect('https://host.example/a/b.m3u8').streams[0].mimeType).toBe('application/x-mpegURL');
  });
  it('reads the playlist of an ok.ru page as text', () => {
    const source = parseOkru(text('okru.html'), 'https://ok.ru/videoembed/9630825187952');
    expect(source.streams[0]).toMatchObject({ mimeType: 'application/x-mpegURL' });
    expect(source.streams[0].url).toMatch(/^https:\/\/vd580\.okcdn\.ru\/video\.m3u8\?/);
    expect(source.headers.Referer).toBe('https://ok.ru/');
    expect(() => parseOkru('<html></html>', 'https://ok.ru/videoembed/1')).toThrow('playable');
    expect(() => parseOkru(text('okru.html'), 'https://evil.example/videoembed/1')).toThrow('not supported');
    expect(() => parseOkru(text('okru.html').replace('https://vd580.okcdn.ru', 'http://vd580.okcdn.ru'), 'https://ok.ru/videoembed/1')).toThrow('not supported');
  });
  it('picks the VOE address that matches the audio from the unlimplay page', () => {
    const page = text('unlimplay.html'), url = 'https://unlimplay.com/play/embed/tv/284833/1/3';
    expect(parseUnlimplay(page, url, 'latino')).toBe('https://voe.sx/e/' + voeId);
    expect(() => parseUnlimplay(page, url, 'castellano')).toThrow('selected audio');
    expect(() => parseUnlimplay(page, url, 'subtitulado')).toThrow('selected audio');
    expect(() => parseUnlimplay('<html></html>', url, 'latino')).toThrow('playable');
    expect(() => parseUnlimplay(page.replace('https://voe.sx/e/' + voeId, 'https://evil.example/e/x'), url, 'latino')).toThrow('not supported');
    expect(() => parseUnlimplay(page, 'https://evil.example/play/embed/tv/1/1/1', 'latino')).toThrow('not supported');
  });
  it('reads the unlimplay page that only lists its servers when the player is finished', () => {
    // The same page comes back in two versions: the list in a variable, or an empty variable and the list in the closing call.
    const page = text('unlimplay.html'), url = 'https://unlimplay.com/f/embed/movie/1302904', list = page.match(/const\s+EMBEDS\s*=\s*(\{[^\n]*\})\s*;/)![1];
    const late = page.replace(/const\s+EMBEDS\s*=\s*\{[^\n]*\}\s*;/, 'const EMBEDS = [];') + `\n<script type="x-text/javascript">if(typeof finalizePlayer==="function"){finalizePlayer(${list});}</script>`;
    expect(late).not.toMatch(/const\s+EMBEDS\s*=\s*\{/);
    expect(parseUnlimplay(late, url, 'latino')).toBe('https://voe.sx/e/' + voeId);
    expect(() => parseUnlimplay(late, url, 'castellano')).toThrow('selected audio');
    expect(() => parseUnlimplay(late.replace('https://voe.sx/e/' + voeId, 'https://evil.example/e/x'), url, 'latino')).toThrow('not supported');
    expect(() => parseUnlimplay(page.replace(/const\s+EMBEDS\s*=\s*\{[^\n]*\}\s*;/, 'const EMBEDS = [];'), url, 'latino')).toThrow('playable');
  });
  it('tells whether the unlimplay page offers an audio, in either version of the page', () => {
    const page = text('unlimplay.html'), spanish = withSpanish(page), list = page.match(serverList)![1];
    expect(unlimplayOffers(page, 'latino')).toBe(true);
    expect(unlimplayOffers(page, 'castellano')).toBe(false);
    expect(unlimplayOffers(spanish, 'castellano')).toBe(true);
    const late = spanish.replace(serverList, 'const EMBEDS = [];') + `\n<script type="x-text/javascript">if(typeof finalizePlayer==="function"){finalizePlayer(${JSON.stringify({ 'español': JSON.parse(list).latino })});}</script>`;
    expect(unlimplayOffers(late, 'castellano')).toBe(true);
    // A Spanish option on a server the app cannot read is not an option.
    expect(unlimplayOffers(spanish.replace(/https:\/\/voe\.sx\/e\/[A-Za-z0-9_-]+/g, 'https://evil.example/e/x'), 'castellano')).toBe(false);
    // Spanish can sit under more than one name, and a name without a readable server does not hide another one that has it.
    const split = page.replace(serverList, () => `const EMBEDS = ${JSON.stringify({ ...JSON.parse(list), 'español': { doodstream: 'https://doodstream.com/e/x' }, castellano: JSON.parse(list).latino })};`);
    expect(unlimplayOffers(split, 'castellano')).toBe(true);
    expect(parseUnlimplay(split, 'https://unlimplay.com/f/embed/movie/1327819', 'castellano')).toMatch(/^https:\/\/voe\.sx\//);
    // A page that lists no servers at all says nothing either way.
    expect(unlimplayOffers('<html></html>', 'castellano')).toBeUndefined();
    expect(unlimplayOffers(page.replace(serverList, 'const EMBEDS = [];'), 'castellano')).toBeUndefined();
  });
});

describe('Fuegocine Spanish answers', () => {
  const day = 24 * 60 * 60 * 1000, url = 'https://unlimplay.com/f/embed/movie/1';
  const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
  afterEach(() => { vi.useRealTimers(); });
  it('asks again sooner about a page that was seen without Spanish than about one that has it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = memory(), answers = new SpanishAnswers(store);
    answers.set(url, true); answers.set(url + '2', false);
    vi.setSystemTime(Date.now() + day);
    expect([answers.get(url), answers.get(url + '2')]).toEqual([true, false]);
    vi.setSystemTime(Date.now() + 2 * day);
    expect([answers.get(url), answers.get(url + '2')]).toEqual([true, undefined]);
    // A later session sees the same.
    expect([new SpanishAnswers(store).get(url), new SpanishAnswers(store).get(url + '2')]).toEqual([true, undefined]);
    vi.setSystemTime(Date.now() + 5 * day);
    expect(answers.get(url)).toBeUndefined();
  });
});

describe('Fuegocine address policy', () => {
  it('only reads pages from the blog itself', () => {
    expect(fuegoContentURL(hoppersPage)).toBe(hoppersPage);
    expect(fuegoContentURL('/2026/05/x.html')).toBe(base + '2026/05/x.html');
    for (const bad of ['http://www.fuegocine.com/x', 'https://fuegocine.com.evil.example/x', 'https://www.fuegocine.com:8443/x', 'https://user:pass@www.fuegocine.com/x', 'https://evil.example/x', undefined]) expect(fuegoContentURL(bad), String(bad)).toBeUndefined();
  });
  it('unwraps a link wrapper only when it points to a plain file', () => {
    const wrapper = (link: string) => `https://repfuegocinefree.blogspot.com/?player=fluidplayer&format=video%2Fmp4&link=${encodeURIComponent(link)}`;
    expect(fuegoWrappedVideo(wrapper(mp4))).toBe(mp4);
    expect(fuegoWrappedVideo(wrapper('https://host.example/list.m3u8'))).toBe('https://host.example/list.m3u8');
    for (const bad of ['https://host.example/page.html', 'http://host.example/a.mp4', 'https://127.0.0.1/a.mp4', 'https://localhost/a.mp4', 'https://host.example/a.mp4?api_key=secret', 'https://host.example/a.mp4?token=abc']) expect(fuegoWrappedVideo(wrapper(bad)), bad).toBeUndefined();
    expect(fuegoWrappedVideo(wrapper(mp4).replace('repfuegocinefree.blogspot.com', 'evil.example'))).toBeUndefined();
    expect(fuegoDirectVideo(mp4)).toBe(mp4);
  });
  it('accepts only the known player pages', () => {
    expect(fuegoOkruURL('https://ok.ru/videoembed/9630825187952')).toBeTruthy();
    expect(fuegoUnlimplayURL('https://unlimplay.com/f/embed/movie/1327819')).toBeTruthy();
    expect(fuegoUnlimplayURL('https://unlimplay.com/play/embed/tv/284833/1/3')).toBeTruthy();
    expect(fuegoVoeURL('https://voe.sx/e/' + voeId)).toBeTruthy();
    for (const bad of ['https://ok.ru/video/1', 'https://ok.ru.evil.example/videoembed/1', 'http://ok.ru/videoembed/1', 'https://unlimplay.com/admin', 'https://unlimplay.com/play/embed/tv/1', 'https://voe.sx/e/', 'https://voe.sx/x/abc', 'https://evil.example/e/abc']) expect(fuegoAllowed(bad), bad).toBe(false);
    expect(fuegoAllowed(hoppersPage)).toBe(true);
  });
  it('allows video files and referrers on public https hosts only', () => {
    expect(fuegoMedia('https://vd580.okcdn.ru/video.m3u8?a=1')).toBeTruthy();
    for (const bad of ['http://vd580.okcdn.ru/video.m3u8', 'https://127.0.0.1/a.m3u8', 'https://localhost/a.m3u8', 'https://10.0.0.1/a.m3u8', 'https://printer.local/a.m3u8', 'https://user:pass@host.example/a.m3u8', 'https://host.example:8443/a.m3u8']) expect(fuegoMedia(bad), bad).toBeUndefined();
    expect(fuegoReferer('')).toBe(true);
    expect(fuegoReferer('https://ok.ru/')).toBe(true);
    expect(fuegoReferer('http://ok.ru/')).toBe(false);
    expect(fuegoReferer('https://127.0.0.1/')).toBe(false);
  });
  it('is part of the app wide policy', () => {
    expect(providerIdOf('fuegocine:/2026/05/hoppers-operacion-castor-2026.html')).toBe('fuegocine');
    expect(sourceAllowed(hoppersPage, defaultMirror)).toBe(true);
    expect(sourceAllowed('https://unlimplay.com/f/embed/movie/1', defaultMirror)).toBe(true);
    expect(sourceAllowed('https://evil.example/', defaultMirror)).toBe(false);
    const policy = mediaPolicy('fuegocine');
    expect(policy.media('https://vd580.okcdn.ru/video.m3u8')).toBeTruthy();
    expect(policy.referer('https://ok.ru/')).toBe(true);
    expect(mediaPolicy('fuegocine').media('http://vd580.okcdn.ru/video.m3u8')).toBeFalsy();
  });
});

describe('Fuegocine through the content source', () => {
  afterEach(() => vi.unstubAllGlobals());
  // What the app learned about a title's Spanish option is kept between sessions, so each test starts without it.
  beforeEach(() => localStorage.clear());
  const settings = () => ({ ...structuredClone(defaults.settings), mirror: defaultMirror, source: 'fuegocine' as const });
  type Link = { lang: string; name: string; url: string };
  // The movie post with its servers replaced, so every player kind can be driven through the real checks.
  function moviePost(links?: Link[]) {
    const data = JSON.parse(text('movie.json'));
    if (links) data.feed.entry[0].content.$t = data.feed.entry[0].content.$t.replace(/const _SV_LINKS = \[[\s\S]*?\n\s*\]\s*<\/script>/, `const _SV_LINKS = [${links.map(l => `{ lang: "${l.lang}", name: "${l.name}", url: "${l.url}" }`).join(',')}]\n</script>`);
    return data;
  }
  // `spanish` is what unlimplay answers: a Spanish option, only Latino, no such title (404) or a server error.
  // `flaky` leaves Spanish out of every other read, starting with the first. `flaky-down` leaves it out once and then fails.
  function network(options: { links?: Link[]; mp4Status?: number; spanish?: 'yes' | 'no' | 'gone' | 'down' | 'flaky' | 'flaky-down' } = {}) {
    let reads = 0;
    const seen: { url: string; referer?: string; timeout?: number }[] = [], posts = [moviePost(options.links).feed.entry[0], ...feed('series').entries, ...feed('episodes').entries].map((entry: FeedEntry) => ({ entry, path: new URL(entry.link!.find(l => l.rel === 'alternate')!.href).pathname }));
    const json = (value: unknown, final: string) => new Response(typeof value === 'string' ? value : JSON.stringify(value), { headers: { 'X-Rezka-URL': final } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const outer = new URL(String(input), 'http://localhost'), url = outer.searchParams.get('url')!, headers = new Headers(init?.headers);
      seen.push({ url, referer: headers.get('X-Rezka-Referer') || outer.searchParams.get('referer') || undefined, timeout: Number(headers.get('X-Rezka-Timeout')) || undefined });
      if (outer.pathname === '/api/content') {
        const address = new URL(url), page = (body: string, status = 200) => new Response(body, { status, headers: { 'X-Rezka-URL': url } });
        if (address.hostname === 'www.fuegocine.com' && address.pathname.startsWith('/feeds/posts/default')) {
          const params = address.searchParams, path = params.get('path'), decoded = decodeURIComponent(address.pathname);
          if (params.get('max-results') === '0') return json(text('labels.json'), url);
          if (path) { const post = posts.find(p => p.path === path); return json(post ? { feed: { entry: [post.entry] } } : { feed: {} }, url); }
          if (decoded.includes('/-/Episode/id-')) return json(text('episodes.json'), url);
          if (params.get('q')) return json(text('search.json'), url);
          if (decoded.includes('/-/Serie')) return json(text('listing-series.json'), url);
          if (decoded.includes('/-/Movie') || decoded.includes('/-/Animaci')) return json(text('listing.json'), url);
          return json(text('home.json'), url);
        }
        if (address.hostname === 'ok.ru') return page(text('okru.html'));
        if (address.hostname === 'unlimplay.com') {
          if (options.spanish === 'gone') return page('Not found', 404);
          if (options.spanish === 'down' || (options.spanish === 'flaky-down' && reads++ > 0)) return page('Bad gateway', 502);
          if (options.spanish === 'flaky') return page(reads++ % 2 === 1 ? withSpanish(text('unlimplay.html')) : text('unlimplay.html'));
          return page(options.spanish === 'yes' ? withSpanish(text('unlimplay.html')) : text('unlimplay.html'));
        }
        if (address.hostname === 'voe.sx') return page(voeEmbed);
        return page('Not found', 404);
      }
      const media = new URL(url);
      if (/\/(?:master|video)\.m3u8$/.test(media.pathname)) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8?t=Test');
      if (media.pathname.endsWith('index.m3u8')) return new Response('#EXTM3U\n#EXTINF:4,\nsegment0.ts?t=Test\n#EXT-X-ENDLIST');
      if (media.pathname.endsWith('.ts')) return new Response(new Uint8Array([0x47, 0x40, 0, 0x10]));
      if (media.pathname.endsWith('.mp4')) return new Response(options.mp4Status && options.mp4Status !== 200 ? 'Not found' : new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), { status: options.mp4Status || 200 });
      return new Response('Not found', { status: 404 });
    }));
    return { seen, feeds: () => seen.map(r => new URL(r.url)).filter(u => u.pathname.startsWith('/feeds/') && u.searchParams.get('max-results') !== '0').map(u => u.pathname + u.search) };
  }
  it('browses the blog and translates the app categories into its labels', async () => {
    const { feeds } = network(), source = new ContentSource(settings());
    const home = await source.catalogue();
    expect(home.items.length).toBeGreaterThan(0);
    // The episode mixed into the home feed is not a title.
    expect(home.items.every(i => i.kind === 'movie' || i.kind === 'series')).toBe(true);
    expect(home.categories.length).toBeGreaterThan(5);
    expect(home.hasNext).toBe(true);
    expect(feeds()[0]).toBe('/feeds/posts/default?alt=json&max-results=30');
    await source.catalogue('films/', 2);
    expect(feeds().at(-1)).toBe('/feeds/posts/default/-/Movie?alt=json&max-results=30&start-index=31');
    await source.catalogue('series/');
    expect(feeds().at(-1)).toBe('/feeds/posts/default/-/Serie?alt=json&max-results=30');
    await source.catalogue('cartoons/');
    expect(feeds().at(-1)).toBe('/feeds/posts/default/-/Animaci%C3%B3n?alt=json&max-results=30');
    await source.catalogue('films/accion/');
    expect(feeds().at(-1)).toBe('/feeds/posts/default/-/Movie/Acci%C3%B3n?alt=json&max-results=30');
    await source.catalogue(home.categories.find(c => c.url.includes('/series/accion/'))!.url);
    expect(feeds().at(-1)).toBe('/feeds/posts/default/-/Serie/Acci%C3%B3n?alt=json&max-results=30');
    const count = feeds().length;
    expect((await source.catalogue('films/no-such-genre/')).items).toEqual([]);
    expect(feeds().length).toBe(count);
  });
  it('searches the posts and offers no categories there', async () => {
    const { feeds } = network(), source = new ContentSource(settings());
    const found = await source.search('hoppers');
    expect(found.items.map(i => i.title)).toEqual(['Hoppers: Operacion Castor']);
    expect(found.categories).toEqual([]);
    expect(found.hasNext).toBe(false);
    expect(feeds().at(-1)).toBe('/feeds/posts/default?alt=json&max-results=30&q=hoppers');
    await source.search('hoppers', 2);
    expect(feeds().at(-1)).toBe('/feeds/posts/default?alt=json&max-results=30&start-index=31&q=hoppers');
  });
  it('never uses the Pelisflix mirror for this source', async () => {
    const { seen } = network(), source = new ContentSource({ ...settings(), mirror: 'https://pelisflix200.dog/' });
    await source.catalogue(); await source.search('hoppers');
    expect(seen.every(r => new URL(r.url).hostname === 'www.fuegocine.com')).toBe(true);
  });
  it('gets the seasons of a series from its episode posts', async () => {
    const { feeds } = network(), source = new ContentSource(settings());
    const detail = await source.details(show);
    expect(feeds()).toEqual(['/feeds/posts/default?alt=json&path=%2F2026%2F10%2Favatar-los-siete-refugios-2026.html', '/feeds/posts/default/-/Episode/id-989325726394545303?alt=json&max-results=500']);
    expect(detail.seasons?.map(s => [s.id, s.episodes.map(e => e.id)])).toEqual([['1', ['1', '2', '3']]]);
    expect(detail.translators?.[0]).toMatchObject({ id: 'latino', name: 'Latino' });
    expect(detail.kind).toBe('series');
  });
  it('plays a movie from the plain file first', async () => {
    const { seen } = network(), source = new ContentSource(settings());
    const detail = await source.details(movie);
    expect(detail.translators?.[0].sources).toHaveLength(2);
    const result = await source.playback(detail, { translator: 'latino' });
    expect(result.provider).toBe('fuegocine');
    expect(result.streams[0].mimeType).toBe('video/mp4');
    expect(result.streams[0].url).toBe(`/api/media?url=${encodeURIComponent(mp4)}&referer=&provider=fuegocine`);
    expect(seen.some(r => new URL(r.url).hostname === 'unlimplay.com')).toBe(false);
  });
  it('moves on to the next server when a file is gone', async () => {
    const { seen } = network({ mp4Status: 404 }), source = new ContentSource(settings());
    const result = await source.playback(await source.details(movie), { translator: 'latino' });
    expect(result.streams[0].mimeType).toBe('application/x-mpegURL');
    expect(decodeURIComponent(result.streams[0].url)).toContain(voeStream);
    expect(result.headers.Referer).toBe('https://voe.sx/e/' + voeId);
    expect(seen.filter(r => new URL(r.url).hostname === 'unlimplay.com')).toHaveLength(1);
    expect(seen.filter(r => new URL(r.url).hostname === 'voe.sx')).toHaveLength(1);
  });
  it('plays an episode through unlimplay and VOE', async () => {
    const { seen, feeds } = network(), source = new ContentSource(settings());
    const detail = await source.details(show);
    const result = await source.playback(detail, { translator: 'latino', season: '1', episode: '3' });
    expect(result.provider).toBe('fuegocine');
    expect(decodeURIComponent(result.streams[0].url)).toContain(voeStream);
    expect(feeds().at(-1)).toBe('/feeds/posts/default?alt=json&path=%2F2026%2F10%2Favatar-los-siete-refugios-1x3.html');
    const player = seen.find(r => new URL(r.url).hostname === 'unlimplay.com')!;
    expect(player.url).toBe('https://unlimplay.com/play/embed/tv/284833/1/3');
    expect(player.referer).toBe(show.page);
    await expect(source.playback(detail, { translator: 'castellano', season: '1', episode: '3' })).rejects.toThrow('selected audio');
    await expect(source.playback(detail, { translator: 'latino', season: '2', episode: '1' })).rejects.toThrow('Choose a season');
  });
  it('waits long enough for the unlimplay page', async () => {
    // unlimplay holds its page back for up to about 16 seconds before sending it, so the usual wait is not enough.
    const { seen } = network(), source = new ContentSource(settings());
    await source.playback(await source.details(show), { translator: 'latino', season: '1', episode: '3' });
    expect(seen.find(r => new URL(r.url).hostname === 'unlimplay.com')!.timeout).toBeGreaterThanOrEqual(45000);
  });
  it('plays an ok.ru playlist with its own referrer', async () => {
    network({ links: [{ lang: 'lat', name: 'OK', url: 'https://ok.ru/videoembed/9630825187952' }] });
    const source = new ContentSource(settings()), result = await source.playback(await source.details(movie), { translator: 'latino' });
    expect(result.headers.Referer).toBe('https://ok.ru/');
    expect(result.streams[0].url).toContain('&referer=https%3A%2F%2Fok.ru%2F&provider=fuegocine');
    expect(decodeURIComponent(result.streams[0].url)).toContain('vd580.okcdn.ru/video.m3u8');
  });
  it('reports a title without any supported server', async () => {
    network({ links: [{ lang: 'lat', name: 'Drive', url: 'https://drive.google.com/file/d/abc/preview' }] });
    const source = new ContentSource(settings()), detail = await source.details(movie);
    expect(detail.translators).toEqual([]);
    await expect(source.playback(detail, { translator: 'latino' })).rejects.toThrow();
  });
  const player = (seen: { url: string; referer?: string; timeout?: number }[]) => seen.filter(r => new URL(r.url).hostname === 'unlimplay.com');
  it('leaves the unlimplay page alone while details are read for browsing', async () => {
    const { seen } = network({ spanish: 'yes' }), source = new ContentSource(settings());
    expect((await source.details(movie)).translators!.map(t => t.id)).toEqual(['latino']);
    expect(player(seen)).toHaveLength(0);
  });
  it('checks the unlimplay page for a Spanish option when asked, and prefers it', async () => {
    const { seen } = network({ spanish: 'yes' }), source = new ContentSource(settings());
    const detail = await source.details(movie, { castellano: true });
    expect(detail.translators!.map(t => [t.id, t.selected])).toEqual([['latino', false], ['castellano', true]]);
    expect(detail.audioPending).toBeUndefined();
    const [check] = player(seen);
    expect(player(seen)).toHaveLength(1);
    expect(check.url).toBe('https://unlimplay.com/f/embed/movie/1327819');
    expect(check.referer).toBe(movie.page);
    expect(check.timeout).toBeGreaterThanOrEqual(15000);
    // The option plays: the Spanish list of the same page leads to the VOE stream.
    const result = await source.playback(detail, { translator: 'castellano' });
    expect(decodeURIComponent(result.streams[0].url)).toContain(voeStream);
  });
  it('remembers what it learned, for other screens and for the next session', async () => {
    const { seen } = network({ spanish: 'yes' });
    await new ContentSource(settings()).details(movie, { castellano: true });
    expect(player(seen)).toHaveLength(1);
    const later = await new ContentSource(settings()).details(movie, { castellano: true });
    expect(later.translators!.map(t => t.id)).toEqual(['latino', 'castellano']);
    // Without the check, a title already known to have it still offers it, but does not jump to it.
    const plain = await new ContentSource(settings()).details(movie);
    expect(plain.translators!.map(t => [t.id, t.selected])).toEqual([['latino', true], ['castellano', false]]);
    expect(player(seen)).toHaveLength(1);
  });
  it('does not offer Castellano when the page only has Latino, and remembers that too', async () => {
    const { seen } = network({ spanish: 'no' });
    const detail = await new ContentSource(settings()).details(movie, { castellano: true });
    expect(detail.translators!.map(t => t.id)).toEqual(['latino']);
    expect(detail.audioPending).toBeUndefined();
    // A page without Spanish is read a second time before that is believed.
    expect(player(seen)).toHaveLength(2);
    await new ContentSource(settings()).details(movie, { castellano: true });
    expect(player(seen)).toHaveLength(2);
  });
  it('takes Spanish from the second read when the first page left it out', async () => {
    const { seen } = network({ spanish: 'flaky' }), source = new ContentSource(settings());
    const detail = await source.details(movie, { castellano: true });
    expect(detail.translators!.map(t => [t.id, t.selected])).toEqual([['latino', false], ['castellano', true]]);
    expect(player(seen)).toHaveLength(2);
    // Playing reads the page again, which can leave Spanish out as well, so it asks once more instead of failing.
    const result = await source.playback(detail, { translator: 'castellano' });
    expect(decodeURIComponent(result.streams[0].url)).toContain(voeStream);
    expect(player(seen)).toHaveLength(4);
  });
  it('does not take a page that was read once without Spanish as the answer when the second read fails', async () => {
    const { seen } = network({ spanish: 'flaky-down' }), source = new ContentSource(settings());
    expect(await source.details(movie, { castellano: true })).toMatchObject({ audioPending: true });
    expect(player(seen)).toHaveLength(2);
    // Nothing was kept, so the next look reads the page again. Its first read fails, so there is no second one.
    await source.details(movie, { castellano: true });
    expect(player(seen)).toHaveLength(3);
  });
  it('counts a title that unlimplay does not have as having no Spanish option', async () => {
    const { seen } = network({ spanish: 'gone' }), source = new ContentSource(settings());
    const detail = await source.details(movie, { castellano: true });
    expect(detail.translators!.map(t => t.id)).toEqual(['latino']);
    expect(detail.audioPending).toBeUndefined();
    await new ContentSource(settings()).details(movie, { castellano: true });
    expect(player(seen)).toHaveLength(1);
  });
  it('marks a check that failed as unfinished and tries it again the next time', async () => {
    const { seen } = network({ spanish: 'down' }), source = new ContentSource(settings());
    const detail = await source.details(movie, { castellano: true });
    expect(detail).toMatchObject({ audioPending: true });
    expect(detail.translators!.map(t => t.id)).toEqual(['latino']);
    await source.details(movie, { castellano: true });
    expect(player(seen)).toHaveLength(2);
  });
  it('checks a series through its first episode and plays the Spanish option of another episode', async () => {
    const { seen } = network({ spanish: 'yes' }), source = new ContentSource(settings());
    const detail = await source.details(show, { castellano: true });
    expect(player(seen).map(r => r.url)).toEqual(['https://unlimplay.com/play/embed/tv/284833/1/1']);
    expect(detail.translators!.map(t => [t.id, t.selected])).toEqual([['latino', false], ['castellano', true]]);
    const result = await source.playback(detail, { translator: 'castellano', season: '1', episode: '3' });
    expect(decodeURIComponent(result.streams[0].url)).toContain(voeStream);
    expect(player(seen).at(-1)!.url).toBe('https://unlimplay.com/play/embed/tv/284833/1/3');
    expect(await source.details(show, { castellano: true })).toBe(detail);
  });
  it('reports an episode that has no Spanish option when its audio is chosen anyway', async () => {
    network({ spanish: 'no' });
    const source = new ContentSource(settings()), detail = await source.details(show);
    await expect(source.playback(detail, { translator: 'castellano', season: '1', episode: '3' })).rejects.toThrow('selected audio');
  });
  it('keeps only the Fuegocine titles whose page offers Castellano when the filter asks', async () => {
    const card = parseFuegoCard(feed('movie').entries[0])!, rules = { excluded: [], castellano: true };
    expect(card.audio).toBeUndefined();
    network({ spanish: 'yes' });
    const kept = await discoverable([card], rules, item => new ContentSource(settings()).details(item, { castellano: true }), new Map());
    expect(kept.map(i => [i.id, i.audio])).toEqual([[card.id, ['latino', 'castellano']]]);
    localStorage.clear(); network({ spanish: 'no' });
    expect(await discoverable([card], rules, item => new ContentSource(settings()).details(item, { castellano: true }), new Map())).toEqual([]);
    localStorage.clear(); network({ spanish: 'down' });
    expect((await discoverable([card], rules, item => new ContentSource(settings()).details(item, { castellano: true }), new Map())).map(i => i.id)).toEqual([card.id]);
  });
  it('opens a saved title with its own source whichever source is active', async () => {
    const { seen } = network(), source = new ContentSource({ ...settings(), source: 'pelisflix' });
    const detail = await source.details(movie);
    expect(detail.translators?.length).toBeGreaterThan(0);
    expect(seen.every(r => new URL(r.url).hostname === 'www.fuegocine.com')).toBe(true);
  });
  it('reports a post that no longer exists', async () => {
    network();
    const source = new ContentSource(settings());
    await expect(source.details({ ...movie, id: 'fuegocine:/2026/01/gone.html', page: base + '2026/01/gone.html' })).rejects.toThrow('no longer available');
  });
  it('refuses to open addresses outside the supported hosts', async () => {
    const source = new ContentSource(settings());
    await expect(source.request('https://ads.example/x')).rejects.toThrow('outside');
    await expect(source.request('https://www.fuegocine.com.evil.example/x')).rejects.toThrow('outside');
    await expect(source.request('https://voe.sx.evil.example/e/abc')).rejects.toThrow('outside');
  });
});

describe.skipIf(!process.env.PELISFLIX_LIVE)('Fuegocine live site', () => {
  it('still finds and plays Hoppers', async () => {
    const source = new ContentSource({ ...structuredClone(defaults.settings), source: 'fuegocine' });
    const found = await source.search('hoppers');
    expect(found.items.length).toBeGreaterThan(0);
    const detail = await source.details(found.items[0]);
    const result = await source.playback(detail, { translator: detail.translators![0].id });
    expect(result.streams[0].url).toBeTruthy();
  }, 90000);
});
