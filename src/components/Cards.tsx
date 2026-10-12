import { IMDbBadge } from './Ratings';
import type { Item, WatchRecord } from '../core/types';
import { clock } from '../core/store';
export function Card({item,id,onOpen,record,poster=true,rank}:{item:Item;id:string;onOpen:()=>void;record?:WatchRecord;poster?:boolean;rank?:number}) {
  return <button className={`media-card ${poster?'portrait':''}`} data-focus-id={id} onClick={onOpen} aria-label={record?`Continue ${item.title} at ${clock(record.position)}`:item.title}>
    <div className="card-art">{item.poster?<img src={item.poster} loading="lazy" decoding="async" fetchPriority="low" alt="" onError={e=>{e.currentTarget.style.display='none';}}/>:<div className="art-fallback">{item.title.charAt(0)}</div>}
      <IMDbBadge item={item}/>
      {rank&&<span className="card-rank">{rank}</span>}
      {record&&<div className="watch-progress"><span style={{width:`${record.duration>0?Math.min(100,record.position/record.duration*100):0}%`}}/></div>}
    </div>
    <div className="card-copy"><strong>{item.title}</strong><span>{record?`${record.season?`Season ${record.season}, episode ${record.episode}. `:''}${record.duration>0?`${Math.ceil(Math.max(0,record.duration-record.position)/60)} min remaining`:`Continue at ${clock(record.position)}`}`:[item.year,item.genre.split(',')[0]].filter(Boolean).join('  ')}</span></div>
  </button>;
}
export function Row({title,caption,items,onOpen,records,poster=true,prefix,ranked=false}:{title:string;caption?:string;items:Item[];onOpen:(item:Item)=>void;records?:WatchRecord[];poster?:boolean;prefix:string;ranked?:boolean}) {
  if(!items.length)return null;
  return <section className="shelf" data-focus-context="true" data-focus-scroll-bias="36"><div className="shelf-title"><h2>{title}</h2>{caption&&<p>{caption}</p>}</div><div className="shelf-track" data-focus-group={prefix} data-focus-axis="row">{items.map((item,i)=><Card key={item.id} item={item} id={`${prefix}-${item.id}`} onOpen={()=>onOpen(item)} poster={poster} rank={ranked?i+1:undefined} record={records?.find(r=>r.item.id===item.id)}/>)}</div></section>;
}
