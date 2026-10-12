import type { ContentSource } from './source';
import type { Item, Selection, Source } from './types';
import { makeRecord, TV } from './native';

// Debug builds only. Exercise the same native requests, visible verification and
// Media3 playback as the user flow. Reports intentionally exclude signed URLs.
export async function auditLive(source:ContentSource) {
  const report={date:new Date().toISOString(),mirror:source.settings.mirror,status:'running',checks:{} as Record<string,unknown>,errors:[] as string[]};
  const save=()=>TV.saveTestReport({report:JSON.stringify(report,null,2)});
  const check=async<T>(name:string,run:()=>Promise<T>):Promise<T|undefined>=>{
    try{const result=await run();report.checks[name]=result;report.mirror=source.settings.mirror;await save();return result;}
    catch(error){report.errors.push(`${name}: ${error instanceof Error?error.message:String(error)}`);await save();}
  };
  const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
  await save();
  await check('catalogue',async()=>{const d=await source.catalogue();assert(d.items.length,'Empty catalogue');return {titles:d.items.length,categories:d.categories.length,firstTitle:d.items[0].title};});
  await check('genreFilters',async()=>{const home=await source.catalogue();const links=home.categories.filter(c=>/\/(films|series)\/drama\//.test(c.url));assert(links.some(c=>c.kind==='movie')&&links.some(c=>c.kind==='series'),'Drama links missing across content types');const pages=await Promise.all(links.map(c=>source.catalogue(c.url)));assert(pages.every(p=>p.items.length),'Genre filtering returned no titles');return pages.map((p,i)=>({kind:links[i].kind,titles:p.items.length,firstTitle:p.items[0].title}));});
  await check('pagination',async()=>{const d=await source.catalogue(undefined,2);assert(d.items.length,'Empty second page');return {titles:d.items.length,firstTitle:d.items[0].title};});
  await check('collections',async()=>{const d=await source.collections();assert(d.length,'Empty collections');return {count:d.length};});
  let film:Item|undefined,series:Item|undefined,filmSource:Source|undefined,seriesSource:Source|undefined,selection:Selection={},filmSelection:Selection={};
  await check('film',async()=>{
    const found=await source.search('Интерстеллар');assert(found.items.length,'Film search returned no titles');film=await source.details(found.items.find(i=>i.originalTitle==='Interstellar')||found.items.find(i=>i.year===2014)||found.items[0]);
    assert(film.translators?.some(t=>!t.premium),'No film translations');assert(film.synopsis,'Missing synopsis');
    filmSelection={translator:film.translators?.find(t=>!t.premium&&t.selected)?.id||film.translators?.find(t=>!t.premium)?.id};
    return {title:film.title,id:film.id,searchResults:found.items.length,translators:film.translators!.length,cast:film.actors?.length,ratings:film.ratings?.length};
  });
  await check('series',async()=>{
    const found=await source.search('Офис');assert(found.items.length,'Series search returned no titles');series=await source.details(found.items.find(i=>i.year===2005)||found.items.find(i=>i.kind==='series')||found.items[0]);assert(series.isSeries,'Title is not a series');
    const translator=series.translators?.find(t=>!t.premium&&t.selected)||series.translators?.find(t=>!t.premium);assert(translator,'No series translations');const seasons=await source.episodes(series,translator!.id);assert(seasons.some(s=>s.episodes.length),'No episodes');series={...series,seasons};const season=seasons.find(s=>s.episodes.length)!;selection={translator:translator!.id,season:season.id,episode:season.episodes[0].id};
    return {title:series.title,id:series.id,searchResults:found.items.length,translators:series.translators!.length,seasons:seasons.length,episodes:seasons.reduce((sum,s)=>sum+s.episodes.length,0)};
  });
  if(film){await check('comments',async()=>{const d=await source.comments(film!);return {count:d.comments.length,hasNext:d.hasNext};});if(film.actors?.[0])await check('person',async()=>{const d=await source.person(film!.actors![0].url);assert(d.filmography.length,'Empty filmography');return {name:d.name,titles:d.filmography.length,careers:d.careers.length};});
    await check('backgroundIMDb',async()=>{const result=await TV.rating({url:film!.page!});assert(result.rating&&result.rating===film!.rating,'IMDb background value differs from title metadata');return {title:film!.title,rating:result.rating};});
    await check('filmStreams',async()=>{filmSource=await source.playback(film!,filmSelection);assert(filmSource.streams.length,'No film streams');return {qualities:filmSource.streams.map(s=>s.quality),subtitles:filmSource.subtitles.length,alternatives:filmSource.streams.reduce((n,s)=>n+s.alternatives.length,0)};});}
  if(series)await check('seriesStreams',async()=>{seriesSource=await source.playback(series!,selection);assert(seriesSource.streams.length,'No series streams');return {qualities:seriesSource.streams.map(s=>s.quality),subtitles:seriesSource.subtitles.length};});
  const play=async(item:Item,selection:Selection,media:Source,position=0,quality='360p')=>{const result=await TV.play({source:media,record:makeRecord(item,selection,position),position,quality,testDurationSeconds:10});assert(!result.error,result.error||'Playback error');assert(result.position>position+2&&result.duration>0,`Playback did not advance. Position ${result.position}, duration ${result.duration}, start ${position}`);return {...result,quality};};
  if(film&&filmSource){const first=await check('nativeFilmPlayback',()=>play(film!,filmSelection,filmSource!));if(first)await check('nativeFilmResume',()=>play(film!,filmSelection,filmSource!,first.position,'1080p'));}
  if(series&&seriesSource)await check('nativeSeriesPlayback',()=>play(series!,selection,seriesSource!));
  await check('nativeOfflineDownload',async()=>{
    const item:Item={id:'audit-offline',title:'Playback test',kind:'movie',genre:'',synopsis:'',stream:'/preview.mp4'};
    await TV.download({id:item.id,item,selection:{},url:item.stream!,headers:{},state:'queued',progress:0});
    try{const deadline=Date.now()+20000;let downloaded;while(Date.now()<deadline){downloaded=(await TV.downloads()).items.find(r=>r.id===item.id);if(downloaded?.state==='completed'||downloaded?.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,300));}
      assert(downloaded?.state==='completed','Native download did not complete');const result=await play(item,{}, {streams:[{quality:'Original',url:downloaded!.url,alternatives:[]}],subtitles:[],headers:{}});assert(Math.round(result.duration)===30,'Unexpected offline duration');return {state:downloaded!.state,position:result.position,duration:result.duration};
    }finally{await TV.removeDownload({id:item.id});}
  });
  const journal=await TV.drainProgress();report.checks.progressJournal=journal.records.map(r=>({title:r.item.title,season:r.season,episode:r.episode,translator:r.translator,position:r.position,duration:r.duration}));
  report.status=report.errors.length?'failed':'passed';await save();return report;
}
