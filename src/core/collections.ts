import type { Collection } from './types';
export type CollectionSort='count'|'newest'|'name';
export const collectionSorts=[{id:'count',name:'Most titles'},{id:'newest',name:'Newest'},{id:'name',name:'A to Z'}] as const;
export function collectionCount(value:string){return Number(value.replace(/[^0-9]/g,''))||0;}
export function collectionLabel(value:string){if(!value.trim())return '';const count=collectionCount(value);return `${count.toLocaleString()} ${count===1?'title':'titles'}`;}
export function sortCollections(items:Collection[],order:CollectionSort){
  const sorted=[...items];
  if(order==='count')sorted.sort((a,b)=>collectionCount(b.count)-collectionCount(a.count)||a.name.localeCompare(b.name,'es'));
  if(order==='name')sorted.sort((a,b)=>a.name.localeCompare(b.name,'es'));
  return sorted;
}
export function loadCollectionSort():CollectionSort{try{const value=localStorage.getItem('pelisflix.collections.sort');if(value==='newest'||value==='name')return value;}catch{}return 'count';}
