// Whether a title has a Spanish option is only known after opening its slow unlimplay page, so each answer is kept, also between sessions.
// A page that has Spanish keeps it, but a page that was seen without it may only have been served incomplete, so that answer is asked again sooner.
const storageKey = 'pelisflix.fuegocine.spanish.v1', lifetime = 7 * 24 * 60 * 60 * 1000, absentLifetime = 2 * 24 * 60 * 60 * 1000, limit = 1500;
type Answers = Record<string, [found: 0 | 1, time: number]>;
type Store = Pick<Storage, 'getItem' | 'setItem'>;
// The storage can be missing or refuse access (private windows, blocked site data), and the answers are then only kept for this session.
function defaultStore(): Store | undefined { try { return localStorage; } catch { return undefined; } }

export class SpanishAnswers {
  private answers?: Answers;
  constructor(private store: Store | undefined = defaultStore()) {}
  private read(): Answers {
    const answers: Answers = {};
    try {
      const saved = JSON.parse(this.store?.getItem(storageKey) || '{}');
      for (const [url, entry] of Object.entries(saved ?? {})) if (Array.isArray(entry) && (entry[0] === 0 || entry[0] === 1) && Number.isFinite(entry[1])) answers[url] = [entry[0], entry[1]];
    } catch { /* Start without them. */ }
    return answers;
  }
  private load(): Answers { return this.answers ??= this.read(); }
  // Undefined when the page has not been checked, or not recently enough.
  get(url: string): boolean | undefined {
    const entry = this.load()[url];
    return entry && Date.now() - entry[1] < (entry[0] === 1 ? lifetime : absentLifetime) ? entry[0] === 1 : undefined;
  }
  set(url: string, found: boolean): void {
    // Another window or an earlier source object may have saved answers since, so they are merged rather than replaced.
    const answers = this.answers = { ...this.read(), ...this.load() };
    delete answers[url]; answers[url] = [found ? 1 : 0, Date.now()];
    for (const old of Object.keys(answers).slice(0, Math.max(0, Object.keys(answers).length - limit))) delete answers[old];
    try { this.store?.setItem(storageKey, JSON.stringify(answers)); } catch { /* Kept for this session only. */ }
  }
}
