import * as cheerio from 'cheerio';
import { isChallenge, VerificationRequired } from './challenge';
import { countryCodes } from './countries';
import type { Catalogue, Comment, Item, Kind, Link, Person, Season } from './types';
export { isChallenge, VerificationRequired } from './challenge';
export { countryCodes } from './countries';
function document(html: string, base: string) {
  if (isChallenge(html)) throw new VerificationRequired(base);
  return cheerio.load(html);
}
export function resolve(raw: string | undefined, base: string): string | undefined {
  if (!raw || raw.startsWith('data:')) return;
  try { const url = new URL(raw,base); return ['https:','http:'].includes(url.protocol)?url.href:undefined; } catch { return; }
}
export function kindFor(url: string): Kind {
  const path = new URL(url).pathname;
  return path.includes('/cartoons/')?'animation':path.includes('/animation/') || path.includes('/anime/')?'anime':path.includes('/series/')?'series':'movie';
}
function image($: cheerio.CheerioAPI, node: ReturnType<cheerio.CheerioAPI>, base: string) {
  const img = node.is('img,meta')?node:node.find('img').first();
  const srcset = img.attr('data-srcset') || img.attr('srcset');
  if(srcset) {
    const best = srcset.split(',').map(s=>s.trim().split(/\s+/)).sort((a,b)=>(parseFloat(b[1])||1)*(b[1]?.endsWith('x')?1000:1)-(parseFloat(a[1])||1)*(a[1]?.endsWith('x')?1000:1))[0];
    const result = resolve(best[0],base); if(result) return result;
  }
  for(const attr of ['data-original','data-lazy-src','data-src','src','content']) { const url=resolve(img.attr(attr),base);if(url)return url; }
}
function links($: cheerio.CheerioAPI, selector: string, base: string): Link[] {
  const seen=new Set<string>();
  return $(selector).toArray().flatMap(n=>{ const a=$(n);const url=resolve(a.attr('href'),base);if(!url||seen.has(url))return [];seen.add(url);return [{name:a.text().trim(),url,image:image($,a,base)}]; });
}
function people($:cheerio.CheerioAPI,role:string,base:string):Link[] {
  const seen=new Set<string>();return $(`[itemprop=${role}]`).toArray().flatMap(n=>{
    const node=$(n),a=node.is('a')?node:node.find('a').first(),url=resolve(a.attr('href'),base);
    if(!url||seen.has(url))return [];seen.add(url);
    return [{name:node.find('[itemprop=name]').first().text().trim()||a.text().trim(),url,image:resolve(node.attr('data-photo'),base)||image($,node,base)}];
  });
}
export function parseCatalogue(html: string, base: string, page=1): Catalogue {
  const $=document(html,base), seen=new Set<string>();
  const items = $('.b-content__inline_item').toArray().flatMap(node=>{
    const card=$(node),anchor=card.find('.b-content__inline_item-link a').first();
    const title=anchor.text().trim(), url=resolve(card.attr('data-url')||anchor.attr('href'),base);
    if(!title||!url) return [];
    const id=card.attr('data-id')||new URL(url).pathname.match(/(?:^|\/)(\d+)-/)?.[1];
    if(!id||seen.has(id)) return [];seen.add(id);
    const info=card.find('.b-content__inline_item-link div').text().trim();
    const countries=countryCodes(info);
    return [{id,title,kind:kindFor(url),year:Number(info.match(/\b((?:19|20)\d{2})\b/)?.[1])||undefined,genre:info.split(',').slice(2).join(',').trim()||info,synopsis:'',poster:image($,card,base),page:url,countries:countries.length?countries:undefined,isSeries:kindFor(url)==='series'} satisfies Item];
  });
  const paths=new Set<string>();
  const categories=links($,'a[href]',base).flatMap(link=>{
    const path=new URL(link.url).pathname;
    if(!/^\/(films|series|cartoons|animation)\/[a-z-]+\/?$/.test(path)||path.includes('/best')||!link.name||paths.has(path))return [];
    paths.add(path);return [{...link,kind:kindFor(link.url)}];
  });
  const hasNext=$('.b-navigation a').toArray().some(n=> Number($(n).text())>page||($(n).attr('href')||'').includes(`/page/${page+1}/`)||($(n).attr('href')||'').includes(`page=${page+1}`));
  return {items,hasNext,categories};
}
export function parseSeasons(seasonsHTML: string, episodesHTML=seasonsHTML): Season[] {
  const $=cheerio.load(seasonsHTML), e$=cheerio.load(episodesHTML);
  const seasons: Season[]=$('.b-simple_season__item').toArray().flatMap(n=>$(n).attr('data-tab_id')?[{id:$(n).attr('data-tab_id')!,title:$(n).text().trim(),episodes:[]}]:[]);
  for(const n of e$('.b-simple_episode__item').toArray()) {
    const node=e$(n), id=node.attr('data-episode_id');if(!id)continue;
    const season=node.attr('data-season_id')||node.parents('[id^="simple-episodes-list-"]').first().attr('id')?.replace('simple-episodes-list-','')||(seasons.length===1?seasons[0].id:undefined);
    if(!season)continue;
    if(!seasons.some(s=>s.id===season))seasons.push({id:season,title:`Season ${season}`,episodes:[]});
    const target=seasons.find(s=>s.id===season)!;
    if(!target.episodes.some(e=>e.id===id))target.episodes.push({id,title:node.text().trim(),season});
  }
  return seasons;
}
export function parseDetails(html: string, base: string, item: Item): Item {
  const $=document(html,base), text=(s:string)=>$(s).first().text().trim();
  const title=text('.b-post__title [itemprop=name]');if(!title)throw new Error('The title page could not be read. Try another mirror.');
  const information: Record<string,string>={};
  $('table.b-post__info tr').each((_,n)=>{const row=$(n),label=(row.find('td.l h2').text()||row.find('td.l').text()).trim().replace(/[: ]+$/,'');const value=row.find('td:not(.l)').text().trim();if(label&&value)information[label]=value;});
  const args=html.match(/initCDN(?:Movies|Series)Events\((.*?)\);/s)?.[1].split(',').map(s=>s.trim())||[];
  const initial=args[1]?.match(/^\d+$/)?.[0];
  const translators=$('.b-translator__item').toArray().flatMap(n=>{const node=$(n),id=node.attr('data-translator_id');return id?[{id,name:node.text().trim()||'Original translation',selected:node.hasClass('active')||id===initial,premium:node.hasClass('b-prem_translator')}]:[];});
  if(!translators.length&&initial)translators.push({id:initial,name:'Original translation',selected:true,premium:false});
  const genres=$('[itemprop=genre]').toArray().map(n=>$(n).text().trim());
  const countries=countryCodes(information['Страна']||'');
  const ratings=['imdb','kp'].flatMap(name=>{const node=$(`.b-post__info_rates.${name}`),value=node.find('.bold').first().text().trim();return value?[{name:name==='imdb'?'IMDb':'Kinopoisk',value,url:resolve(node.find('a').attr('href'),base)}]:[];});
  return {...item,title,originalTitle:text('.b-post__origtitle')||undefined,synopsis:text('.b-post__description_text'),poster:resolve($('.b-sidecover a[data-imagelightbox=cover]').attr('href'),base)||image($,$('.b-sidecover'),base)||item.poster,page:base,
    year:Number(information['Дата выхода']?.match(/\b((?:19|20)\d{2})\b/)?.[1])||item.year,
    duration:Number(information['Время']?.match(/\d+/)?.[0])||item.duration,
    genre:genres.join(', ')||item.genre,rating:text('.b-post__info_rates.imdb .bold')||undefined,
    countries:countries.length?countries:item.countries,translators,seasons:parseSeasons(html),isSeries:html.includes('initCDNSeriesEvents')||$('.b-simple_season__item').length>0,
    rezkaID:args[0]?.match(/^\d+$/)?.[0]||item.id,ratings,
    actors:people($,'actor',base),directors:people($,'director',base),collections:links($,'tr td a[href*="/collections/"]',base),rankings:links($,'tr td a[href*="/best/"]',base),information,
    franchiseTitle:text('.b-post__franchise_link_title'),franchise:$('.b-post__partcontent_item').toArray().flatMap(n=>{const row=$(n),a=row.find('.td.title a').first(),url=resolve(a.attr('href'),base);return url?[{name:a.text().trim(),url,year:row.find('.td.year').text().trim(),rating:row.find('.td.rating i').text().trim()}]:[];}),schedule:$('.b-post__schedule_block').toArray().map(n=>({title:$(n).find('.b-post__schedule_block_title .title').text().trim(),rows:$(n).find('table.b-post__schedule_table tbody tr').toArray().map(r=>({episode:$(r).find('.td-1').text().trim(),title:$(r).find('.td-2 b').text().trim(),date:$(r).find('.td-4').text().trim()}))}))};
}
export function parseCollections(html: string, base: string) {
  const $=document(html,base);
  return $('.b-content__collections_item').toArray().flatMap(n=>{const card=$(n),url=resolve(card.attr('data-url')||card.find('a').attr('href'),base);return url?[{name:card.find('.title').text().trim(),url,image:image($,card,base),count:card.find('.num').text().trim()}]:[];});
}
export function parseCollectionPage(html:string,base:string,page=1){
  const $=document(html,base);
  const hasNext=$('.b-navigation a[href]').toArray().some(node=>{const href=$(node).attr('href')||'',number=Number(href.match(/\/page\/(\d+)/)?.[1]||new URL(href,base).searchParams.get('page'));return number>page;});
  return {items:parseCollections(html,base),hasNext};
}
export function parseComments(html: string, base: string): {comments: Comment[]; hasNext: boolean} {
  const $=document(html,base),seen=new Set<string>();
  const parents:{id:string;indent:number}[]=[];
  return {comments:$('.b-comment, li.comments-tree-item, div[id^="comment-id-"]').toArray().flatMap(n=>{
    const node=$(n),message=node.find('.message').first();if(!message.length)return [];
    const id=node.attr('data-id')||node.find('div[id^="comment-id-"]').attr('id')?.replace('comment-id-','')||node.attr('id')?.replace('comment-id-','');
    if(!id||seen.has(id))return [];seen.add(id);
    const indent=Number(node.attr('data-indent'))||0;while(parents.length&&parents[parents.length-1].indent>=indent)parents.pop();const parentID=parents[parents.length-1]?.id;parents.push({id,indent});
    return [{id,author:message.find('.info .name').text().trim(),date:message.find('.info .date').text().trim(),text:message.find('.text div[id^="comm-id-"]').text().trim()||message.find('.text').text().trim(),likes:node.find('.b-comment__likes_count i').text().trim(),indent,parentID,avatar:image($,node.find('.ava'),base)}];
  }),hasNext:$('.b-navigation a').length>0};
}
export function parsePerson(html: string, base: string): Person {
  const $=document(html,base),name=$('.b-post__title [itemprop=name]').text().trim();
  if(!name)throw new Error('This person page could not be read.');
  return {name,originalName:$('.b-post__title [itemprop=alternativeHeadline]').text().trim(),image:image($,$('.b-post__infotable_left [itemprop=image]'),base),birthDate:$('[itemprop=birthDate]').text().trim(),jobs:$('[itemprop=jobTitle]').toArray().map(n=>$(n).text().trim()),filmography:parseCatalogue(html,base).items,careers:links($,'.b-person__career a',base).filter(link=>new URL(link.url).pathname.startsWith('/person/'))};
}
