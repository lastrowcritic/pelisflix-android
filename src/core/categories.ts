import type { Link, Kind } from './types';
export const kinds = [['','All titles'],['films/','Films'],['series/','Series'],['cartoons/','Animation']] as const;
const kindRoots:Record<Kind,string>={movie:'films',series:'series',animation:'cartoons',anime:'animation'};
export function categorySlug(url:string){return url.replace(/^preview:genre:/,'').split(/[?#]/)[0].split('/').filter(Boolean).at(-1)||'';}
export function categoryRoot(url:string){return url.match(/(?:^|\/)(films|series|cartoons|animation)\//)?.[1]||'';}
export function uniqueCategories(links:Link[]){return links.filter((c,i,all)=>all.findIndex(n=>categorySlug(n.url)===categorySlug(c.url))===i);}
export function categoryPaths(links:Link[],genre:string,root:string){
  if(!genre)return [root];
  const matched=links.filter(c=>categorySlug(c.url)===genre&&(!root||categoryRoot(c.url)===root.replace('/','')));
  return [...new Set(matched.map(c=>c.url))];
}
const artworkByGenre:Record<string,string>={
  estrenos:'full-length',familiar:'family',familia:'family',otros:'foreign',
  accion:'action',aventura:'adventures','ciencia-ficcion':'scifi',comedia:'comedy',crimen:'crime',documental:'documentary',suspense:'thriller',terror:'horror',animacion:'animation',fantasia:'fantasy',action:'action',adult:'adult',adventure:'adventures',adventures:'adventures',anime:'animation',animation:'animation',arthouse:'arthouse',
  biographical:'biographical',cognitive:'cognitive',comedy:'comedy',concert:'music',crime:'crime','science-fiction':'scifi',
  detective:'detective',documentary:'documentary',drama:'drama',ecchi:'ecchi',educational:'educational',
  erotic:'erotic',everyday:'everyday',fairytale:'fairytale',family:'family',fantasy:'fantasy',fiction:'scifi',
  fighting:'fighting',foreign:'foreign','full-length':'full-length',historical:'historical',horror:'horror',
  kids:'kids',kodomo:'kodomo',mahoushoujo:'mahoushoujo',mecha:'mecha',melodrama:'melodrama',military:'military',
  multseries:'multseries',musical:'musical',mystery:'mystery',parody:'parody',realtv:'realtv',romance:'romance',
  russian:'russian',samurai:'samurai',school:'school',short:'short',shoujo:'shoujo',shoujoai:'shoujoai',
  shounen:'shounen',shounenai:'shounenai',soyzmyltfilm:'soyzmyltfilm',sport:'sport',standup:'standup',
  telecasts:'telecasts',theatre:'theatre',thriller:'thriller',travel:'travel',ukrainian:'ukrainian',western:'western'
};
export function categoryArtworkAsset(slug:string){return artworkByGenre[slug];}
export function genreArtwork(link:Link){
  const asset=categoryArtworkAsset(categorySlug(link.url));
  return asset?`/artwork/categories/${asset}.jpg`:undefined;
}
export function previewCategoryLinks(names:string[]):(Link&{kind:Kind})[]{return names.flatMap(name=>Object.entries(kindRoots).map(([kind,root])=>({name,kind:kind as Kind,url:`${root}/${name.toLowerCase().replaceAll(' ','-')}/`})))}
