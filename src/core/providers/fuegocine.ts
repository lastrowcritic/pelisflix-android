import type { Catalogue, Item, Selection, Source } from '../types';
import type { Attempt, Provider, ProviderHost } from './types';
import { InvalidCatalogue } from '../mirrors';
import { chooseAudio } from './paging';
import { resolveVoe } from './players';
import { fuegoMedia, fuegoOkruURL, fuegoUnlimplayURL, fuegoVoeURL, fuegoWrappedVideo, fuegocineBase } from './fuegocine-policy';
import { feedURL, fuegoCategories, fuegoDirect, fuegoGenres, parseFeed, parseFuegoCard, parseFuegoDetails, parseFuegoEpisodes, parseFuegoLinks, fuegoAudio, parseOkru, parseUnlimplay } from './fuegocine-parse';
import type { FeedEntry } from './fuegocine-parse';

const pageSize = 30;
// The app asks for the same roots whichever source is used. Each root is a label on the blog.
const rootLabels: Record<string, string> = { films: 'Movie', series: 'Serie', cartoons: 'Animación', animation: 'Animación' };

export class FuegocineProvider implements Provider {
  readonly id = 'fuegocine' as const;
  private labelList?: Promise<string[]>;
  constructor(private host: ProviderHost) {}
  // The label list is only used to name the categories and to turn a readable address back into a label, so a failure is not fatal.
  private labels(): Promise<string[]> {
    if (!this.labelList) {
      this.labelList = this.host.html(feedURL({ size: 0 }), 3600000).then(r => parseFeed(r.text).labels);
      this.labelList.catch(() => { this.labelList = undefined; });
    }
    return this.labelList.catch(() => []);
  }
  private async list(options: { labels?: string[]; query?: string }, page: number): Promise<{ items: Item[]; hasNext: boolean }> {
    const start = (page - 1) * pageSize + 1, response = await this.host.request(feedURL({ ...options, size: pageSize, start }), undefined, undefined, 30000), feed = parseFeed(response.text);
    const items: Item[] = [], seen = new Set<string>();
    for (const entry of feed.entries) { const card = parseFuegoCard(entry); if (card && !seen.has(card.id)) { seen.add(card.id); items.push(card); } }
    // Searches report a total that is not reliable, so a full page is taken as a sign that there is more.
    const hasNext = options.query ? feed.entries.length >= pageSize : start - 1 + feed.entries.length < feed.total;
    if (!feed.entries.length && page === 1 && !options.query && !options.labels) throw new InvalidCatalogue('The catalogue could not be read. Try again shortly.');
    return { items, hasNext };
  }
  async catalogue(path: string | undefined, page: number): Promise<Catalogue> {
    const url = new URL(path || '', fuegocineBase);
    if (url.origin !== new URL(fuegocineBase).origin) throw new Error('This catalog link is outside the supported content source.');
    const [root, slug] = url.pathname.split('/').filter(Boolean), labels = await this.labels(), categories = fuegoCategories(labels), kind = rootLabels[root];
    const genre = slug ? fuegoGenres(labels).find(g => g.slug === slug)?.label : undefined;
    if (slug && !genre) return { items: [], hasNext: false, categories };
    const data = await this.list({ labels: [kind, genre].filter((l): l is string => !!l) }, page);
    return { ...data, categories };
  }
  async search(query: string, page: number): Promise<Catalogue> {
    return { ...(await this.list({ query }, page)), categories: [] };
  }
  // One post is one title or one episode. The feed finds it by its address.
  private async post(page: string): Promise<FeedEntry> {
    const response = await this.host.html(feedURL({ path: new URL(page).pathname }), 600000), entry = parseFeed(response.text).entries[0];
    if (!entry) { this.host.forget(feedURL({ path: new URL(page).pathname })); throw new Error('This title is no longer available on the source.'); }
    return entry;
  }
  async details(item: Item): Promise<Item> {
    const entry = await this.post(item.page!);
    let detailed = parseFuegoDetails(entry, item);
    if (detailed.isSeries) {
      const postId = entry.id?.$t.match(/post-(\d+)$/)?.[1];
      if (postId) {
        const response = await this.host.request(feedURL({ labels: ['Episode', `id-${postId}`], size: 500 }), undefined, undefined, 30000), { seasons, audio } = parseFuegoEpisodes(parseFeed(response.text).entries);
        // The series post itself lists no servers, so the audio shown comes from its first episode.
        detailed = { ...detailed, seasons, translators: audio.length ? audio : detailed.translators };
      }
    }
    return detailed;
  }
  async attempts(item: Item, selection: Selection): Promise<Attempt[]> {
    let audio = item.translators || [];
    if (item.isSeries) {
      const episode = item.seasons?.find(s => s.id === selection.season)?.episodes.find(e => e.id === selection.episode);
      if (!episode?.page) throw new Error('Choose a season and episode.');
      audio = fuegoAudio(parseFuegoLinks((await this.post(episode.page)).content?.$t || ''));
    }
    const translator = chooseAudio(audio, selection);
    return translator.sources!.map(option => () => this.resolve(option.url, item.page!, translator.id));
  }
  private async resolve(url: string, page: string, audio: string): Promise<Source> {
    const direct = fuegoWrappedVideo(url);
    if (direct) return fuegoDirect(direct);
    if (fuegoOkruURL(url)) { const response = await this.host.request(url, undefined, page); return parseOkru(response.text, response.url); }
    if (fuegoUnlimplayURL(url)) {
      const response = await this.host.request(url, undefined, page), voe = parseUnlimplay(response.text, response.url, audio);
      return resolveVoe(this.host, voe, response.url, fuegoMedia);
    }
    if (fuegoVoeURL(url)) return resolveVoe(this.host, url, page, fuegoMedia);
    throw new Error('This video server is not supported yet.');
  }
}
