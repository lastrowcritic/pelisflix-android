export const pelisforteBase = 'https://www2.pelisforte.se/';
const contentHost = 'www2.pelisforte.se';
// The player wrapper (mp4.nu) hands over to the Okhd video network. Nothing else is requested for playback.
const secure = (url: URL) => url.protocol === 'https:' && !url.username && !url.password && !url.port;
export function forteContentURL(raw: string | undefined, base = pelisforteBase): string | undefined {
  if (!raw) return;
  try { const url = new URL(raw, base); return secure(url) && url.hostname === contentHost ? url.href : undefined; } catch { return; }
}
export function fortePlayerURL(raw: string | undefined, base = pelisforteBase): string | undefined {
  if (!raw) return;
  try { const url = new URL(raw, base); return secure(url) && /^mp4\.nu$|(^|\.)okhd\.nu$/.test(url.hostname) ? url.href : undefined; } catch { return; }
}
export function forteAllowed(raw: string) { return !!forteContentURL(raw) || !!fortePlayerURL(raw); }
export function forteMedia(raw: string) {
  try { const url = new URL(raw); return secure(url) && /(^|\.)okhd\.nu$/.test(url.hostname) ? url.href : undefined; } catch { return; }
}
export function forteReferer(raw: string) { return !!fortePlayerURL(raw); }
