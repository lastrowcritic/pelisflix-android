import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { ContentSource } from '../src/core/source';
import { defaults } from '../src/core/store';
import { defaultMirror } from '../src/core/pelisflix';
import { unpack } from '../src/core/providers/players';
import { mediaPolicy, providerIdOf, sourceAllowed } from '../src/core/providers/policy';
import { forteAllowed, forteContentURL, forteMedia, fortePlayerURL, forteReferer, pelisforteBase } from '../src/core/providers/pelisforte-policy';
import { forteGenres, forteHop, forteID, forteSeasonRequest, forteSeriesPath, parseForteAudio, parseForteCatalogue, parseForteDetails, parseForteEpisodes, parseOkhdEmbed } from '../src/core/providers/pelisforte-parse';
import type { Item } from '../src/core/types';

const fixture = (name: string) => readFileSync(`tests/fixtures/pelisforte/${name}.html`, 'utf8');
const base = pelisforteBase;
const movie: Item = { id: forteID(base + 'pelicula/spider-man-un-nuevo-dia-2026-1785823489'), title: 'Spider-Man: Un nuevo día', kind: 'movie', page: base + 'pelicula/spider-man-un-nuevo-dia-2026-1785823489', genre: '', synopsis: '' };
const show: Item = { id: forteID(base + 'serie/el-juego-del-calamar-2021'), title: 'El juego del calamar', kind: 'series', isSeries: true, page: base + 'serie/el-juego-del-calamar-2021', genre: '', synopsis: '' };
afterEach(() => { vi.useRealTimers(); localStorage.clear(); vi.unstubAllGlobals(); });

describe('Pelisforte catalogue', () => {
  it('reads title cards with the largest artwork, ratings and pagination', () => {
    const data = parseForteCatalogue(fixture('listing'), base + 'todas-las-peliculas', 1);
    expect(data.items).toHaveLength(4);
    expect(new Set(data.items.map(i => i.id)).size).toBe(4);
    expect(data.items[0]).toMatchObject({ title: 'Spider-Man: Un nuevo día', kind: 'movie', rating: '8', page: movie.page, id: movie.id });
    expect(data.items[0].poster).toMatch(/^https:\/\/www2\.pelisforte\.se\/wp-content\/uploads\/.+-\d+x\d+\.webp$/);
    expect(data.items[0].poster).not.toContain('100x150');
    expect(data.hasNext).toBe(true);
    expect(parseForteCatalogue(fixture('listing-2'), base + 'todas-las-peliculas/page/2', 2).hasNext).toBe(true);
  });
  it('lists genres from the menu with readable slugs and keeps the page behind numbered ones', () => {
    const { categories } = parseForteCatalogue(fixture('listing'), base);
    const genres = categories.filter(c => c.kind === 'movie');
    expect(genres.length).toBeGreaterThan(5);
    expect(genres.every(c => /\/films\/[a-z0-9-]+\/(\?genre=[a-z0-9-]+)?$/.test(c.url))).toBe(true);
    const numbered = genres.find(c => c.url.includes('?genre='))!;
    expect(numbered.url).toMatch(/films\/[a-z-]+\/\?genre=[a-z-]+-p\d+$/);
    expect(categories.at(-1)).toEqual({ name: 'All series', kind: 'series', url: base + 'series/' });
    const map = forteGenres(categories);
    expect(map.get('accion')).toBe('accion-p01');
    expect(map.get('aventura')).toBe('aventura');
  });
  it('finds the series page behind the menu and ignores a page without pagination', () => {
    expect(forteSeriesPath(fixture('listing'), base)).toBe('series-1746289646');
    const list = parseForteCatalogue(fixture('series-list'), base + 'series-1746289646', 1);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every(i => i.kind === 'series' && i.isSeries)).toBe(true);
    expect(list.hasNext).toBe(false);
  });
  it('reads search results', () => {
    const data = parseForteCatalogue(fixture('search'), base + '?s=calamar', 1);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.some(i => /calamar/i.test(i.title))).toBe(true);
  });
  it('skips advertisement cards and off-site links even in real card markup', () => {
    const ad = '<ul><li><article class="post dfx fcl movies"><h2 class="entry-title">Casino</h2><a class="lnk-blk" href="https://casino.example/pelicula/win"></a></article></li>'
      + '<li><article class="post"><h2 class="entry-title">Spoof</h2><a class="lnk-blk" href="https://www2.pelisforte.se.evil.example/pelicula/x"></a></article></li>'
      + '<li><article class="post"><h2 class="entry-title">Promo</h2><a class="lnk-blk" href="https://www2.pelisforte.se/promo/oferta"></a></article></li>'
      + '<li><article class="post"><h2 class="entry-title">Script</h2><a class="lnk-blk" href="javascript:alert(1)"></a></article></li></ul>';
    expect(parseForteCatalogue(ad, base).items).toEqual([]);
    const html = fixture('listing').replace('<ul class="post-lst rw sm">', '<ul class="post-lst rw sm"><li><article class="post"><h2 class="entry-title">Promo</h2><a class="lnk-blk" href="https://www2.pelisforte.se/promo/oferta"></a></article></li>');
    expect(parseForteCatalogue(html, base).items).toHaveLength(4);
  });
});

