import { load } from 'cheerio';
import type { Catalogue, Item, Season, Source, Translator } from '../types';
import { InvalidCatalogue } from '../mirrors';
import { fuegoContentURL, fuegoDirectVideo, fuegoMedia, fuegoOkruURL, fuegoUnlimplayURL, fuegoVoeURL, fuegoWrappedVideo, fuegocineBase } from './fuegocine-policy';
import { normalizeText as text } from './paging';
import { playerAgent } from './players';

// The site is a Blogger blog, so its public JSON feed is the catalogue: every title and every episode is one post.
interface Text { $t: string }
export interface FeedEntry { id?: Text; published?: Text; title?: Text; content?: Text; category?: { term: string }[]; link?: { rel: string; href: string }[] }
export interface Feed { entries: FeedEntry[]; labels: string[]; total: number }
export interface FuegoLink { lang: string; name: string; url: string }

export function parseFeed(body: string): Feed {
  let feed: Record<string, any> | undefined;
  try { feed = JSON.parse(body)?.feed; } catch { /* Reported below. */ }
  if (!feed || typeof feed !== 'object') throw new InvalidCatalogue('The catalogue could not be read. Try again shortly.');
  const entries: FeedEntry[] = Array.isArray(feed.entry) ? feed.entry : [];
  return { entries, labels: (Array.isArray(feed.category) ? feed.category : []).map((c: { term?: unknown }) => c?.term).filter((t: unknown): t is string => typeof t === 'string'), total: Number(feed['openSearch$totalResults']?.$t) || entries.length };
}
// Labels pick the list (/-/Movie/Acción), `path` picks one post and `q` searches. A size of 0 returns only the label list.
export function feedURL(options: { labels?: string[]; query?: string; path?: string; size?: number; start?: number } = {}): string {
  const url = new URL(`feeds/posts/default${options.labels?.length ? '/-/' + options.labels.map(encodeURIComponent).join('/') : ''}`, fuegocineBase);
  url.searchParams.set('alt', 'json');
  if (options.size !== undefined) url.searchParams.set('max-results', String(options.size));
  if (options.start && options.start > 1) url.searchParams.set('start-index', String(options.start));
  if (options.query) url.searchParams.set('q', options.query);
  if (options.path) url.searchParams.set('path', options.path);
  return url.href;
}

export const fuegoID = (url: string) => `fuegocine:${new URL(url).pathname}`;
const labelsOf = (entry: FeedEntry) => (entry.category || []).map(c => c.term);
const entryPage = (entry: FeedEntry) => fuegoContentURL(entry.link?.find(l => l.rel === 'alternate')?.href);
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');
function imageURL(raw: string | undefined): string | undefined {
  if (!raw) return;
  try { const url = new URL(raw, fuegocineBase); return url.protocol === 'https:' && /(^|\.)(themoviedb\.org|tmdb\.org|fuegocine\.com)$/.test(url.hostname) ? url.href : undefined; } catch { return; }
}
function splitTitle(raw: string) {
  const match = raw.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return match ? { name: text(match[1]), year: Number(match[2]) } : { name: text(raw), year: undefined };
}
const minutes = (value: string | undefined) => value ? (Number(value.match(/(\d+)\s*h/)?.[1]) || 0) * 60 + (Number(value.match(/(\d+)\s*m/)?.[1]) || 0) : 0;
const imdb = (value: string | undefined) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n.toFixed(1) : undefined; };

// Genres, studios and the "Estreno" label are the only labels worth browsing. The others mark the kind, the year or the series an episode belongs to.
const markers = new Set(['Movie', 'Serie', 'Episode', 'Hero Post']);
export const fuegoSlug = (label: string) => label === 'Estreno' ? 'estrenos' : label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function fuegoGenres(labels: string[]): { label: string; slug: string; name: string }[] {
  const seen = new Set<string>();
  return labels.filter(l => !markers.has(l) && !/^\d{4}$/.test(l) && !/^id-\d+$/.test(l)).flatMap(label => {
    const slug = fuegoSlug(label); if (!slug || seen.has(slug)) return [];
    seen.add(slug); return [{ label, slug, name: label === 'Estreno' ? 'Estrenos' : label }];
  });
}
export function fuegoCategories(labels: string[]): Catalogue['categories'] {
  return fuegoGenres(labels).flatMap(g => [
    { name: g.name, kind: 'movie' as const, url: new URL(`films/${g.slug}/`, fuegocineBase).href },
    { name: g.name, kind: 'series' as const, url: new URL(`series/${g.slug}/`, fuegocineBase).href }
  ]);
}

