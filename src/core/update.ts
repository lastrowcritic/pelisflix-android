// Finds newer app releases published on GitHub.
export interface Release { version: string; apk: string; page: string; notes: string }

const parts = (version: string) => version.trim().replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(part => Number.parseInt(part, 10) || 0);

/** Positive when a is newer than b, negative when older, 0 when equal. */
export function compareVersions(a: string, b: string) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** Reads a GitHub "latest release" response. Returns null when it has no installable APK. */
export function parseRelease(json: unknown): Release | null {
  const release = json as { tag_name?: unknown; html_url?: unknown; body?: unknown; draft?: unknown; prerelease?: unknown; assets?: { name?: unknown; browser_download_url?: unknown }[] };
  if (!release || typeof release.tag_name !== 'string' || release.draft || release.prerelease) return null;
  const asset = (release.assets || []).find(a => typeof a.name === 'string' && a.name.toLowerCase().endsWith('.apk') && !a.name.toLowerCase().includes('debug') && typeof a.browser_download_url === 'string');
  if (!asset) return null;
  return { version: release.tag_name.replace(/^v/i, ''), apk: asset.browser_download_url as string, page: typeof release.html_url === 'string' ? release.html_url : '', notes: typeof release.body === 'string' ? release.body.trim() : '' };
}

/** Returns the latest release when it is newer than the installed version. */
export async function findUpdate(current: string, repo: string, fetchText: (url: string) => Promise<string>) {
  if (!repo || !current) return null;
  const release = parseRelease(JSON.parse(await fetchText(`https://api.github.com/repos/${repo}/releases/latest`)));
  return release && compareVersions(release.version, current) > 0 ? release : null;
}
