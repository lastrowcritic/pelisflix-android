import type { Selection, Translator } from '../types';
// WordPress style listings put the page number in the path: /films/page/2/
export function catalogueURL(base: string, page = 1, _filter?: string) { const url = new URL(base); url.pathname = url.pathname.replace(/\/page\/\d+\/?$/, '/'); url.searchParams.delete('page'); url.searchParams.delete('filter'); if (page > 1) url.pathname = url.pathname.replace(/\/?$/, '/') + `page/${page}/`; return url.href; }
export const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
// The audio the viewer asked for, or the first one when nothing was asked. A request for audio that does not exist is an error, never a silent change.
export function chooseAudio(audio: Translator[], selection: Selection): Translator {
  const preferred = audio.find(a => a.id === selection.translator);
  if (selection.translator && !preferred) throw new Error('This episode does not have the selected audio. Choose another language.');
  const translator = preferred || audio[0];
  if (!translator?.sources?.length) throw new Error('No playable server is available for this title.');
  return translator;
}
