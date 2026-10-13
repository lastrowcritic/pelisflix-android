export const fuegocineBase = 'https://www.fuegocine.com/';
const contentHost = 'www.fuegocine.com';
const secure = (url: URL) => url.protocol === 'https:' && !url.username && !url.password && !url.port;
// Public DNS names only: never an address literal or an internal name.
const publicHost = (host: string) => /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(host) && !/\.(?:local|localhost|internal|lan)$/i.test(host);
export function fuegoContentURL(raw: string | undefined, base = fuegocineBase): string | undefined {
  if (!raw) return;
  try { const url = new URL(raw, base); return secure(url) && url.hostname === contentHost ? url.href : undefined; } catch { return; }
}
// Link wrappers carry the real video address in a link parameter. Only the plain file or playlist inside is used.
export function fuegoWrappedVideo(raw: string): string | undefined {
  try {
    const wrapper = new URL(raw);
    if (!secure(wrapper) || wrapper.hostname !== 'repfuegocinefree.blogspot.com') return;
    return fuegoDirectVideo(wrapper.searchParams.get('link') || '');
  } catch { return; }
}
export function fuegoDirectVideo(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (!secure(url) || !publicHost(url.hostname) || !/\.(?:mp4|m3u8)$/i.test(url.pathname) || /api_key|token=|password=/i.test(url.search)) return;
    return url.href;
  } catch { return; }
}
export function fuegoOkruURL(raw: string): string | undefined {
  try { const url = new URL(raw); return secure(url) && url.hostname === 'ok.ru' && /^\/videoembed\/\d+\/?$/.test(url.pathname) ? url.href : undefined; } catch { return; }
}
export function fuegoUnlimplayURL(raw: string): string | undefined {
  try { const url = new URL(raw); return secure(url) && url.hostname === 'unlimplay.com' && /^\/(?:f|play)\/embed\/(?:movie\/\d+|tv\/\d+\/\d+\/\d+)\/?$/.test(url.pathname) ? url.href : undefined; } catch { return; }
}
export function fuegoVoeURL(raw: string): string | undefined {
  try { const url = new URL(raw); return secure(url) && url.hostname === 'voe.sx' && /^\/e\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ? url.href : undefined; } catch { return; }
}
export function fuegoAllowed(raw: string) { return !!fuegoContentURL(raw) || !!fuegoOkruURL(raw) || !!fuegoUnlimplayURL(raw) || !!fuegoVoeURL(raw); }
export function fuegoMedia(raw: string) {
  try { const url = new URL(raw); return secure(url) && publicHost(url.hostname) ? url.href : undefined; } catch { return; }
}
export function fuegoReferer(raw: string) {
  if (!raw) return true;
  try { const url = new URL(raw); return secure(url) && publicHost(url.hostname); } catch { return false; }
}
