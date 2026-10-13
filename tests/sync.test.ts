import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { clearSession, mergeHistory, normalizeSyncServer, ownRecord, pushHistory, saveSession, storedSession } from '../src/core/sync';
import { continueWatching, defaults, episodeKey, loadState, resumePosition, STORE_KEY } from '../src/core/store';
import { providerIdOf } from '../src/core/providers/policy';
import type { WatchRecord } from '../src/core/types';

// "sent" is what the app uploads and "stored" is what the sync server's own PHP keeps of it.
const { sent, stored } = JSON.parse(readFileSync('tests/fixtures/sync/server-history.json', 'utf8')) as { sent: WatchRecord[]; stored: WatchRecord[] };
const [movie, show, fuego] = stored;
// Titles from the Rezka apps share the same account. Their ids are plain numbers.
const rezkaMovie = { item: { id: '777', title: 'Rezka Film', kind: 'movie', genre: '', synopsis: '' }, position: 600, duration: 6000, updatedAt: 99000, completed: false } as WatchRecord;
afterEach(() => { vi.unstubAllGlobals(); });

describe('sync server address', () => {
  it('is off when empty and keeps any path on the server', () => {
    expect(normalizeSyncServer('  ')).toBe('');
    expect(normalizeSyncServer('sync.example.com')).toBe('https://sync.example.com');
    expect(normalizeSyncServer('https://Example.com/pelisflix-sync/ ')).toBe('https://example.com/pelisflix-sync');
  });
  it('only accepts https addresses without extras', () => {
    expect(() => normalizeSyncServer('http://sync.example.com')).toThrow(/https/);
    expect(() => normalizeSyncServer('https://user:pass@sync.example.com')).toThrow();
    expect(() => normalizeSyncServer('https://sync.example.com/?a=1')).toThrow();
    expect(() => normalizeSyncServer('https://sync.example.com/#top')).toThrow();
  });
  it('is off by default', () => { expect(defaults.settings.syncServer).toBe(''); });
  it('never hands a session to a different server', async () => {
    await saveSession({ token: 't', email: 'a@b.c', expiresAt: 1, server: 'https://one.example.com' });
    expect((await storedSession('https://one.example.com'))?.token).toBe('t');
    expect(await storedSession('https://two.example.com')).toBeNull();
    await clearSession();
    expect(await storedSession('https://one.example.com')).toBeNull();
  });
});

describe('merging viewing history', () => {
  it('keeps the newest record of each title and episode', () => {
    const older = { ...movie, position: 10, updatedAt: 1 }, newer = { ...movie, position: 20, updatedAt: 2 };
    expect(mergeHistory([older], [newer], 0)[0].position).toBe(20);
    expect(mergeHistory([newer], [older], 0)[0].position).toBe(20);
    expect(mergeHistory([{ ...show, episode: '2', updatedAt: 3 }, show], [], 0)).toHaveLength(2);
  });
  it('drops records from before the history was cleared', () => {
    const merged = mergeHistory([{ ...movie, updatedAt: 5 }], [{ ...show, updatedAt: 5 }, { ...fuego, updatedAt: 6 }], 5);
    expect(merged.map(r => r.item.id)).toEqual([fuego.item.id]);
  });
  it('lists the most recent first and keeps at most 500', () => {
    const many = Array.from({ length: 520 }, (_, i) => ({ ...movie, item: { ...movie.item, id: `pelisflix:t${i}` }, updatedAt: i + 1 }));
    const merged = mergeHistory(many, [], 0);
    expect(merged).toHaveLength(500);
    expect(merged[0].updatedAt).toBe(520);
  });
  it('leaves the other apps\' titles on the server and out of the list', () => {
    expect(mergeHistory([], [rezkaMovie, movie], 0).map(r => r.item.id)).toEqual([movie.item.id]);
    // Whatever is already on this device is never thrown away by a sync.
    expect(mergeHistory([rezkaMovie], [], 0)).toHaveLength(1);
  });
  it('only recognises its own sources', () => {
    expect([movie, show, fuego].every(ownRecord)).toBe(true);
    expect(ownRecord(rezkaMovie)).toBe(false);
    expect(ownRecord({ ...movie, item: { ...movie.item, id: 'hdrezka:1' } })).toBe(false);
    expect(ownRecord({ ...movie, item: { ...movie.item, id: 'constructor:1' } })).toBe(false);
  });
});

