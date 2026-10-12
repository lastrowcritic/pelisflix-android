export class VerificationRequired extends Error {
  constructor(public url: string) { super('Complete website verification to load the catalogue.'); }
}
export function isChallenge(html: string) {
  return /just a moment|attention required|cf-browser-verification|cf-turnstile|challenge-platform|anubis_challenge|\.within\.website|Защищено Anubis/i.test(html);
}
