import type { ProviderId } from '../types';
import { mediaURL, sourceURL, trustedPlayerURL } from '../pelisflix-policy';
import { forteAllowed, forteMedia, forteReferer } from './pelisforte-policy';
import { fuegoAllowed, fuegoMedia, fuegoReferer } from './fuegocine-policy';
// What each provider may stream. This stays free of parsers so the dev server can use it too.
export interface MediaPolicy { media(url: string): string | undefined; referer(url: string): boolean }
const policies: Record<ProviderId, MediaPolicy> = {
  pelisflix: { media: mediaURL, referer: url => !!trustedPlayerURL(url) },
  pelisforte: { media: forteMedia, referer: forteReferer },
  fuegocine: { media: fuegoMedia, referer: fuegoReferer }
};
export const providerIds = Object.keys(policies) as ProviderId[];
export const providerLabels: Record<ProviderId, string> = { pelisflix: 'Pelisflix', pelisforte: 'Pelisforte', fuegocine: 'Fuegocine' };
// Every address the app's own sources may be asked for. Embed pages that change often are allowed per playback instead.
export function sourceAllowed(url: string, mirror: string) { return sourceURL(url, mirror) || !!trustedPlayerURL(url) || forteAllowed(url) || fuegoAllowed(url); }
export function isProviderId(value: unknown): value is ProviderId { return typeof value === 'string' && value in policies; }
// Anything without a recognised provider keeps the original Pelisflix rules.
export function mediaPolicy(id?: string): MediaPolicy { return policies[isProviderId(id) ? id : 'pelisflix']; }
// Saved titles carry their source in the ID prefix. Older saves have no prefix of their own and belong to Pelisflix.
export function providerIdOf(id: string | undefined): ProviderId {
  const prefix = id?.match(/^([a-z]+):/)?.[1];
  return isProviderId(prefix) ? prefix : 'pelisflix';
}
