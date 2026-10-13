import { load } from 'cheerio';
import type { Catalogue, Collection, Item, Kind, Link, Season, Translator, Source } from './types';

import {contentURL,playerURL,trustedPlayerURL} from './pelisflix-policy';
import {parseVoe,playerAgent,voeRedirect} from './providers/players';
export {contentURL,trustedPlayerURL,defaultMirror} from './pelisflix-policy';
const studios = new Set(['netflix','amazon','disney','hulu','fox','hbo','the-cw','usa-network','dc','marvel']);
const text = (value:string) => value.replace(/\s+/g,' ').trim();
function imageURL(raw:string|undefined,base:string):string|undefined {
  if(!raw)return;
  try{const url=new URL(raw,base),host=new URL(base).hostname;
    return url.protocol==='https:'&&(url.hostname===host||url.hostname===`s.${host}`||['cnddim.xyz','image.tmdb.org'].includes(url.hostname))?url.href:undefined;
  }catch{return;}
}
export function titleID(url:string){return `pelisflix:${new URL(url).pathname.replace(/\/$/,'')}`;}
export function parsePelisflixCatalogue(html:string,base:string,page=1):Catalogue {
  const $=load(html),items:Item[]=[],seen=new Set<string>();
  $('article').each((_,element)=>{
    const card=$(element);if(!card.find('h2.Title').length)return;const anchor=card.find('a[href]').filter((_,a)=>/\/(pelicula|serie)\/[^/]+\/?$/.test($(a).attr('href')||'')).first();
    const url=contentURL(anchor.attr('href'),base);if(!url)return;
    const id=titleID(url);if(seen.has(id))return;
    const title=text(card.find('h2.Title').first().text()||card.find('.Title').first().text());if(!title)return;
    seen.add(id);const kind:Kind=new URL(url).pathname.startsWith('/serie/')?'series':'movie';
    const info=card.find('.Info .Date').first().text()||card.find('.Qlty.Yr').first().text();
    const year=Number(info.match(/\b(?:19|20)\d{2}\b/)?.[0])||undefined;
    const poster=card.find('.Image img').first();
    const synopsis=text(card.find('.Description > p').not('.Genre,.Director,.Cast').first().text());
    const genre=card.find('.Genre a[href*="/genero/"]').map((_,e)=>text($(e).text()).replace(/,\s*$/,'')).get().filter(v=>!['Series','Estrenos'].includes(v)).join(', ');
    items.push({id,title,kind,year,genre,synopsis,poster:imageURL(poster.attr('data-src')||poster.attr('src'),base),page:url,isSeries:kind==='series'});
  });
  const genres:Link[]=[];const genreSlugs=new Set<string>();
  $('.Menu a[href],.widget_categories a[href]').each((_,a)=>{const url=contentURL($(a).attr('href'),base),slug=url&&new URL(url).pathname.match(/^\/genero\/([^/]+)\/?$/)?.[1];
    if(!slug||studios.has(slug)||['series-tv','series','lanzamientos'].includes(slug)||genreSlugs.has(slug))return;
    const name=text($(a).text()).replace(/,\s*$/,'');if(!name)return;genreSlugs.add(slug);genres.push({name,url:slug});
  });
  const categories=genres.flatMap(g=>(['movie','series'] as Kind[]).map(kind=>({name:g.name,kind,url:new URL(`${kind==='movie'?'films':'series'}/${g.url}/`,base).href})));
  const hasNext=$('.nav-links a,.next.page-numbers,a[rel="next"],.pagination a').toArray().some(a=>{const url=contentURL($(a).attr('href'),base);return !!url&&(Number(new URL(url).pathname.match(/\/page\/(\d+)\/?$/)?.[1])>page||$(a).hasClass('next'));});
  return {items,hasNext,categories};
}
export function parsePelisflixAudio(html:string,base:string):Translator[]{
  const $=load(html),result:Translator[]=[];
  $('.optns-bx .drpdn').each((_,group)=>{
    const sources:{url:string;name:string}[]=[];
    $(group).find('[data-url]').each((_,e)=>{try{const url=playerURL(atob($(e).attr('data-url')||''));if(url&&!sources.some(s=>s.url===url))sources.push({url,name:text($(e).find('span span').text())});}catch{/* Ignore malformed and advertising links. */}});
    if(!sources.length)return;
    const label=text($(group).find('.bstd > span').first().clone().children().remove().end().text());
    if(!label)return;const id=label.toLocaleLowerCase('es').replace(/\s+/g,'-');
    result.push({id,name:label==='LATINO'?'Latino':label==='CASTELLANO'?'Castellano':label==='SUBTITULADO'?'Subtitled':label,selected:result.length===0,premium:false,sources});
  });return result;
}
export function parsePelisflixDetails(html:string,base:string,item:Item):Item {
  const $=load(html),root=$('main article').first(),title=text(root.find('h1.Title').text()).replace(/^Ver\s+/i,'')||item.title;
  const backdrop=imageURL($('.TPostBg').first().attr('src'),base);
  const year=Number(root.find('.Info .Date').text().match(/\b(?:19|20)\d{2}\b/)?.[0])||item.year;
  const time=root.find('.Info .Time').text(),hours=Number(time.match(/(\d+)h/)?.[1])||0,minutes=Number(time.match(/(\d+)min/)?.[1])||0;
  const genres=root.find('.Genre a').map((_,e)=>text($(e).text()).replace(/,\s*$/,'')).get().filter(v=>!['Series','Estrenos'].includes(v));
  const summary=root.find('.Description > p').not('.Genre,.Director,.Cast').map((_,e)=>text($(e).text())).get().find(p=>p&&!/pelisflix|online|nuestra plataforma|nuestra página|hola!|estás disfrutando/i.test(p));
  const links=(selector:string)=>root.find(selector).toArray().flatMap(e=>{const url=contentURL($(e).attr('href'),base);return url?[{name:text($(e).text()),url}]:[];});
  const seasons:Season[]=[];
  $('a[href*="/temporada/"]').each((_,e)=>{const url=contentURL($(e).attr('href'),base),id=url&&new URL(url).pathname.match(/-(\d+)\/?$/)?.[1];if(id&&!seasons.some(s=>s.id===id))seasons.push({id,title:`Season ${id}`,episodes:[],page:url});});
  const ratingText=$('[itemprop="ratingValue"]').first().text().trim();
  return {...item,page:base,title,year,genre:genres.join(', ')||item.genre,synopsis:summary||item.synopsis,backdrop:backdrop||item.backdrop,duration:hours*60+minutes||item.duration,
    translators:parsePelisflixAudio(html,base),seasons:seasons.length?seasons:item.seasons,
    actors:links('.Cast a'),directors:links('.Director a'),information:{...(item.information||{}),...(year?{Year:String(year)}:{}),...(time?{Runtime:text(time)}:{})},
    ...(ratingText?{ratings:[{name:'Source rating',value:ratingText}]}:{})};
}
export function parsePelisflixEpisodes(html:string,base:string,seasonID:string):Season['episodes'] {
  const $=load(html),result:Season['episodes']=[];
  $('tr').each((_,e)=>{const row=$(e),a=row.find('a[href*="/episodio/"]').first(),page=contentURL(a.attr('href'),base),id=page&&new URL(page).pathname.match(/-\d+x(\d+)\/?$/)?.[1];
    if(!id||result.some(ep=>ep.id===id))return;
    const image=row.find('img').first();result.push({id,season:seasonID,title:text(row.find('.MvTbTtl a').text())||`Episode ${id}`,page,image:imageURL(image.attr('data-src')||image.attr('src'),base)});
  });return result;
}
export function parsePelisflixCollections(html:string,base:string):Collection[]{
  const $=load(html),seen=new Set<string>();return $('.Menu a[href*="/genero/"]').toArray().flatMap(e=>{const a=$(e),url=contentURL(a.attr('href'),base),slug=url&&new URL(url).pathname.match(/^\/genero\/([^/]+)\/?$/)?.[1];
    if(!slug||!studios.has(slug)||seen.has(slug))return [];seen.add(slug);const img=a.find('img');return [{name:text(a.text())||slug.toUpperCase(),url:url!,image:imageURL(img.attr('data-src')||img.attr('src'),base),count:''}];});
}
export function parsePelisflixHost(html:string,base:string):Source {
  if(!trustedPlayerURL(base))throw new Error('This player is not supported.');
  let media:string|undefined;
  // Decode the provider's data array only. Never evaluate its scripts or advertisements.
  const array=html.match(/var\s+\w+\s*=\s*(\["[A-Za-z0-9+/=]+"(?:\s*,\s*"[A-Za-z0-9+/=]+")+\])/);
  const offset=html.match(/parseInt\(atob\(\w+\)\.replace\(\/\\D\/g\s*,\s*''\)\)\s*-\s*(\d+)/);
  if(array&&offset){try{const values=JSON.parse(array[1]) as string[];media=values.map(v=>String.fromCharCode(Number(atob(v).replace(/\D/g,''))-Number(offset[1]))).join('');const session=html.match(/var\s+sesz\s*=\s*"([A-Za-z0-9]+)"/);if(session)media+=`?s=${session[1]}`;}catch{/* Try a literal player configuration below. */}}
  if(!media)media=html.match(/(?:file|hls)\s*["']?\s*:\s*["'](https?:[^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/)?.[1]?.replace(/\\\//g,'/');
  if(!media)throw new Error('This server did not provide a playable video.');
  const url=new URL(media,base);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||!(/(^|\.)ibra\.lat$|(^|\.)nupload\.me$|(^|\.)voe\.sx$/.test(url.hostname)))throw new Error('This video server is not supported yet.');
  return {streams:[{quality:'Auto',url:url.href,alternatives:[],mimeType:url.pathname.endsWith('.mp4')?'video/mp4':'application/x-mpegURL'}],subtitles:[],headers:{Referer:base,'User-Agent':playerAgent}};
}
// A player page can hand over to another one: nupload may only wrap a VOE iframe, and VOE redirects to an embed page on a changing domain.
// Returns the next page to read, or nothing when this page holds the video itself.
export function parsePelisflixEmbed(html:string,base:string):string|undefined {
  let page:URL;try{page=new URL(base);}catch{return;}
  if(/^nupload\.m[ey]$/.test(page.hostname)){
    const $=load(html);
    for(const frame of $('iframe[src]').toArray()){try{const url=new URL($(frame).attr('src')||'',base);if(url.hostname==='voe.sx'&&trustedPlayerURL(url.href))return url.href;}catch{/* Ignore malformed and advertising frames. */}}
    return;
  }
  return voeRedirect(html,base);
}
export function parsePelisflixVoe(html:string,base:string):Source {return parseVoe(html,base);}
