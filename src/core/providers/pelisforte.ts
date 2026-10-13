import type { Catalogue, Item, Selection, Source } from '../types';
import type { Attempt, Provider, ProviderHost } from './types';
import { InvalidCatalogue } from '../mirrors';
import { chooseAudio } from './paging';
import { pelisforteBase } from './pelisforte-policy';
import { forteGenres, forteHop, forteSeasonRequest, forteSeriesPath, parseForteAudio, parseForteCatalogue, parseForteDetails, parseForteEpisodes, parseOkhdEmbed } from './pelisforte-parse';

// WordPress style listings: the first page has the plain address and the next ones add /page/N (without a closing slash).
const pageURL = (address: string, page: number) => page > 1 ? `${address.replace(/\/$/, '')}/page/${page}` : address;

export class PelisforteProvider implements Provider {
  readonly id = 'pelisforte' as const;
  private genres = new Map<string, string>();
  private seriesPath = 'series-1746289646';
  constructor(private host: ProviderHost) {}
  // The app asks for the same paths whichever source is used (films/, series/, cartoons/ and category addresses). They are translated here.
  private listing(path?: string): string {
    const url = new URL(path || 'films/', pelisforteBase);
    if (url.origin !== new URL(pelisforteBase).origin) throw new Error('This catalog link is outside the supported content source.');
    const [root, slug] = url.pathname.split('/').filter(Boolean);
    if (root === 'series') return new URL(this.seriesPath, pelisforteBase).href;
    if (root === 'cartoons' || root === 'animation') return new URL(`peliculas/${this.genres.get('animacion') || 'animacion-p04'}`, pelisforteBase).href;
    if (root === 'films' && slug) return new URL(`peliculas/${url.searchParams.get('genre') || this.genres.get(slug) || slug}`, pelisforteBase).href;
    return new URL('todas-las-peliculas', pelisforteBase).href;
  }
  private async list(address: string, page: number): Promise<Catalogue> {
    const response = await this.host.html(address, 60000), data = parseForteCatalogue(response.text, response.url, page);
    // A page without any card at all is a broken answer. A real listing with no titles still has its (advertisement) cards.
    if (!data.items.length && page === 1 && !/class="post /.test(response.text)) { this.host.forget(address); throw new InvalidCatalogue('The catalogue could not be read. Try again shortly.'); }
    if (data.categories.length > 1) this.genres = forteGenres(data.categories);
    const series = forteSeriesPath(response.text, response.url); if (series) this.seriesPath = series;
    return data;
  }
  catalogue(path: string | undefined, page: number): Promise<Catalogue> { return this.list(pageURL(this.listing(path), page), page); }
  search(query: string, page: number): Promise<Catalogue> {
    const url = new URL(page > 1 ? `page/${page}/` : '', pelisforteBase); url.searchParams.set('s', query);
    return this.list(url.href, page);
  }
  async details(item: Item): Promise<Item> {
    const response = await this.host.html(item.page!); let detailed = parseForteDetails(response.text, response.url, item);
    if (detailed.isSeries && detailed.seasons?.length) {
      const seasons = [...detailed.seasons], { post, nonce } = forteSeasonRequest(response.text), pending = seasons.filter(s => !s.episodes.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (cursor < pending.length) {
          const season = pending[cursor++]; if (!post || !nonce) continue;
          try {
            const answer = await this.host.request(new URL('wp-admin/admin-ajax.php', pelisforteBase).href, { action: 'action_select_season', nonce, season: season.id, post }, response.url);
            season.episodes = parseForteEpisodes(answer.text, response.url, season.id);
          } catch { /* A season that cannot be loaded is left out below. */ }
        }
      }));
      // The site only publishes episodes for some seasons. Showing the empty ones would offer nothing to play.
      const filled = seasons.filter(s => s.episodes.length);
      detailed = { ...detailed, seasons: filled };
      const first = filled.flatMap(s => s.episodes)[0];
      if (first?.page) { const episode = await this.host.html(first.page); detailed.translators = parseForteAudio(episode.text, episode.url); }
    }
    return detailed;
  }
  async attempts(item: Item, selection: Selection): Promise<Attempt[]> {
    let page = item.page!, audio = item.translators || [];
    if (item.isSeries) {
      const episode = item.seasons?.find(s => s.id === selection.season)?.episodes.find(e => e.id === selection.episode);
      if (!episode?.page) throw new Error('Choose a season and episode.');
      page = episode.page; const response = await this.host.html(page); audio = parseForteAudio(response.text, response.url);
    }
    return chooseAudio(audio, selection).sources!.map(option => () => this.resolvePlayer(option.url, page));
  }
  // The frame is a wrapper that moves on to the Okhd player when its play button is pressed, and that page holds the playlist.
  private async resolvePlayer(start: string, page: string): Promise<Source> {
    let url = start, referer = page;
    for (let hop = 0; hop < 3; hop++) {
      const response = await this.host.request(url, undefined, referer), next = forteHop(response.text, response.url);
      if (!next) return parseOkhdEmbed(response.text, response.url);
      url = next; referer = response.url;
    }
    throw new Error('This video server redirected too many times.');
  }
}