describe('uploading viewing history', () => {
  it('sends only titles from this app\'s own sources', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ records: [], clearedAt: 0 }), { status: 200 }); }));
    await pushHistory({ token: 'secret', email: 'a@b.c', expiresAt: 1, server: 'https://sync.example.com/base' }, [movie, rezkaMovie, show]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sync.example.com/base/v1/history');
    expect(calls[0].init.method).toBe('PUT');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer secret');
    expect(JSON.parse(calls[0].init.body as string).records.map((r: WatchRecord) => r.item.id)).toEqual([movie.item.id, show.item.id]);
  });
  it('reports a server that cannot be reached and a refusal in plain words', async () => {
    const session = { token: 't', email: 'a@b.c', expiresAt: 1, server: 'https://sync.example.com' };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(pushHistory(session, [])).rejects.toThrow('The sync server could not be reached.');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Session expired.' }), { status: 401 })));
    await expect(pushHistory(session, [])).rejects.toThrow('Session expired.');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 500 })));
    await expect(pushHistory(session, [])).rejects.toThrow('temporarily unavailable');
  });
});

describe('records that went through the sync server', () => {
  it('keep the title, its source and the episode', () => {
    expect(sent.map(r => providerIdOf(r.item.id))).toEqual(['pelisflix', 'pelisforte', 'fuegocine']);
    for (const [index, record] of stored.entries()) {
      const [back] = mergeHistory([], [record], 0), original = sent[index];
      expect(back.item.id).toBe(original.item.id);
      expect(back.item.title).toBe(original.item.title);
      expect(back.item.kind).toBe(original.item.kind);
      expect(back.item.page).toBe(original.item.page);
      expect(back.item.isSeries).toBe(original.item.isSeries);
      expect(back.item.poster ?? undefined).toBe(original.item.poster);
      expect(back.season).toBe(original.season);
      expect(back.episode).toBe(original.episode);
      expect(back.translator).toBe(original.translator);
      expect(episodeKey(back.item, back)).toBe(episodeKey(original.item, original));
    }
  });
  it('can be resumed and listed under Continue watching', () => {
    const history = mergeHistory([], stored, 0);
    expect(continueWatching(history).map(r => r.item.id)).toEqual([show.item.id, movie.item.id, fuego.item.id]);
    expect(resumePosition(history, sent[0].item, { translator: 'castellano' })).toBe(1260);
    expect(resumePosition(history, sent[1].item, { season: '3', episode: '1' })).toBe(600);
    expect(resumePosition(history, sent[1].item, { season: '3', episode: '2' })).toBe(0);
    expect(resumePosition(history, sent[2].item, { translator: 'latino' })).toBe(300);
  });
  it('lose only what the Detail screen reads again when the title is opened', () => {
    const [back] = mergeHistory([], [show], 0);
    expect(back.item.seasons?.[0].episodes.map(e => ({ id: e.id, season: e.season }))).toEqual([{ id: '1', season: '3' }, { id: '2', season: '3' }]);
    // Playing needs these, and they are refreshed from the source page that was kept.
    expect(back.item.seasons?.[0].episodes[0].page).toBeUndefined();
    expect(back.item.audio).toBeUndefined();
    expect(mergeHistory([], [movie], 0)[0].item.translators?.every(t => t.sources === undefined)).toBe(true);
    expect(back.item.page).toBeTruthy();
  });
});

describe('saved state', () => {
  it('reads what earlier builds saved under the old storage name', () => {
    const saved = JSON.stringify({ history: [sent[0]], favorites: [sent[1].item], settings: { castellanoOnly: true } });
    const state = loadState({ getItem: key => key === 'pelisflix.personal.v1' ? saved : null });
    expect(state.history[0].item.id).toBe(sent[0].item.id);
    expect(state.favorites[0].id).toBe(sent[1].item.id);
    expect(state.settings).toMatchObject({ castellanoOnly: true, syncServer: '' });
  });
  it('prefers the current storage name', () => {
    const current = JSON.stringify({ settings: { syncServer: 'https://sync.example.com' } }), old = JSON.stringify({ settings: { syncServer: 'https://old.example.com' } });
    const state = loadState({ getItem: key => key === STORE_KEY ? current : key === 'pelisflix.personal.v1' ? old : null });
    expect(state.settings.syncServer).toBe('https://sync.example.com');
  });
});