// Episodes are posts too, so they are left out of listings.
export function parseFuegoCard(entry: FeedEntry): Item | undefined {
  const labels = labelsOf(entry), kind = labels.includes('Serie') ? 'series' : labels.includes('Movie') ? 'movie' : undefined, page = entryPage(entry), raw = entry.title?.$t;
  if (!kind || !page || !raw) return;
  const $ = load(stripComments(entry.content?.$t || '')), { name, year } = splitTitle(raw), rating = imdb($('[data-imdb]').first().attr('data-imdb'));
  if (!name) return;
  // A movie post lists its servers, so its audio is known from the listing. A series post lists none (only its episodes do), so none is claimed for it.
  const audio = kind === 'movie' ? fuegoAudio(parseFuegoLinks(entry.content?.$t || '')).map(t => t.id) : [];
  return {
    id: fuegoID(page), title: name, kind, year: year ?? (Number(labels.find(l => /^\d{4}$/.test(l))) || undefined), genre: '',
    synopsis: text($('#tmdb-synopsis').text()), poster: imageURL($('[data-post-type] img').first().attr('src')), page, isSeries: kind === 'series', audio, ...(rating ? { rating } : {})
  };
}
export function parseFuegoDetails(entry: FeedEntry, base?: Item): Item {
  const card = parseFuegoCard(entry) || base;
  if (!card) throw new Error('This title is no longer available on the source.');
  const content = entry.content?.$t || '', $ = load(stripComments(content)), attr = (name: string) => $(`[${name}]`).first().attr(name);
  const genres = (attr('data-genres') || '').split(',').map(text).filter(Boolean), rating = imdb(attr('data-imdb')), original = text(attr('data-original-title') || '');
  const year = card.year ?? base?.year;
  return {
    ...base, ...card, poster: card.poster || base?.poster, synopsis: card.synopsis || base?.synopsis || '', year, genre: genres.join(', ') || base?.genre || '',
    backdrop: imageURL(attr('data-backdrop')) || base?.backdrop, ...(original && original !== card.title ? { originalTitle: original } : {}),
    duration: minutes(attr('data-duartion')) || base?.duration, translators: fuegoAudio(parseFuegoLinks(content)),
    ...(rating ? { rating, ratings: [{ name: 'IMDb', value: rating }] } : {}), information: { ...(base?.information || {}), ...(year ? { Year: String(year) } : {}) }
  };
}

