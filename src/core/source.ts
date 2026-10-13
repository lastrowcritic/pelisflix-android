import type { Catalogue, Collection, Comment, Item, ProviderId, Selection, Settings, Source } from './types';
import type { DetailOptions, Provider, ProviderHost, Reply } from './providers/types';
import type { PelisflixProvider } from './providers/pelisflix';
import { VerificationRequired, isChallenge } from './challenge';
import { isNative, TV } from './native';
import { demoCategories, demoItems } from './demo';
import { categoryRoot, categorySlug } from './categories';
import { HTTPFailure } from './mirrors';
import { VerificationCoordinator } from './verification';
import { rebaseURL } from './pelisflix-policy';
import { isProviderId, mediaPolicy, providerIdOf, sourceAllowed } from './providers/policy';
export { normalizeMirror } from './mirrors';
export { catalogueURL } from './providers/paging';
const verification = new VerificationCoordinator();
const cacheLimit = (cache: Map<string, unknown>, limit: number) => { while (cache.size > limit) cache.delete(cache.keys().next().value!); };

// The one place the screens talk to. It owns the network access, the caches and the playback loop, and hands the site-specific
// work to a provider: browsing and search use the source chosen in Settings, while an opened title always uses the source it came from.
export class ContentSource {
  private providers = new Map<ProviderId, Promise<Provider>>();
  private catalogueCache = new Map<string, { time: number; value: Promise<Catalogue> }>();
  private detailCache = new Map<string, { time: number; value: Promise<Item> }>();
  private htmlCache = new Map<string, { time: number; value: Promise<Reply> }>();
  // Embed pages live on domains the players change often, so only an address read from a player redirect is allowed, and only for this session.
  private embeds = new Set<string>();
  private host: ProviderHost;
  constructor(public settings: Settings, public onMirror?: (url: string) => void) {
    const source = this;
    this.host = {
      get settings() { return source.settings; },
      request: (...args) => this.request(...args),
      html: (url, ttl) => this.html(url, ttl),
      forget: url => { this.htmlCache.delete(url); },
      trust: url => { if (this.embeds.size > 20) this.embeds.clear(); this.embeds.add(url); },
      selectMirror: url => { this.settings = { ...this.settings, mirror: url }; this.onMirror?.(url); }
    };
  }
  async request(url: string, form?: Record<string, string>, referer?: string, timeout = 18000): Promise<Reply> {
    if (!this.allowed(url)) throw new Error('This link is outside the supported content source.');
    const method = form ? 'POST' : 'GET', body = form ? new URLSearchParams(form).toString() : undefined, options = { url, method, body, referer, timeout };
    const response = isNative
      ? await verification.request(options, o => TV.request(o), (url, request) => TV.verify({ url, request }), isChallenge)
      : await fetch(`/api/content?url=${encodeURIComponent(url)}`, { method, body, headers: { ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(referer ? { 'X-Rezka-Referer': referer } : {}), 'X-Rezka-Timeout': String(timeout) }, signal: AbortSignal.timeout(timeout + 1000) }).then(async r => ({ text: await r.text(), status: r.status, url: r.headers.get('X-Rezka-URL') || url }));
    if (!this.allowed(response.url)) throw new Error('The source redirected to an unsupported website.');
    if (isChallenge(response.text)) throw new VerificationRequired(response.url);
    if (response.status < 200 || response.status >= 300) throw new HTTPFailure(response.status);
    return response;
  }
  private allowed(url: string) { return sourceAllowed(url, this.settings.mirror) || this.embeds.has(url); }
  // The source used for browsing and search. A value saved by a newer or older version falls back to the original source.
  private get active(): ProviderId { return isProviderId(this.settings.source) ? this.settings.source : 'pelisflix'; }
  private provider(id: ProviderId): Promise<Provider> {
    let saved = this.providers.get(id);
    if (!saved) { saved = this.load(id); this.providers.set(id, saved); saved.catch(() => this.providers.delete(id)); }
    return saved;
  }
  // Each provider brings its own parsers, so it is only loaded when first used.
  private async load(id: ProviderId): Promise<Provider> {
    if (id === 'pelisforte') return new (await import('./providers/pelisforte')).PelisforteProvider(this.host);
    if (id === 'fuegocine') return new (await import('./providers/fuegocine')).FuegocineProvider(this.host);
    return new (await import('./providers/pelisflix')).PelisflixProvider(this.host);
  }
  rebase(raw: string, base = this.settings.mirror) { return rebaseURL(raw, base); }
  async withMirror<T>(operation: (base: string) => Promise<T>): Promise<T> { return ((await this.provider('pelisflix')) as PelisflixProvider).withMirror(operation); }
  private html(url: string, ttl = 300000): Promise<Reply> {
    const saved = this.htmlCache.get(url); if (saved && Date.now() - saved.time < ttl) return saved.value;
    const value = this.request(url); this.htmlCache.set(url, { time: Date.now(), value }); value.catch(() => this.htmlCache.delete(url)); cacheLimit(this.htmlCache, 80);
    return value;
  }
  private cached(key: string, operation: () => Promise<Catalogue>) {
    const saved = this.catalogueCache.get(key); if (saved && Date.now() - saved.time < 60000) return saved.value;
    const value = operation(); this.catalogueCache.set(key, { time: Date.now(), value }); value.catch(() => this.catalogueCache.delete(key)); cacheLimit(this.catalogueCache, 80);
    return value;
  }
  async catalogue(path?: string, page = 1, filter?: string): Promise<Catalogue> {
    if (this.settings.mode === 'demo') { const root = path ? categoryRoot(path) : '', slug = path ? categorySlug(path) : '', genre = slug && slug !== root ? slug.replaceAll('-', ' ') : ''; return { items: demoItems.filter(i => (!root || i.kind === ({ films: 'movie', series: 'series', cartoons: 'animation', animation: 'anime' } as Record<string, string>)[root]) && (!genre || i.genre.toLowerCase() === genre)), hasNext: false, categories: demoCategories }; }
    const id = this.active;
    return this.cached(`catalogue:${id}:${path || ''}:${page}:${filter || ''}`, async () => (await this.provider(id)).catalogue(path, page, filter));
  }
  async search(query: string, page = 1): Promise<Catalogue> {
    if (this.settings.mode === 'demo') return { items: demoItems.filter(i => (i.title + ' ' + i.genre).toLowerCase().includes(query.toLowerCase())), hasNext: false, categories: [] };
    const term = query.trim(); if (!term) return { items: [], hasNext: false, categories: [] };
    const id = this.active;
    return this.cached(`search:${id}:${term.toLocaleLowerCase('es')}:${page}`, async () => (await this.provider(id)).search(term, page));
  }
  async details(item: Item, options?: DetailOptions): Promise<Item> {
    if (!item.page) return item;
    // A checked version does everything the plain one does, so it also replaces the plain one.
    const slot = options?.castellano ? `${item.page}#castellano` : item.page, saved = this.detailCache.get(slot); if (saved && Date.now() - saved.time < 1800000) return saved.value;
    const value = this.provider(providerIdOf(item.id)).then(provider => provider.details(item, options)).then(detailed => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('rezka-rating', { detail: { id: detailed.id, rating: detailed.ratings?.find(r => r.name === 'IMDb')?.value || null } }));
      return detailed;
    });
    const slots = options?.castellano ? [slot, item.page] : [slot], entry = { time: Date.now(), value };
    for (const key of slots) this.detailCache.set(key, entry);
    // A failed check or one that could not finish is tried again the next time.
    const forget = () => { for (const key of slots) if (this.detailCache.get(key) === entry) this.detailCache.delete(key); };
    value.then(detailed => { if (detailed.audioPending) forget(); }, forget); cacheLimit(this.detailCache, 100);
    return value;
  }
  async rating(item: Item): Promise<string | null> { return item.ratings?.find(r => r.name === 'IMDb')?.value || null; }
  async episodes(item: Item, _translator: string) { return (await this.details(item)).seasons || []; }
  // A playable playlist can still point to deleted files. Read only a small media prefix before opening the player.
  async checkStream(source: Source): Promise<void> {
    const policy = mediaPolicy(source.provider);
    const read = async (url: string, probe = false) => {
      if (!policy.media(url)) throw new Error('Unsupported video address'); const referer = source.headers.Referer;
      if (isNative) { const r = await TV.request({ url, method: 'GET', referer: referer || undefined, timeout: 8000, probe }); if (!policy.media(r.url) || r.status < 200 || r.status >= 300) throw new Error('The video server is unavailable.'); return { text: r.text, url: r.url }; }
      const address = `/api/media?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(referer || '')}${this.providerQuery(source.provider)}`;
      const r = await fetch(address, { signal: AbortSignal.timeout(8000), headers: probe ? { Range: 'bytes=0-1023' } : {} }); if (!r.ok) throw new Error('The video server is unavailable.');
      if (!probe) return { text: await r.text(), url };
      const reader = r.body?.getReader(); if (!reader) throw new Error('The video server returned no media.'); let text = '', length = 0;
      try { while (length < 1024) { const chunk = await reader.read(); if (chunk.done) break; text += new TextDecoder().decode(chunk.value.subarray(0, 1024 - length)); length += chunk.value.length; } } finally { await reader.cancel(); }
      if (!length) throw new Error('The video server returned no media.'); return { text, url };
    };
    const validate = (text: string) => { if (/file deleted|DMCA request/i.test(text)) throw new Error('This video file has been removed by the source. Choose another available audio or title.'); if (/^\s*(?:<!doctype|<html|<body)/i.test(text)) throw new Error('The source returned a web page instead of video. Choose another audio or title.'); };
    let address = source.streams[0].url;
    if (source.streams[0].mimeType === 'application/x-mpegURL') {
      for (let depth = 0; depth < 3; depth++) {
        const r = await read(address); validate(r.text); if (!r.text.trimStart().startsWith('#EXTM3U')) throw new Error('The video playlist is unavailable.');
        const line = r.text.split('\n').find(l => l.trim() && !l.startsWith('#')); if (!line) throw new Error('The video playlist has no media.');
        address = new URL(line.trim(), r.url).href; if (address.includes('/api/media?')) address = new URL(address).searchParams.get('url') || address;
        if (!r.text.includes('#EXT-X-STREAM-INF')) { validate((await read(address, true)).text); return; }
      } throw new Error('This video playlist is not supported.');
    } validate((await read(address, true)).text);
  }
  // The original source needs no marker, so its web proxy addresses stay as they were.
  private providerQuery(id?: ProviderId) { return id && id !== 'pelisflix' ? `&provider=${id}` : ''; }
  async playback(item: Item, selection: Selection): Promise<Source> {
    if (item.stream) return { streams: [{ quality: 'Original', url: item.stream, alternatives: [] }], subtitles: [], headers: {} };
    const detailed = await this.details(item), provider = await this.provider(providerIdOf(item.id)), attempts = await provider.attempts(detailed, selection);
    let lastError: unknown, removed: Error | undefined;
    for (const attempt of attempts) {
      try {
        const resolved: Source = { ...(await attempt()), provider: provider.id }; await this.checkStream(resolved);
        return isNative ? resolved : { ...resolved, streams: resolved.streams.map(stream => ({ ...stream, url: `/api/media?url=${encodeURIComponent(stream.url)}&referer=${encodeURIComponent(resolved.headers.Referer || '')}${this.providerQuery(provider.id)}` })) };
      } catch (error) { lastError = error; if (error instanceof Error && /removed by the source/.test(error.message)) removed = error; }
    }
    throw new Error(`The available video servers could not be opened. ${removed?.message || (lastError instanceof Error ? lastError.message : 'Try another audio choice.')}`);
  }
  async collections(_page = 1): Promise<Collection[]> {
    if (this.settings.mode === 'demo') return [{ name: 'An evening elsewhere', url: 'preview:collection', image: '/artwork/scifi.jpg', count: '12 stories' }];
    return (await (await this.provider(this.active)).collections?.()) || [];
  }
  async collectionIndex() { return this.collections(); }
  async comments(_item: Item, _page = 1): Promise<{ comments: Comment[]; hasNext: boolean }> { return { comments: [], hasNext: false }; }
  // Only Pelisflix links to people, and its pages stay reachable whichever source is chosen for browsing.
  async person(url: string) { return (await this.provider('pelisflix')).person!(url); }
}
