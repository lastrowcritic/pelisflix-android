import { load } from 'cheerio';
import type { Catalogue, Item, Kind, Season, Source, Translator } from '../types';
import { forteContentURL, fortePlayerURL, forteMedia } from './pelisforte-policy';
import { normalizeText as text } from './paging';
import { playerAgent, unpack } from './players';

const languages: Record<string, { id: string; name: string }> = {
  'español latino': { id: 'latino', name: 'Latino' }, latino: { id: 'latino', name: 'Latino' },
  castellano: { id: 'castellano', name: 'Castellano' }, subtitulado: { id: 'subtitulado', name: 'Subtitled' }
};
// Okhd is the only server that streams plain HLS. The others hide the video behind scripts that cannot be read safely.
const supportedServer = /^okhd$/i;
export const forteID = (url: string) => `pelisforte:${new URL(url).pathname.replace(/\/$/, '')}`;
function imageURL(raw: string | undefined, base: string) {
  if (!raw) return;
  try { const url = new URL(raw, base); return url.protocol === 'https:' && (url.hostname === new URL(base).hostname || url.hostname === 'image.tmdb.org') ? url.href : undefined; } catch { return; }
}
// Listings only carry a tiny thumbnail in src, the larger sizes are in srcset.
function cardImage(img: { attr(name: string): string | undefined }, base: string) {
  const candidates = (img.attr('srcset') || '').split(',').map(part => part.trim().split(/\s+/)).filter(([url]) => url).map(([url, width]) => ({ url, width: parseInt(width) || 0 }));
  const best = candidates.sort((a, b) => b.width - a.width)[0]?.url;
  return imageURL(best || img.attr('data-src') || img.attr('src'), base);
}
// The list item around a card is tagged with the audio the title has (idiomas-castellano). A card without any such tag says nothing, so its audio stays unknown.
const cardAudio: Record<string, string> = { castellano: 'castellano', 'espanol-latino': 'latino', latino: 'latino' };
export function forteCardAudio(classes: string | undefined): string[] | undefined {
  const tags = (classes || '').split(/\s+/).filter(c => c.startsWith('idiomas-')).map(c => c.slice(8));
  if (!tags.length) return;
  return [...new Set(tags.map(t => cardAudio[t] || (t.startsWith('subtitulad') ? 'subtitulado' : '')).filter(Boolean))];
}
// Genre pages carry a numeric suffix on some slugs (accion-p01). The suffix is kept in the query so the readable slug can name the category.
const genreSlug = (real: string) => real.replace(/-p\d+$/, '');
export function parseForteCatalogue(html: string, base: string, page = 1): Catalogue {
  const $ = load(html), items: Item[] = [], seen = new Set<string>();
  $('article.post').each((_, element) => {
    const card = $(element), url = forteContentURL(card.find('a.lnk-blk').attr('href'), base);
    // The first card of some listings is an advertisement. Only real titles live under /pelicula/ and /serie/.
    if (!url || !/^\/(?:pelicula|serie)\/[^/]+\/?$/.test(new URL(url).pathname)) return;
    const id = forteID(url); if (seen.has(id)) return; seen.add(id);
    const title = text(card.find('.entry-title').first().text()); if (!title) return;
    const kind: Kind = new URL(url).pathname.startsWith('/serie/') ? 'series' : 'movie';
    const year = Number(card.find('.year').first().text().match(/\b(?:19|20)\d{2}\b/)?.[0]) || undefined;
    const rating = card.find('.vote').first().text().match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.');
    const audio = forteCardAudio(card.closest('li').attr('class'));
    items.push({ id, title, kind, year, genre: '', synopsis: '', poster: cardImage(card.find('img').first(), base), page: url, isSeries: kind === 'series', ...(rating ? { rating } : {}), ...(audio ? { audio } : {}) });
  });
  const categories: Catalogue['categories'] = [], genres = new Set<string>();
  $('a[href*="/peliculas/"]').each((_, a) => {
    const url = forteContentURL($(a).attr('href'), base), real = url && new URL(url).pathname.match(/^\/peliculas\/([a-z0-9-]+)\/?$/)?.[1], name = text($(a).text());
    if (!real || !name || genres.has(real)) return;
    genres.add(real); const slug = genreSlug(real);
    categories.push({ name, kind: 'movie', url: new URL(`films/${slug}/${slug === real ? '' : `?genre=${real}`}`, base).href });
  });
  categories.push({ name: 'All series', kind: 'series', url: new URL('series/', base).href });
  const hasNext = $('nav.pagination a, .nav-links a').toArray().some(a => /siguiente/i.test($(a).text()) || Number($(a).attr('href')?.match(/\/page\/(\d+)/)?.[1]) > page);
  return { items, hasNext, categories };
}
// The menu link named "Series" points to the page that lists them, and its address carries a number that can change.
export function forteSeriesPath(html: string, base: string): string | undefined {
  const $ = load(html);
  for (const a of $('a[href]').toArray()) { if (text($(a).text()).toLowerCase() !== 'series') continue; const url = forteContentURL($(a).attr('href'), base), path = url && new URL(url).pathname.replace(/^\/|\/$/g, ''); if (path && /^series[\w-]*$/.test(path)) return path; }
}
// Maps a readable genre slug back to the page it came from.
export function forteGenres(categories: Catalogue['categories']): Map<string, string> {
  const map = new Map<string, string>();
  for (const category of categories) { const url = new URL(category.url), slug = url.pathname.split('/').filter(Boolean)[1]; if (slug) map.set(slug, url.searchParams.get('genre') || slug); }
  return map;
}
// Each option is a tab named "OPCIÓN 3 Okhd -Español Latino" whose panel holds the player frame.
export function parseForteAudio(html: string, base: string): Translator[] {
  const $ = load(html), result: Translator[] = [];
  $('a[href^="#options-"]').each((_, tab) => {
    const label = text($(tab).text()).match(/^OPCI[ÓO]N\s+\d+\s+(.+?)\s*-\s*(.+)$/i), panel = $(`[id="${($(tab).attr('href') || '').slice(1)}"]`);
    if (!label || !supportedServer.test(label[1])) return;
    const language = languages[label[2].toLowerCase()]; if (!language) return;
    const frame = panel.find('iframe').first(), url = fortePlayerURL(frame.attr('src') || frame.attr('data-src'), base); if (!url) return;
    let translator = result.find(t => t.id === language.id);
    if (!translator) { translator = { id: language.id, name: language.name, selected: result.length === 0, premium: false, sources: [] }; result.push(translator); }
    if (!translator.sources!.some(s => s.url === url)) translator.sources!.push({ url, name: label[1] });
  });
  return result;
}
const minutes = (value: string) => (Number(value.match(/(\d+)\s*h/)?.[1]) || 0) * 60 + (Number(value.match(/(\d+)\s*(?:m|min)\b/)?.[1]) || 0);
export function parseForteDetails(html: string, base: string, item: Item): Item {
  const $ = load(html), meta = $('.entry-meta').first(), title = text($('h1').first().text()) || item.title;
  const year = Number(meta.find('.year').text().match(/\b(?:19|20)\d{2}\b/)?.[0]) || item.year;
  const genres = meta.find('.genres a').map((_, e) => text($(e).text())).get().filter(Boolean);
  const synopsis = $('.description p').map((_, e) => text($(e).text())).get().find(p => p && !/^disfruta de esta|también conocida por/i.test(p));
  const backdrop = imageURL($('img[src*="-backdrop"]').first().attr('src') || $('img[data-src*="-backdrop"]').first().attr('data-src'), base);
  const poster = imageURL($('meta[property="og:image"]').attr('content'), base);
  const seasons = parseForteSeasons(html, base);
  return {
    ...item, page: base, title, year, genre: genres.join(', ') || item.genre, synopsis: synopsis || item.synopsis, poster: poster || item.poster, backdrop: backdrop || item.backdrop,
    duration: minutes(meta.find('.duration').text()) || item.duration, translators: parseForteAudio(html, base), seasons: seasons.length ? seasons : item.seasons,
    information: { ...(item.information || {}), ...(year ? { Year: String(year) } : {}) }
  };
}
export function parseForteEpisodes(html: string, base: string, seasonID: string): Season['episodes'] {
  const $ = load(html), result: Season['episodes'] = [];
  $('article.episodes').each((_, element) => {
    const card = $(element), page = forteContentURL(card.find('a.lnk-blk').attr('href'), base), id = page && new URL(page).pathname.match(/-\d+x(\d+)\/?$/)?.[1];
    if (!id || result.some(e => e.id === id)) return;
    result.push({ id, season: seasonID, title: `Episode ${id}`, page, image: imageURL(card.find('img').first().attr('src'), base) });
  });
  return result.sort((a, b) => Number(a.id) - Number(b.id));
}
// Only the newest season is written into the page. The others are requested when needed.
function parseForteSeasons(html: string, base: string): Season[] {
  const $ = load(html), seasons: Season[] = [];
  $('li.sel-temp a[data-season]').each((_, a) => { const id = $(a).attr('data-season')!; if (/^\d+$/.test(id) && !seasons.some(s => s.id === id)) seasons.push({ id, title: `Season ${id}`, episodes: [] }); });
  const inline = parseForteEpisodes($('#episode_by_temp').html() || '', base, '');
  const current = text($('.n_s').first().text()) || String(Math.max(...seasons.map(s => Number(s.id)), 0) || '');
  if (inline.length) {
    let season = seasons.find(s => s.id === current);
    if (!season) { season = { id: current || '1', title: `Season ${current || 1}`, episodes: [] }; seasons.push(season); }
    season.episodes = inline.map(e => ({ ...e, season: season!.id }));
  }
  return seasons.sort((a, b) => Number(a.id) - Number(b.id));
}
// What the site asks for when a season is chosen.
export function forteSeasonRequest(html: string): { post?: string; nonce?: string } {
  const $ = load(html), post = $('li.sel-temp a[data-post]').first().attr('data-post');
  return { post, nonce: html.match(/"content_nonce"\s*:\s*"([A-Za-z0-9]+)"/)?.[1] };
}
// The wrapper page only moves on to the real player once its play button is pressed.
export function forteHop(html: string, base: string): string | undefined {
  let page: URL; try { page = new URL(base); } catch { return; }
  if (page.hostname !== 'mp4.nu') return;
  const target = html.match(/location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/)?.[1];
  return fortePlayerURL(target, base);
}
export function parseOkhdEmbed(html: string, base: string): Source {
  if (!fortePlayerURL(base)) throw new Error('This player is not supported.');
  // The player settings are packed with a word table. Read the table as text and never run the script.
  const source = unpack(html) || html;
  const media = source.match(/file\s*:\s*["'](https:[^"']+\.m3u8[^"']*)["']/)?.[1]?.replace(/\\\//g, '/');
  if (!media) throw new Error('This server did not provide a playable video.');
  const url = forteMedia(media); if (!url) throw new Error('This video server is not supported yet.');
  return { streams: [{ quality: 'Auto', url, alternatives: [], mimeType: 'application/x-mpegURL' }], subtitles: [], headers: { Referer: base, 'User-Agent': playerAgent } };
}
