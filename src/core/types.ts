export type Kind = 'movie' | 'series' | 'animation' | 'anime';
export interface Link { name: string; url: string; image?: string; year?:string; rating?:string }
export interface Collection extends Link { count:string }
export interface Episode { id: string; title: string; season: string; page?: string; image?: string }
export interface Season { id: string; title: string; episodes: Episode[]; page?: string }
export interface Translator { id: string; name: string; selected: boolean; premium: boolean; sources?: {url:string;name:string}[] }
export interface Item {
  id: string; title: string; originalTitle?: string; kind: Kind; year?: number;
  genre: string; synopsis: string; poster?: string; backdrop?: string; page?: string;
  stream?: string; duration?: number; countries?: string[]; rating?: string;
  translators?: Translator[]; seasons?: Season[]; isSeries?: boolean;
  actors?: Link[]; directors?: Link[]; collections?: Link[]; rankings?: Link[];
  information?: Record<string, string>; franchise?: Link[]; franchiseTitle?:string;
  rezkaID?:string; ratings?:{name:string;value:string;url?:string}[];
  schedule?: { title: string; rows: { episode: string; title: string; date: string }[] }[];
}
export interface Catalogue { items: Item[]; hasNext: boolean; categories: (Link & { kind: Kind })[] }
export interface Stream { quality: string; url: string; alternatives: string[]; mimeType?: string }
export interface Subtitle { label: string; language: string; url: string }
export interface Source { streams: Stream[]; subtitles: Subtitle[]; headers: Record<string,string>; defaultSubtitle?: string }
export interface Selection { translator?: string; season?: string; episode?: string }
export interface WatchRecord extends Selection {
  item: Item; position: number; duration: number; updatedAt: number; completed: boolean;
}
export interface Settings {
  mode: 'live' | 'demo'; mirror: string; quality: string; autoplay: boolean;
  excludedCountries: string[]; reducedMotion: boolean;
}
export interface Comment { id: string; author: string; date: string; text: string; likes: string; indent: number; parentID?:string; avatar?:string }
export interface Person { name: string; originalName: string; image?: string; birthDate: string; jobs: string[]; filmography: Item[]; careers:Link[] }
export interface Download { id: string; item: Item; selection: Selection; progress: number; state: string; url: string; headers: Record<string,string> }