// The posts list their servers in a script: lang, name and url for each one. Servers that are commented out are not offered.
export function parseFuegoLinks(content: string): FuegoLink[] {
  const code = stripComments(content), start = code.search(/_SV_LINKS\s*=\s*\[/);
  if (start < 0) return [];
  return code.slice(start).split('</script>')[0].split(/\}\s*,?\s*\{/).flatMap(part => {
    const lang = part.match(/lang:\s*"([^"]*)"/)?.[1], url = part.match(/url:\s*"([^"]*)"/)?.[1];
    return lang && url ? [{ lang, name: part.match(/name:\s*"([^"]*)"/)?.[1] || '', url: url.replaceAll('&amp;', '&') }] : [];
  });
}
const languages: Record<string, { id: string; name: string }> = {
  lat: { id: 'latino', name: 'Latino' }, latino: { id: 'latino', name: 'Latino' },
  es: { id: 'castellano', name: 'Castellano' }, esp: { id: 'castellano', name: 'Castellano' }, cast: { id: 'castellano', name: 'Castellano' }, castellano: { id: 'castellano', name: 'Castellano' },
  en: { id: 'subtitulado', name: 'Subtitled' }, sub: { id: 'subtitulado', name: 'Subtitled' }, subtitulado: { id: 'subtitulado', name: 'Subtitled' }
};
const supported = (url: string) => !!(fuegoWrappedVideo(url) || fuegoOkruURL(url) || fuegoUnlimplayURL(url) || fuegoVoeURL(url));
// A plain file opens at once, the others need more requests. The site's order is kept inside each group.
const rank = (url: string) => fuegoWrappedVideo(url) ? 0 : fuegoUnlimplayURL(url) ? 1 : fuegoVoeURL(url) ? 2 : 3;
export function fuegoAudio(links: FuegoLink[]): Translator[] {
  const result: Translator[] = [];
  for (const link of links) {
    const language = languages[link.lang.toLowerCase()]; if (!language || !supported(link.url)) continue;
    let translator = result.find(t => t.id === language.id);
    if (!translator) { translator = { id: language.id, name: language.name, selected: result.length === 0, premium: false, sources: [] }; result.push(translator); }
    if (!translator.sources!.some(s => s.url === link.url)) translator.sources!.push({ url: link.url, name: link.name.replace(/[^\p{L}\p{N}\s]/gu, '').trim() || 'Server' });
  }
  for (const translator of result) translator.sources!.sort((a, b) => rank(a.url) - rank(b.url));
  return result;
}

// An episode post says which season and number it is in its title ("Name 1x3"), its header and a data attribute.
export function parseFuegoEpisodes(entries: FeedEntry[]): { seasons: Season[]; audio: Translator[] } {
  const found: { season: number; number: number; page: string; image?: string; links: FuegoLink[] }[] = [];
  for (const entry of entries) {
    const page = entryPage(entry), content = entry.content?.$t || '', $ = load(stripComments(content)), fromTitle = (entry.title?.$t || '').match(/(\d+)x(\d+)\s*$/);
    const season = Number($('[data-season-number]').first().attr('data-season-number')) || Number(fromTitle?.[1]), number = Number($('.post-header__meta .num').text().match(/\d+/)?.[0]) || Number(fromTitle?.[2]);
    if (!page || !season || !number || found.some(e => e.season === season && e.number === number)) continue;
    found.push({ season, number, page, image: imageURL($('[data-backdrop]').first().attr('data-backdrop')) || imageURL($('[data-post-type] img').first().attr('src')), links: parseFuegoLinks(content) });
  }
  found.sort((a, b) => a.season - b.season || a.number - b.number);
  const seasons: Season[] = [];
  for (const e of found) {
    let season = seasons.find(s => s.id === String(e.season));
    if (!season) { season = { id: String(e.season), title: `Season ${e.season}`, episodes: [] }; seasons.push(season); }
    season.episodes.push({ id: String(e.number), season: season.id, title: `Episode ${e.number}`, page: e.page, image: e.image });
  }
  return { seasons, audio: found.map(e => fuegoAudio(e.links)).find(a => a.length) || [] };
}

export function fuegoDirect(url: string): Source {
  return { streams: [{ quality: 'Auto', url, alternatives: [], mimeType: /\.m3u8$/i.test(new URL(url).pathname) ? 'application/x-mpegURL' : 'video/mp4' }], subtitles: [], headers: { 'User-Agent': playerAgent } };
}
// The ok.ru page describes its player in an attribute. The playlist inside is tied to the address that asked for it, so the app asks for it itself.
export function parseOkru(html: string, base: string): Source {
  if (!fuegoOkruURL(base)) throw new Error('This player is not supported.');
  let options: any, metadata: any;
  try { options = JSON.parse(load(html)('[data-options]').first().attr('data-options') || ''); metadata = options?.flashvars?.metadata; if (typeof metadata === 'string') metadata = JSON.parse(metadata); } catch { /* Reported below. */ }
  const media = typeof metadata?.hlsManifestUrl === 'string' ? metadata.hlsManifestUrl : undefined;
  if (!media) throw new Error('This server did not provide a playable video.');
  const url = fuegoMedia(media); if (!url) throw new Error('This video server is not supported yet.');
  return { streams: [{ quality: 'Auto', url, alternatives: [], mimeType: 'application/x-mpegURL' }], subtitles: [], headers: { Referer: 'https://ok.ru/', 'User-Agent': playerAgent } };
}
// unlimplay lists the same video on several hosts for each audio. Only the VOE one is used, because that player can be read safely.
const audioKeys: Record<string, string[]> = { latino: ['latino'], castellano: ['español', 'espanol', 'castellano'], subtitulado: ['subtitulado'] };
export function parseUnlimplay(html: string, base: string, audio: string): string {
  if (!fuegoUnlimplayURL(base)) throw new Error('This player is not supported.');
  let embeds: Record<string, Record<string, unknown>> | undefined;
  try { embeds = JSON.parse(html.match(/const\s+EMBEDS\s*=\s*(\{[^\n]*\})\s*;/)?.[1] || ''); } catch { /* Reported below. */ }
  if (!embeds || typeof embeds !== 'object') throw new Error('This server did not provide a playable video.');
  const key = (audioKeys[audio] || []).find(k => embeds![k] && typeof embeds![k] === 'object');
  if (!key) throw new Error('This server does not have the selected audio.');
  const voe = typeof embeds[key].voe === 'string' ? fuegoVoeURL(embeds[key].voe as string) : undefined;
  if (!voe) throw new Error('This video server is not supported yet.');
  return voe;
}