describe('Pelisforte titles', () => {
  it('reads a movie page with its real synopsis and the Okhd audio tracks only', () => {
    const detail = parseForteDetails(fixture('movie'), movie.page!, movie);
    expect(detail.title).toBe('Spider-Man: Un nuevo día');
    expect(detail.year).toBe(2026);
    expect(detail.duration).toBeGreaterThan(60);
    expect(detail.synopsis.length).toBeGreaterThan(40);
    expect(detail.synopsis).not.toMatch(/^disfruta de esta/i);
    expect(detail.poster).toMatch(/^https:\/\//);
    expect(detail.seasons).toBeUndefined();
    expect(detail.translators?.length).toBeGreaterThan(0);
    for (const t of detail.translators!) {
      expect(['latino', 'castellano', 'subtitulado']).toContain(t.id);
      expect(t.sources!.every(s => s.name.toLowerCase() === 'okhd' && s.url.startsWith('https://mp4.nu/'))).toBe(true);
    }
    expect(detail.translators![0].selected).toBe(true);
  });
  it('lists seasons with the episodes already on the page and leaves the other seasons to be loaded', () => {
    const detail = parseForteDetails(fixture('series'), show.page!, show);
    expect(detail.seasons?.map(s => s.id)).toEqual(['1', '2', '3']);
    expect(detail.seasons![2].episodes.map(e => e.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(detail.seasons![2].episodes[0]).toMatchObject({ season: '3', title: 'Episode 1', page: base + 'episodio/el-juego-del-calamar-3x1' });
    expect(detail.seasons![0].episodes).toEqual([]);
    expect(forteSeasonRequest(fixture('series'))).toMatchObject({ post: '28577', nonce: expect.stringMatching(/^[a-z0-9]+$/) });
  });
  it('reads the episodes of a season answer', () => {
    const episodes = parseForteEpisodes(fixture('season-ajax'), base, '3');
    expect(episodes.map(e => e.id)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(parseForteEpisodes('', base, '2')).toEqual([]);
  });
  it('reads the audio of an episode page', () => {
    const audio = parseForteAudio(fixture('episode'), base + 'episodio/el-juego-del-calamar-3x1');
    expect(audio.length).toBeGreaterThan(0);
    expect(audio.flatMap(t => t.sources!).every(s => fortePlayerURL(s.url))).toBe(true);
  });
  it('never accepts a player or a label that is not Okhd', () => {
    const tab = (label: string, src: string) => `<a href="#options-1">${label}</a><div id="options-1"><iframe src="${src}"></iframe></div>`;
    expect(parseForteAudio(tab('OPCIÓN 1 Streamwish -Español Latino', 'https://mp4.nu/?h=a'), base)).toEqual([]);
    expect(parseForteAudio(tab('OPCIÓN 3 Okhd -Español Latino', 'https://ads.example/?h=a'), base)).toEqual([]);
    expect(parseForteAudio(tab('OPCIÓN 3 Okhd -Japonés', 'https://mp4.nu/?h=a'), base)).toEqual([]);
    expect(parseForteAudio(tab('OPCIÓN 3 Okhd -Subtitulado', 'https://mp4.nu/?h=a'), base)[0]).toMatchObject({ id: 'subtitulado', name: 'Subtitled' });
  });
});

describe('Pelisforte player chain', () => {
  const embed = () => fixture('okhd-embed');
  it('unpacks the player settings as text without running the script', () => {
    (globalThis as any).forteUnsafe = false;
    const text = unpack(embed() + '<script>globalThis.forteUnsafe=true</script>');
    expect(text).toMatch(/file:"https:\/\/[^"]+\.m3u8/);
    expect((globalThis as any).forteUnsafe).toBe(false);
  });
  it('follows the wrapper redirect only on the player wrapper', () => {
    const hop = forteHop(fixture('mp4-stub'), 'https://mp4.nu/?h=abc');
    expect(hop).toMatch(/^https:\/\/mp4\.nu\/r\.php\?h=/);
    expect(forteHop(fixture('mp4-stub'), 'https://okhd.nu/embed-1.html')).toBeUndefined();
    expect(forteHop('<script>location.replace("https://evil.example/x")</script>', 'https://mp4.nu/?h=abc')).toBeUndefined();
  });
  it('reads the HLS playlist of an Okhd embed page', () => {
    const source = parseOkhdEmbed(embed(), 'https://okhd.nu/embed-test.html');
    expect(source.streams[0]).toMatchObject({ quality: 'Auto', mimeType: 'application/x-mpegURL' });
    expect(source.streams[0].url).toMatch(/^https:\/\/s[a-z0-9]+\.okhd\.nu\/hls2\/.+master\.m3u8/);
    expect(source.headers.Referer).toBe('https://okhd.nu/embed-test.html');
  });
  it('rejects embeds from other websites and playlists from other hosts', () => {
    expect(() => parseOkhdEmbed(embed(), 'https://evil.example/embed-test.html')).toThrow('not supported');
    const foreign = '<script>player.setup({file:"https://ads.example/master.m3u8"})</script>';
    expect(() => parseOkhdEmbed(foreign, 'https://okhd.nu/embed-test.html')).toThrow('not supported');
    expect(() => parseOkhdEmbed('<html></html>', 'https://okhd.nu/embed-test.html')).toThrow('playable');
  });
});

describe('Pelisforte address policy', () => {
  it('allows only the site, the wrapper and the Okhd network', () => {
    expect(forteContentURL('/pelicula/x', base)).toBe(base + 'pelicula/x');
    expect(forteContentURL('https://www2.pelisforte.se.evil.example/pelicula/x')).toBeUndefined();
    expect(forteContentURL('http://www2.pelisforte.se/pelicula/x')).toBeUndefined();
    expect(forteContentURL('https://user:pass@www2.pelisforte.se/pelicula/x')).toBeUndefined();
    expect(fortePlayerURL('https://mp4.nu/?h=a')).toBeDefined();
    expect(fortePlayerURL('https://s12.okhd.nu/hls2/x')).toBeDefined();
    expect(fortePlayerURL('https://okhd.nu.evil.example/x')).toBeUndefined();
    expect(forteAllowed('https://mp4.nu/r.php?h=a')).toBe(true);
    expect(forteAllowed('https://ads.example/x')).toBe(false);
    expect(forteMedia('https://s12.okhd.nu/hls2/x/master.m3u8')).toBeDefined();
    expect(forteMedia('https://mp4.nu/x.m3u8')).toBeUndefined();
    expect(forteReferer('https://mp4.nu/?h=a')).toBe(true);
    expect(forteReferer('https://ads.example/')).toBe(false);
  });
  it('is part of the shared policy and routes titles by their id', () => {
    expect(sourceAllowed(base + 'pelicula/x', defaultMirror)).toBe(true);
    expect(sourceAllowed('https://s1.okhd.nu/x', defaultMirror)).toBe(true);
    expect(sourceAllowed('https://ads.example/x', defaultMirror)).toBe(false);
    expect(providerIdOf(movie.id)).toBe('pelisforte');
    expect(providerIdOf('some-old-pelisflix-id')).toBe('pelisflix');
    expect(mediaPolicy('pelisforte').media('https://s1.okhd.nu/hls2/a/master.m3u8')).toBeDefined();
    expect(mediaPolicy('pelisforte').media('https://ugc-cdn.cloudwindow-route.com/x')).toBeUndefined();
    expect(mediaPolicy().referer('https://nupload.my/watch/a')).toBe(true);
  });
});

describe('Pelisforte through the content source', () => {
  const settings = () => ({ ...structuredClone(defaults.settings), mirror: defaultMirror, source: 'pelisforte' as const });
  const embedURL = 'https://okhd.nu/embed-test.html';
  // Serves every call a real playback makes so the true request() safety checks run.
  function network(options: { seasons?: Record<string, string>; removed?: boolean } = {}) {
    const seen: { url: string; referer?: string; method: string; body?: string }[] = [];
    let master = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const outer = new URL(String(input), 'http://localhost'), url = outer.searchParams.get('url')!, headers = new Headers(init?.headers);
      seen.push({ url, referer: headers.get('X-Rezka-Referer') || undefined, method: init?.method || 'GET', body: init?.body as string | undefined });
      const page = (text: string, final = url, status = 200) => new Response(text, { status, headers: { 'X-Rezka-URL': final } });
      if (outer.pathname === '/api/content') {
        const address = new URL(url);
        if (address.pathname === '/wp-admin/admin-ajax.php') return page(options.seasons?.[new URLSearchParams(String(init?.body)).get('season')!] ?? '');
        if (address.pathname.startsWith('/episodio/')) return page(fixture('episode'));
        if (address.pathname.startsWith('/serie/')) return page(fixture('series'));
        if (address.pathname.startsWith('/pelicula/')) return page(fixture('movie'));
        if (address.pathname.startsWith('/series-')) return page(fixture('series-list'));
        if (address.hostname === 'www2.pelisforte.se') return page(url.includes('page/2') ? fixture('listing-2') : url.includes('?s=') ? fixture('search') : fixture('listing'));
        if (address.hostname === 'mp4.nu' && address.pathname === '/') return page(fixture('mp4-stub'));
        if (address.hostname === 'mp4.nu' && address.pathname === '/r.php') return page(options.removed ? '<html><body>Video Removed</body></html>' : fixture('okhd-embed'), embedURL);
        return page('Not found', url, 404);
      }
      if (url.endsWith('master.m3u8') || url.includes('master.m3u8?')) { master = url; return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8?t=Test'); }
      if (url.includes('index.m3u8')) return new Response('#EXTM3U\n#EXTINF:4,\nsegment0.ts?t=Test\n#EXT-X-ENDLIST');
      if (url.includes('segment0.ts')) return new Response(new Uint8Array([0x47, 0x40, 0, 0x10]));
      return new Response('Not found', { status: 404 });
    }));
    return { seen, master: () => master };
  }
  it('browses the chosen source and translates the app categories into its own listings', async () => {
    const { seen } = network(), source = new ContentSource(settings());
    const home = await source.catalogue();
    expect(home.items.length).toBeGreaterThan(0);
    expect(home.categories.length).toBeGreaterThan(5);
    expect(seen[0].url).toBe(base + 'todas-las-peliculas');
    await source.catalogue('films/', 2);
    expect(seen.at(-1)!.url).toBe(base + 'todas-las-peliculas/page/2');
    await source.catalogue('series/');
    expect(seen.at(-1)!.url).toBe(base + 'series-1746289646');
    await source.catalogue('films/accion/');
    expect(seen.at(-1)!.url).toBe(base + 'peliculas/accion-p01');
    await source.catalogue(home.categories.find(c => c.url.includes('/films/aventura/'))!.url);
    expect(seen.at(-1)!.url).toBe(base + 'peliculas/aventura');
    await source.catalogue('cartoons/');
    expect(seen.at(-1)!.url).toMatch(/\/peliculas\/animacion/);
    await source.search('calamar');
    expect(seen.at(-1)!.url).toBe(base + '?s=calamar');
    await source.search('calamar', 2);
    expect(seen.at(-1)!.url).toBe(base + 'page/2/?s=calamar');
  });
  it('does not use the Pelisflix mirror for this source', async () => {
    const { seen } = network(), source = new ContentSource({ ...settings(), mirror: 'https://pelisflix200.dog/' });
    await source.catalogue();
    expect(seen.every(r => new URL(r.url).hostname === 'www2.pelisforte.se')).toBe(true);
  });
  it('loads the seasons the page does not carry and drops the empty ones', async () => {
    const second = fixture('season-ajax').replaceAll('3x', '2x');
    const { seen } = network({ seasons: { '2': second } }), source = new ContentSource(settings());
    const detail = await source.details(show);
    expect(detail.seasons?.map(s => s.id)).toEqual(['2', '3']);
    expect(detail.seasons![0].episodes[0].page).toBe(base + 'episodio/el-juego-del-calamar-2x1');
    const ajax = seen.filter(r => r.url.endsWith('admin-ajax.php'));
    expect(ajax.map(r => r.method)).toEqual(['POST', 'POST']);
    expect(new URLSearchParams(ajax[0].body).get('action')).toBe('action_select_season');
    expect(detail.translators?.length).toBeGreaterThan(0);
  });
  it('plays an episode through the wrapper and the Okhd embed', async () => {
    const { seen, master } = network(), source = new ContentSource(settings());
    const detail = await source.details(show);
    const result = await source.playback(detail, { translator: detail.translators![0].id, season: '3', episode: '1' });
    expect(result.provider).toBe('pelisforte');
    expect(result.streams[0].mimeType).toBe('application/x-mpegURL');
    expect(result.headers.Referer).toBe(embedURL);
    expect(result.streams[0].url).toMatch(/^\/api\/media\?url=https%3A%2F%2Fs[a-z0-9]+\.okhd\.nu%2F/);
    expect(result.streams[0].url).toContain(`&referer=${encodeURIComponent(embedURL)}&provider=pelisforte`);
    expect(master()).toMatch(/okhd\.nu/);
    const wrapper = seen.filter(r => new URL(r.url).hostname === 'mp4.nu');
    expect(wrapper.map(r => new URL(r.url).pathname)).toEqual(['/', '/r.php']);
    // The second wrapper page is requested with the first one as its referrer.
    expect(wrapper[1].referer).toBe(wrapper[0].url);
  });
  it('plays a movie and reports a removed video clearly', async () => {
    network();
    const source = new ContentSource(settings()), detail = await source.details(movie);
    expect((await source.playback(detail, { translator: detail.translators![0].id })).streams).toHaveLength(1);
    vi.unstubAllGlobals(); network({ removed: true });
    const other = new ContentSource(settings());
    await expect(other.playback(await other.details(movie), { translator: detail.translators![0].id })).rejects.toThrow('could not be opened');
  });
  it('opens a saved title with its own source whichever source is active', async () => {
    const { seen } = network(), source = new ContentSource({ ...settings(), source: 'pelisflix' });
    const detail = await source.details(movie);
    expect(detail.translators?.length).toBeGreaterThan(0);
    expect(seen.every(r => new URL(r.url).hostname === 'www2.pelisforte.se')).toBe(true);
  });
  it('refuses to open addresses outside the supported hosts', async () => {
    const source = new ContentSource(settings());
    await expect(source.request('https://ads.example/x')).rejects.toThrow('outside');
    await expect(source.request('https://evil.okhd.nu.example/x')).rejects.toThrow('outside');
  });
});

describe.skipIf(!process.env.PELISFLIX_LIVE)('Pelisforte live site', () => {
  it('still plays the Squid Game episode used while building the source', async () => {
    const source = new ContentSource({ ...structuredClone(defaults.settings), source: 'pelisforte' });
    const item: Item = { id: forteID(base + 'serie/el-juego-del-calamar-2021'), title: 'El juego del calamar', kind: 'series', isSeries: true, page: base + 'serie/el-juego-del-calamar-2021', genre: '', synopsis: '' };
    const detail = await source.details(item);
    expect(detail.seasons?.length).toBeGreaterThan(0);
    const season = detail.seasons!.at(-1)!;
    const result = await source.playback(detail, { translator: detail.translators![0].id, season: season.id, episode: season.episodes[0].id });
    expect(result.streams[0].url).toContain('okhd.nu');
  }, 60000);
});
