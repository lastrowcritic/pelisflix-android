import type { Catalogue, Item, Selection, Source } from '../types';
import type { Attempt, DetailOptions, Provider, ProviderHost } from './types';
import { HTTPFailure, InvalidCatalogue } from '../mirrors';
import { castellano } from '../audio';
import { chooseAudio } from './paging';
import { resolveVoe } from './players';
import { fuegoMedia, fuegoOkruURL, fuegoUnlimplayURL, fuegoVoeURL, fuegoWrappedVideo, fuegocineBase } from './fuegocine-policy';
import { feedURL, fuegoCategories, fuegoDirect, fuegoGenres, fuegoSpanish, fuegoUnlimplay, parseFeed, parseFuegoCard, parseFuegoDetails, parseFuegoEpisodes, parseFuegoLinks, fuegoAudio, parseOkru, parseUnlimplay, unlimplayOffers } from './fuegocine-parse';
import type { FeedEntry, FuegoLink } from './fuegocine-parse';
import { SpanishAnswers } from './fuegocine-spanish';

const pageSize = 30;
// unlimplay sends its headers at once but holds the page back for up to about 16 seconds, longer than the usual wait.
const slowPlayerWait = 45000;
// Checking a title for Spanish waits less. A page that is slower than this is left unchecked rather than holding up a whole list.
const checkWait = 20000;
// The app asks for the same roots whichever source is used. Each root is a label on the blog.
const rootLabels: Record<string, string> = { films: 'Movie', series: 'Serie', cartoons: 'Animación', animation: 'Animación' };

export class FuegocineProvider implements Provider {
  readonly id = 'fuegocine' as const;
  private labelList?: Promise<string[]>;
  private spanish = new SpanishAnswers();
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
  async details(item: Item, options: DetailOptions = {}): Promise<Item> {
    const entry = await this.post(item.page!);
    let detailed = parseFuegoDetails(entry, item), link = fuegoUnlimplay(parseFuegoLinks(entry.content?.$t || ''));
    if (detailed.isSeries) {
      const postId = entry.id?.$t.match(/post-(\d+)$/)?.[1];
      if (postId) {
        const response = await this.host.request(feedURL({ labels: ['Episode', `id-${postId}`], size: 500 }), undefined, undefined, 30000), { seasons, audio, unlimplay } = parseFuegoEpisodes(parseFeed(response.text).entries);
        // The series post itself lists no servers, so the audio shown comes from its first episode, and so does the page that can offer Spanish.
        detailed = { ...detailed, seasons, translators: audio.length ? audio : detailed.translators };
        link = unlimplay;
      }
    }
    return this.withSpanish(detailed, link, item.page!, !!options.castellano);
  }
  // The posts never list Castellano, but the unlimplay page of a title can offer it. Opening that page is slow, so it is only done when
  // asked for, and every answer is kept. What is already known is used either way. With the check on, Castellano is the audio to start with.
  private async withSpanish(detailed: Item, link: FuegoLink | undefined, page: string, check: boolean): Promise<Item> {
    let translators = detailed.translators || [], pending = false;
    if (link && !translators.some(t => t.id === castellano)) {
      const found = this.spanish.get(link.url) ?? (check ? await this.look(link.url, page) : undefined);
      if (found) translators = fuegoSpanish(translators, link);
      pending = check && found === undefined;
    }
    if (check && translators.some(t => t.id === castellano)) translators = translators.map(t => ({ ...t, selected: t.id === castellano }));
    return { ...detailed, translators, ...(pending ? { audioPending: true } : {}) };
  }
  // One read of the page. Yes or no once it answered, gone when unlimplay does not have the title (it says so at once), undefined when it could not be read.
  private async ask(url: string, page: string): Promise<'yes' | 'no' | 'gone' | undefined> {
    try {
      const response = await this.host.request(url, undefined, page, checkWait), offers = fuegoUnlimplayURL(response.url) ? unlimplayOffers(response.text, castellano) : undefined;
      return offers === undefined ? undefined : offers ? 'yes' : 'no';
    } catch (error) {
      return error instanceof HTTPFailure && error.status === 404 ? 'gone' : undefined;
    }
  }
  // True or false once the page answered, undefined when it could not be read, which is not kept so it is tried again later.
  // unlimplay sometimes serves a page that leaves a language out and has it on the next request, so a page without Spanish is read a second time.
  private async look(url: string, page: string): Promise<boolean | undefined> {
    let answer = await this.ask(url, page);
    if (answer === 'no') answer = await this.ask(url, page);
    const found = answer === undefined ? undefined : answer === 'yes';
    if (found !== undefined) this.spanish.set(url, found);
    return found;
  }
  async attempts(item: Item, selection: Selection): Promise<Attempt[]> {
    let audio = item.translators || [];
    if (item.isSeries) {
      const episode = item.seasons?.find(s => s.id === selection.season)?.episodes.find(e => e.id === selection.episode);
      if (!episode?.page) throw new Error('Choose a season and episode.');
      const links = parseFuegoLinks((await this.post(episode.page)).content?.$t || '');
      audio = fuegoAudio(links);
      // This episode may have a Spanish option of its own. If it does not, the page says so when it is opened.
      if (selection.translator === castellano) audio = fuegoSpanish(audio, fuegoUnlimplay(links));
    }
    const translator = chooseAudio(audio, selection);
    return translator.sources!.map(option => () => this.resolve(option.url, item.page!, translator.id));
  }
  // Spanish was found on this page when the title was checked, but the page can leave it out once, so it is read again before giving up.
  private async unlimplay(url: string, page: string, audio: string, again: boolean): Promise<{ voe: string; base: string }> {
    const response = await this.host.request(url, undefined, page, slowPlayerWait);
    try {
      return { voe: parseUnlimplay(response.text, response.url, audio), base: response.url };
    } catch (error) {
      if (again) return this.unlimplay(url, page, audio, false);
      throw error;
    }
  }
  private async resolve(url: string, page: string, audio: string): Promise<Source> {
    const direct = fuegoWrappedVideo(url);
    if (direct) return fuegoDirect(direct);
    if (fuegoOkruURL(url)) { const response = await this.host.request(url, undefined, page); return parseOkru(response.text, response.url); }
    if (fuegoUnlimplayURL(url)) {
      const { voe, base } = await this.unlimplay(url, page, audio, audio === castellano);
      return resolveVoe(this.host, voe, base, fuegoMedia);
    }
    if (fuegoVoeURL(url)) return resolveVoe(this.host, url, page, fuegoMedia);
    throw new Error('This video server is not supported yet.');
  }
}
