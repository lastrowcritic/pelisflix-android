import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticate, deleteHistory, mergeHistory, pullHistory, pushHistory, signOut, type SyncSession } from '../src/core/sync';
import { continueWatching, resumePosition } from '../src/core/store';
import type { WatchRecord } from '../src/core/types';

// Runs the real sync server (PHP and SQLite). Point PELISFLIX_SYNC_SERVER at a checkout of rezka-sync-server:
//   PELISFLIX_SYNC_SERVER=/path/to/rezka-sync-server npx vitest run tests/sync-server.test.ts
const directory = process.env.PELISFLIX_SYNC_SERVER;
const { sent } = JSON.parse(readFileSync('tests/fixtures/sync/server-history.json', 'utf8')) as { sent: WatchRecord[] };
const [movie, show, fuego] = sent;
const rezkaMovie = { item: { id: '777', title: 'Rezka Film', kind: 'movie', page: 'https://hdrezka.example/films/777-film.html' }, position: 50, duration: 6000, updatedAt: 7000, completed: false, translator: '56' } as unknown as WatchRecord;
const port = 20000 + Math.floor(Math.random() * 30000);
// The server answers under a folder here, as it does on shared hosting.
const server = `http://127.0.0.1:${port}/sync`;

describe.skipIf(!directory)('sync with the real server', () => {
  let process_: ChildProcess, folder: string, phone: SyncSession, tv: SyncSession;
  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'pelisflix-sync-'));
    const database = join(folder, 'test.sqlite');
    await new Promise<void>((resolve, reject) => {
      const php = spawn('php', ['-r', `$d = new PDO('sqlite:' . $argv[1]); $d->exec(file_get_contents($argv[2]));`, database, join(directory!, 'tests/sqlite-schema.sql')]);
      php.on('exit', code => code === 0 ? resolve() : reject(new Error('Could not create the test database.')));
    });
    process_ = spawn('php', ['-S', `127.0.0.1:${port}`, join(directory!, 'tests/server.php')], { cwd: directory, env: { ...globalThis.process.env, REZKA_TEST_DB: database }, stdio: 'ignore' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await fetch(`${server}/health`)).ok) return; } catch { /* The server is still starting. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The test server did not start.');
  });
  afterAll(() => { process_?.kill(); if (folder) rmSync(folder, { recursive: true, force: true }); });

  it('signs in on two devices with one account', async () => {
    phone = await authenticate(server, 'register', 'Viewer@Example.com', 'a-long-password');
    tv = await authenticate(server, 'login', 'viewer@example.com', 'a-long-password');
    expect(phone).toMatchObject({ email: 'viewer@example.com', server });
    expect(phone.token).not.toBe(tv.token);
    await expect(authenticate(server, 'login', 'viewer@example.com', 'wrong-password-1')).rejects.toThrow();
  });
  it('shares history between devices without touching another app\'s titles', async () => {
    // A Rezka app has already saved a title to this account.
    await fetch(`${server}/v1/history`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${phone.token}` }, body: JSON.stringify({ records: [rezkaMovie] }) });
    // The phone uploads its own history, which includes a foreign title it must not send.
    const pushed = await pushHistory(phone, [movie, show, rezkaMovie]);
    expect(pushed.records.map(r => r.item.id).sort()).toEqual([movie.item.id, rezkaMovie.item.id, show.item.id].sort());
    // The TV starts empty. It sees its own sources' titles and can continue them.
    const remote = await pullHistory(tv), history = mergeHistory([], remote.records, remote.clearedAt);
    expect(history.map(r => r.item.id).sort()).toEqual([movie.item.id, show.item.id].sort());
    expect(continueWatching(history).map(r => r.item.id)).toEqual([show.item.id, movie.item.id]);
    expect(resumePosition(history, movie.item, { translator: 'castellano' })).toBe(1260);
    expect(resumePosition(history, show.item, { season: '3', episode: '1' })).toBe(600);
    expect(history.find(r => r.item.id === show.item.id)!.item.page).toBe(show.item.page);
  });
  it('keeps the newest position when two devices disagree', async () => {
    await pushHistory(tv, [{ ...movie, position: 3000, updatedAt: 20000 }, fuego]);
    await pushHistory(phone, [{ ...movie, position: 100, updatedAt: 15000 }]);
    const remote = await pullHistory(phone), history = mergeHistory([{ ...movie, position: 100, updatedAt: 15000 }], remote.records, remote.clearedAt);
    expect(resumePosition(history, movie.item, { translator: 'castellano' })).toBe(3000);
    expect(history.map(r => r.item.id)).toContain(fuego.item.id);
  });
  it('clears everything and ignores devices that still hold older history', async () => {
    const cleared = await deleteHistory(tv);
    expect(cleared.records).toEqual([]);
    expect(cleared.clearedAt).toBeGreaterThan(0);
    // The phone still has the old history on it. It must not bring it back.
    const stale = await pushHistory(phone, [movie, show]);
    expect(stale.records).toEqual([]);
    expect(mergeHistory([movie, show], stale.records, stale.clearedAt)).toEqual([]);
    // Something watched afterwards is kept.
    const fresh = { ...show, position: 5, updatedAt: cleared.clearedAt + 1000 };
    expect((await pushHistory(phone, [fresh])).records).toHaveLength(1);
  });
  it('refuses a signed-out session', async () => {
    await signOut(tv);
    await expect(pullHistory(tv)).rejects.toThrow();
    await expect(pullHistory(phone)).resolves.toBeTruthy();
  });
});
