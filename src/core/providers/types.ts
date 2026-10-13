import type { Catalogue, Collection, Item, Person, ProviderId, Selection, Settings, Source } from '../types';
export interface Reply { text: string; url: string; status: number }
// What a provider may ask of the app. Calls are resolved when made, so the app can still wrap or replace them.
export interface ProviderHost {
  readonly settings: Settings;
  request(url: string, form?: Record<string, string>, referer?: string, timeout?: number): Promise<Reply>;
  html(url: string, ttl?: number): Promise<Reply>;
  // Drops a saved page, for when it turned out unusable and must be fetched again.
  forget(url: string): void;
  // Allows one embed page address that was read from a player redirect, for this session only.
  trust(url: string): void;
  selectMirror(url: string): void;
}
export interface DetailOptions {
  // Also settle whether the title has Castellano, for sources whose listings cannot say. That can mean opening a slow page.
  castellano?: boolean;
}
// One way to open a player. The app checks the result before playing it and moves on to the next attempt when it fails.
export type Attempt = () => Promise<Source>;
export interface Provider {
  readonly id: ProviderId;
  catalogue(path: string | undefined, page: number, filter?: string): Promise<Catalogue>;
  search(query: string, page: number): Promise<Catalogue>;
  details(item: Item, options?: DetailOptions): Promise<Item>;
  // Resolves the chosen audio and episode into the players to try. Throws when the choice does not exist.
  attempts(item: Item, selection: Selection): Promise<Attempt[]>;
  collections?(): Promise<Collection[]>;
  person?(url: string): Promise<Person>;
}
