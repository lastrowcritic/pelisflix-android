import { describe, expect, it } from 'vitest';
import { compareVersions, findUpdate, parseRelease } from '../src/core/update';

const release = (tag: string, assets = [{ name: `Rezka-${tag.replace(/^v/, '')}.apk`, browser_download_url: `https://github.com/o/r/releases/download/${tag}/Rezka.apk` }]) =>
  ({ tag_name: tag, html_url: `https://github.com/o/r/releases/tag/${tag}`, body: ' Fixes ', draft: false, prerelease: false, assets });

describe('app updates', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.0', '1.2')).toBe(0);
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0-beta', '1.9.9')).toBeGreaterThan(0);
  });
  it('reads the APK from a release', () => {
    expect(parseRelease(release('v1.2.3'))).toEqual({ version: '1.2.3', apk: 'https://github.com/o/r/releases/download/v1.2.3/Rezka.apk', page: 'https://github.com/o/r/releases/tag/v1.2.3', notes: 'Fixes' });
    expect(parseRelease(release('v1.2.3', [{ name: 'Rezka-1.2.3-debug.apk', browser_download_url: 'x' }]))).toBeNull();
    expect(parseRelease({ ...release('v1.2.3'), prerelease: true })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
  it('only offers newer releases', async () => {
    const fetchText = async () => JSON.stringify(release('v1.1.0'));
    expect((await findUpdate('1.0.0', 'o/r', fetchText))?.version).toBe('1.1.0');
    expect(await findUpdate('1.1.0', 'o/r', fetchText)).toBeNull();
    expect(await findUpdate('1.0.0', '', fetchText)).toBeNull();
  });
});
