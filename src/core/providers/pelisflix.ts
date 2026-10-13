import type { Catalogue, Collection, Item, Selection, Source } from '../types';
import type { Attempt, Provider, ProviderHost } from './types';
import { InvalidCatalogue, MirrorManager } from '../mirrors';
import { rebaseURL, trustedPlayerURL } from '../pelisflix-policy';
import { parsePelisflixAudio, parsePelisflixCatalogue, parsePelisflixCollections, parsePelisflixDetails, parsePelisflixEmbed, parsePelisflixEpisodes, parsePelisflixHost, parsePelisflixVoe } from '../pelisflix';
import { catalogueURL, chooseAudio } from './paging';

export class PelisflixProvider implements Provider {
  readonly id = 'pelisflix' as const;
  private mirrors: MirrorManager;
  private genrePages = new Map<string, Map<number, number>>();
  constructor(private host: ProviderHost) { this.mirrors = new MirrorManager((...args) => this.host.request(...args), () => this.host.settings.mirror, url => this.host.selectMirror(url)); }
  rebase(raw: string, base = this.host.settings.mirror) { return rebaseURL(raw, base); }
  withMirror<T>(operation: (base: string) => Promise<T>): Promise<T> { return this.mirrors.run(operation); }
  catalogue(path: string | undefined, page: number, filter?: string): Promise<Catalogue> {
    return this.withMirror(async base => {
      let url = new URL(path || base, base), kind: string | undefined;
      const match = url.pathname.match(/^\/(films|series|cartoons|animation)\/(?:([^/]+)\/)?$/);
      if (match) { kind = match[1] === 'series' ? 'series' : match[1] === 'films' ? 'movie' : undefined; url = new URL(match[2] ? `genero/${match[2]}/` : match[1] === 'series' ? 'series-online/' : match[1] === 'films' ? 'peliculas-online/' : 'genero/animacion/', base); }
      else url = new URL(this.rebase(url.href, base));
      const key = `${url.href}:${kind || ''}`, pages = this.genrePages.get(key) || new Map<number, number>(); this.genrePages.set(key, pages);
      if (kind && page > 1 && !pages.has(page - 1)) await this.catalogue(path, page - 1, filter);
      let physical = kind ? (pages.get(page - 1) || 0) + 1 : page;
      while (true) {
        const address = catalogueURL(url.href, physical), r = await this.host.html(address, 60000), data = parsePelisflixCatalogue(r.text, r.url, physical);
        if (!data.items.length && physical === 1 && !/búsqueda|sin resultados|no se encontr/i.test(r.text)) { this.host.forget(address); throw new InvalidCatalogue('The catalogue could not be read. Try again shortly.'); }
        if (kind) data.items = data.items.filter(i => i.kind === kind);
        if (data.items.length || !kind || !data.hasNext) { pages.set(page, physical); return data; }
        physical++;
      }
    });
  }
  search(query: string, page: number): Promise<Catalogue> {
    return this.withMirror(async base => { const url = new URL(catalogueURL(base, page)); url.searchParams.set('s', query); const r = await this.host.html(url.href, 60000); return parsePelisflixCatalogue(r.text, r.url, page); });
  }
  details(item: Item): Promise<Item> {
    return this.withMirror(async base => {
      const r = await this.host.html(this.rebase(item.page!, base)); let detailed = parsePelisflixDetails(r.text, r.url, item);
      if (detailed.isSeries && detailed.seasons?.length) {
        const seasons = [...detailed.seasons]; let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(3, seasons.length) }, async () => { while (cursor < seasons.length) { const index = cursor++, season = seasons[index]; if (!season.page) continue; const response = await this.host.html(season.page); seasons[index] = { ...season, episodes: parsePelisflixEpisodes(response.text, response.url, season.id) }; } }));
        detailed = { ...detailed, seasons }; const first = seasons.flatMap(s => s.episodes)[0];
        if (first?.page) { const response = await this.host.html(first.page); detailed.translators = parsePelisflixAudio(response.text, response.url); }
      }
      return detailed;
    });
  }
  async attempts(item: Item, selection: Selection): Promise<Attempt[]> {
    let page = item.page!, audio = item.translators || [];
    if (item.isSeries) {
      const episode = item.seasons?.find(s => s.id === selection.season)?.episodes.find(e => e.id === selection.episode);
      if (!episode?.page) throw new Error('Choose a season and episode.');
      page = episode.page; const response = await this.host.html(page); audio = parsePelisflixAudio(response.text, response.url);
    }
    return chooseAudio(audio, selection).sources!.map(option => () => this.resolvePlayer(option.url, page));
  }
  // Players can chain: a nupload page may only wrap a VOE player, which redirects to its embed page. Every hop is checked before it is requested.
  private async resolvePlayer(start: string, page: string): Promise<Source> {
    let url = start, referer = page;
    for (let hop = 0; hop < 4; hop++) {
      const response = await this.host.request(url, undefined, referer), next = parsePelisflixEmbed(response.text, response.url);
      if (!next) return /^nupload\.m[ey]$/.test(new URL(response.url).hostname) ? parsePelisflixHost(response.text, response.url) : parsePelisflixVoe(response.text, response.url);
      if (!trustedPlayerURL(next)) this.host.trust(next);
      url = next; referer = response.url;
    }
    throw new Error('This video server redirected too many times.');
  }
  async collections(): Promise<Collection[]> { const r = await this.host.html(this.host.settings.mirror); return parsePelisflixCollections(r.text, r.url); }
  async person(url: string) { const r = await this.host.html(this.rebase(url)); const parsed = parsePelisflixCatalogue(r.text, r.url); return { name: new URL(url).searchParams.get('s') || 'Filmography', originalName: '', birthDate: '', jobs: [], careers: [], filmography: parsed.items }; }
}
