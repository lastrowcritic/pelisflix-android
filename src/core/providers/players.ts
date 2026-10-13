import type { Source } from '../types';
import type { ProviderHost } from './types';
import { mediaURL, voeEmbedURL } from '../pelisflix-policy';
export const playerAgent = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';

// VOE keeps the stream addresses in a scrambled JSON script. Only decode that text and never run the page.
function voeData(html: string): Record<string, unknown> | undefined {
  const raw = html.match(/<script[^>]+type="application\/json"[^>]*>([\s\S]*?)<\/script>/)?.[1]; if (!raw) return;
  try {
    let scrambled = (JSON.parse(raw) as string[])[0].replace(/[a-z]/gi, c => { const start = c <= 'Z' ? 65 : 97; return String.fromCharCode((c.charCodeAt(0) - start + 13) % 26 + start); });
    for (const noise of ['@$', '^^', '~@', '%?', '*~', '!!', '#&']) scrambled = scrambled.split(noise).join('');
    const reversed = [...atob(scrambled)].map(c => String.fromCharCode(c.charCodeAt(0) - 3)).reverse().join('');
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(reversed), c => c.charCodeAt(0))));
    return data && typeof data === 'object' ? data : undefined;
  } catch { return; }
}
// `accept` is the calling provider's own video address policy.
export function parseVoe(html: string, base: string, accept: (url: string) => string | undefined = mediaURL): Source {
  const id = new URL(base).pathname.match(/^\/e\/([A-Za-z0-9_-]+)\/?$/)?.[1], data = voeData(html);
  const candidates = ([[data?.source, 'application/x-mpegURL'], [data?.direct_access_url, 'video/mp4']] as [unknown, string][]).flatMap(([address, mimeType]) => typeof address === 'string' && address ? [{ address, mimeType }] : []);
  if (!id || !candidates.length) throw new Error('This server did not provide a playable video.');
  const option = candidates.find(c => accept(c.address)); if (!option) throw new Error('This video server is not supported yet.');
  // The proxy and the player only accept the stable VOE address as the referrer, not the embed domain that keeps changing.
  return { streams: [{ quality: 'Auto', url: accept(option.address)!, alternatives: [], mimeType: option.mimeType }], subtitles: [], headers: { Referer: `https://voe.sx/e/${id}`, 'User-Agent': playerAgent } };
}
// voe.sx answers with a tiny page that moves to an embed page on a domain that changes often.
export function voeRedirect(html: string, base: string): string | undefined {
  let page: URL; try { page = new URL(base); } catch { return; }
  if (page.hostname !== 'voe.sx' || html.length > 5000) return;
  const id = page.pathname.match(/^\/e\/([A-Za-z0-9_-]+)\/?$/)?.[1], target = html.match(/location(?:\.href)?\s*=\s*['"](https?:\/\/[^'"]+)['"]/)?.[1];
  return id && target ? voeEmbedURL(target, id) : undefined;
}
export async function resolveVoe(host: ProviderHost, start: string, referer: string, accept?: (url: string) => string | undefined): Promise<Source> {
  let url = start, page = referer;
  for (let hop = 0; hop < 3; hop++) {
    const response = await host.request(url, undefined, page), next = voeRedirect(response.text, response.url);
    if (!next) return parseVoe(response.text, response.url, accept);
    host.trust(next); url = next; page = response.url;
  }
  throw new Error('This video server redirected too many times.');
}

// Reads a Dean Edwards packed script as text: eval(function(p,a,c,k,e,d){...}('payload',radix,count,'words'.split('|'))).
// The packed code is never evaluated, only the word table is applied.
export function unpack(script: string): string | undefined {
  const match = script.match(/\}\(\s*'((?:[^'\\]|\\[\s\S])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\[\s\S])*)'\s*\.split\(\s*'\|'\s*\)/);
  if (!match) return;
  const radix = Number(match[2]), count = Number(match[3]);
  if (radix < 2 || radix > 36 || count > 100000) return;
  const unescape = (value: string) => value.replace(/\\([\s\S])/g, (_, c: string) => ({ n: '\n', t: '\t', r: '\r' } as Record<string, string>)[c] ?? c), words = unescape(match[4]).split('|'), table = new Map<string, string>();
  for (let index = 0; index < count; index++) if (words[index]) table.set(index.toString(radix), words[index]);
  return unescape(match[1]).replace(/\b\w+\b/g, token => table.get(token) ?? token);
}
