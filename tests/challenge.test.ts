import { describe, expect, it } from 'vitest';
import { isChallenge } from '../src/core/challenge';

describe('Challenge detection', () => {
  it('does not flag a normal page that carries the Cloudflare detection script', () => {
    const page = `<html><head><title>Todas las Películas</title></head><body><script>(function(){var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.head.appendChild(a);})()</script></body></html>`;
    expect(isChallenge(page)).toBe(false);
  });
  it('flags the Cloudflare interstitial', () => {
    expect(isChallenge('<title>Just a moment...</title>')).toBe(true);
    expect(isChallenge(`<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=abc"></script>`)).toBe(true);
    expect(isChallenge('<div class="cf-turnstile"></div>')).toBe(true);
  });
  it('flags the Anubis page', () => {
    expect(isChallenge('<script id="anubis_challenge" type="application/json">{}</script>')).toBe(true);
  });
});
