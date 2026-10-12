import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Item } from '../core/types';
import type { ContentSource } from '../core/source';

const CACHE_KEY = 'rezka.ratings.v2';
const LEGACY_CACHE_KEY = 'rezka.ratings.v1';
const RATING_TTL = 45 * 24 * 60 * 60 * 1000;
const MISSING_TTL = 14 * 24 * 60 * 60 * 1000;
const MAX_CACHE_AGE = 180 * 24 * 60 * 60 * 1000;
const MAX_CACHE_ITEMS = 1200;

type RatingEntry = { rating: string | null; updatedAt: number };
type RatingCache = Record<string, RatingEntry>;

function stored(): RatingCache {
  try {
    const now = Date.now();
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') as Record<string, unknown>;
    const entries: RatingCache = {};

    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as Partial<RatingEntry>;
      if ((typeof entry.rating !== 'string' && entry.rating !== null) || typeof entry.updatedAt !== 'number') continue;
      if (!Number.isFinite(entry.updatedAt) || now - entry.updatedAt > MAX_CACHE_AGE) continue;
      entries[id] = { rating: entry.rating, updatedAt: entry.updatedAt };
    }

    if (Object.keys(entries).length) return entries;

    // Preserve existing IMDb scores from the earlier cache format. Missing scores
    // are deliberately refreshed because the old format did not record their age.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_CACHE_KEY) || '{}') as Record<string, unknown>;
    for (const [id, rating] of Object.entries(legacy)) {
      if (typeof rating === 'string') entries[id] = { rating, updatedAt: now };
    }
    return entries;
  } catch {
    return {};
  }
}

function createRatings(source: ContentSource) {
  const entries = stored();
  const values: Record<string, string | null> = Object.fromEntries(
    Object.entries(entries).map(([id, entry]) => [id, entry.rating]),
  );
  const listeners = new Map<string, Set<() => void>>();
  const pending = new Set<string>();
  const queue: Item[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;

  const persist = () => {
    try {
      const bounded = Object.fromEntries(Object.entries(entries).slice(-MAX_CACHE_ITEMS));
      localStorage.setItem(CACHE_KEY, JSON.stringify(bounded));
    } catch {
      // Browser storage is an optional performance cache.
    }
  };

  const publish = (id: string, rating: string | null) => {
    values[id] = rating;
    delete entries[id];
    entries[id] = { rating, updatedAt: Date.now() };
    while (Object.keys(entries).length > MAX_CACHE_ITEMS) delete entries[Object.keys(entries)[0]];
    persist();
    listeners.get(id)?.forEach(listener => listener());
  };

  const pump = () => {
    if (disposed || running || !queue.length) return;
    if (document.hidden) {
      timer = setTimeout(pump, 1000);
      return;
    }
    const idleFor = Date.now() - Number(document.documentElement.dataset.remoteInputAt || 0);
    if (idleFor < 700) {
      timer = setTimeout(pump, 700 - idleFor);
      return;
    }
    const item = queue.shift()!;
    running = true;
    source.rating(item)
      .then(rating => {
        if (!disposed) publish(item.id, rating);
      })
      .catch(() => {
        // Missing metadata never interrupts playback.
      })
      .finally(() => {
        pending.delete(item.id);
        running = false;
        if (!disposed) timer = setTimeout(pump, 250);
      });
  };

  return {
    get: (id: string) => values[id],
    subscribe: (id: string, listener: () => void) => {
      const list = listeners.get(id) || new Set();
      list.add(listener);
      listeners.set(id, list);
      return () => { list.delete(listener); };
    },
    load: (item: Item) => {
      if (disposed || item.rating || !item.page || pending.has(item.id)) return;
      const entry = entries[item.id];
      const ttl = entry?.rating === null ? MISSING_TTL : RATING_TTL;
      if (entry && Date.now() - entry.updatedAt < ttl) return;
      pending.add(item.id);
      queue.push(item);
      if (!running) {
        clearTimeout(timer);
        timer = setTimeout(pump, 400);
      }
    },
    publish,
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      queue.length = 0;
      listeners.clear();
    },
  };
}

type Ratings = ReturnType<typeof createRatings>;
const Context = createContext<Ratings | undefined>(undefined);

export function RatingsProvider({ source, children }: { source: ContentSource; children: ReactNode }) {
  const store = useMemo(() => createRatings(source), [source]);
  useEffect(() => {
    const handler = (event: Event) => {
      const { id, rating } = (event as CustomEvent<{ id: string; rating: string | null }>).detail;
      store.publish(id, rating);
    };
    window.addEventListener('rezka-rating', handler);
    return () => {
      window.removeEventListener('rezka-rating', handler);
      store.dispose();
    };
  }, [store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function IMDbBadge({ item }: { item: Item }) {
  const store = useContext(Context)!;
  const ref = useRef<HTMLSpanElement>(null);
  const subscribe = useMemo(() => (listener: () => void) => store.subscribe(item.id, listener), [store, item.id]);
  const rating = useSyncExternalStore(subscribe, () => item.rating || store.get(item.id));

  useEffect(() => {
    const element = ref.current;
    if (!element || !item.page || item.rating) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        store.load(item);
        observer.disconnect();
      }
    }, { threshold: .15 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [item, store]);

  return rating?<span ref={ref} className="imdb-badge" aria-label={`IMDb rating ${rating}`}><b>IMDb</b><strong>{rating}</strong></span>:<span ref={ref} className="imdb-placeholder" aria-hidden="true"/>;
}
