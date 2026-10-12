import { describe, expect, it } from 'vitest';
import { decode, parseStreams, parseSubtitles } from '../src/core/decoder';
import { countryCodes, parseCatalogue, parseComments, parseDetails, parseSeasons, VerificationRequired } from '../src/core/parser';
import { catalogueURL, ContentSource, normalizeMirror } from '../src/core/source';
import { chooseTarget } from '../src/core/focus';
import { continueWatching, defaults, latestWatchRecord, loadState, nextEpisode, recordProgress, resumePosition, saveState } from '../src/core/store';
import type { Item } from '../src/core/types';
const film:Item={id:'42',title:'A film',kind:'movie',genre:'Drama',synopsis:''};
const series:Item={...film,id:'7',kind:'series',isSeries:true,seasons:[{id:'1',title:'Season 1',episodes:[{id:'1',season:'1',title:'One'},{id:'2',season:'1',title:'Two'}]},{id:'2',title:'Season 2',episodes:[{id:'1',season:'2',title:'Three'}]}]};
describe('persistent playback history',()=>{
  it('restores the precise second, season, episode and translation after app recreation',()=>{
    const memory=new Map<string,string>(),storage={getItem:(key:string)=>memory.get(key)||null,setItem:(key:string,value:string)=>{memory.set(key,value);}};
    const selection={season:'1',episode:'2',translator:'99'};
    saveState({...structuredClone(defaults),history:recordProgress([],series,selection,1473.5,2800),audioChoices:{[series.id]:'99',[film.id]:'88'}},storage);
    const restored=loadState(storage);expect(resumePosition(restored.history,series,selection)).toBe(1473.5);expect(restored.history[0].translator).toBe('99');expect(restored.audioChoices).toEqual({[series.id]:'99',[film.id]:'88'});
  });
  it('chooses the newest episode by timestamp even when restored records are unordered',()=>{
    const older={...recordProgress([],series,{season:'1',episode:'2',translator:'4'},400,3000)[0],updatedAt:100};
    const newest={...recordProgress([],series,{season:'2',episode:'1',translator:'7'},2040,3300)[0],updatedAt:200};
    expect(latestWatchRecord([newest,older],series)).toBe(newest);
    expect(resumePosition([newest,older],series,{season:newest.season,episode:newest.episode})).toBe(2040);
  });
  it('keeps each episode independent and never resumes a different episode',()=>{
    let history=recordProgress([],series,{season:'1',episode:'1'},67,120);
    history=recordProgress(history,series,{season:'1',episode:'2'},35,120);
    expect(resumePosition(history,series,{season:'1',episode:'1'})).toBe(67);expect(resumePosition(history,series,{season:'2',episode:'1'})).toBe(0);
  });
  it('preserves known duration when a background checkpoint has unknown duration',()=>{
    const initial=recordProgress([],film,{},90,300);
    const updated=recordProgress(initial,film,{},95,NaN);
    expect(updated[0].duration).toBe(300);expect(recordProgress(updated,film,{},NaN,300)).toBe(updated);
  });
  it('removes completed titles from continue watching while keeping episode history',()=>{
    const records=recordProgress([],film,{},120,120);expect(continueWatching(records)).toEqual([]);expect(records).toHaveLength(1);expect(resumePosition(records,film,{})).toBe(0);
  });
  it('advances across season boundaries and stops after the last episode',()=>{
    expect(nextEpisode(series,{season:'1',episode:'2',translator:'5'})).toEqual({season:'2',episode:'1',translator:'5'});expect(nextEpisode(series,{season:'2',episode:'1'})).toBeUndefined();
  });
  it('only shows the most recent episode for a series and retains progress after a translation change',()=>{
    let history=recordProgress([],series,{season:'1',episode:'1',translator:'1'},40,100);history=recordProgress(history,series,{season:'1',episode:'2',translator:'1'},20,100);expect(continueWatching(history)).toHaveLength(1);expect(resumePosition(history,series,{season:'1',episode:'1',translator:'2'})).toBe(40);
  });
  it('migrates existing state without audio preferences and validates saved choices',()=>{
    const old=JSON.stringify({settings:{mode:'live'},favorites:[],history:[],custom:[]});
    expect(loadState({getItem:()=>old}).audioChoices).toEqual({});
    const malformed=JSON.stringify({audioChoices:{good:'5',bad:4,empty:''}});
    expect(loadState({getItem:()=>malformed}).audioChoices).toEqual({good:'5'});
  });
  it('recovers safely from corrupt storage',()=>{expect(loadState({getItem:()=>'{bad'})).toEqual(defaults);});
});
describe('Rezka parity',()=>{
  it('decodes encoded noise and rejects premium qualities while keeping alternate CDNs',()=>{
    const plain='[720p]https://cdn.example/one.mp4 or https://other.example/one.mp4,[1080p]https://cdn.example/two.mp4,[<span class="pjs-prem-quality">4K</span>]https://cdn.example/premium';
    const encoded='#h'+btoa(plain).slice(0,10)+'//_//'+btoa('@#!')+btoa(plain).slice(10);
    expect(decode(encoded)).toBe(plain);const streams=parseStreams(encoded);expect(streams.map(s=>s.quality)).toEqual(['1080p','720p']);expect(streams[1].alternatives).toEqual(['https://other.example/one.mp4']);
  });
  it('accepts missing base64 padding and extensionless media URLs',()=>{expect(parseStreams('#h'+btoa('[720p]https://cdn.example/stream').replace(/=+$/,''))[0].url).toBe('https://cdn.example/stream');});
  it('maps external subtitles',()=>{expect(parseSubtitles('[English]https://cdn.example/en.vtt',{English:'en'})).toEqual([{label:'English',language:'en',url:'https://cdn.example/en.vtt'}]);});
  it('uses path segments for catalogue pagination',()=>{expect(catalogueURL('https://rezka.example/films/drama/?filter=old',3,'popular')).toBe('https://rezka.example/films/drama/page/3/');expect(catalogueURL('https://rezka.example/',2)).toBe('https://rezka.example/page/2/');});
  it('normalizes secure mirror domains and rejects credentials and ports',()=>{expect(normalizeMirror(' Rezka.Example ')).toBe('https://rezka.example/');expect(()=>normalizeMirror('http://rezka.example')).toThrow();expect(()=>normalizeMirror('https://user:pass@rezka.example')).toThrow();});
  it('normalizes country names and co-productions',()=>{expect(countryCodes('2026, США, Россия, Драма')).toEqual(['US','RU']);expect(countryCodes('Великобритания / USA / СССР')).toEqual(['GB','US','SU']);});
  it('parses cards, lazy artwork, genre links and pagination',()=>{
    const html='<a href="/films/drama/">Драма</a><div class="b-content__inline_item" data-id="42" data-url="/films/42-a.html"><img src="tiny.jpg" data-srcset="small.jpg 300w, large.jpg 900w"><div class="b-content__inline_item-link"><a>A film</a><div>2025, США, Драма</div></div></div><div class="b-navigation"><a href="/page/2/">2</a></div>';
    const data=parseCatalogue(html,'https://rezka.example/');expect(data.items[0].poster).toBe('https://rezka.example/large.jpg');expect(data.items[0].countries).toEqual(['US']);expect(data.hasNext).toBe(true);expect(data.categories[0].name).toBe('Драма');
  });
  it('discovers translations and hides premium entries from playback eligibility',()=>{
    const html='<div class="b-post__title"><span itemprop="name">A series</span></div><ul><li class="b-translator__item active" data-translator_id="5">Original</li><li class="b-translator__item b-prem_translator" data-translator_id="9">Premium</li></ul><script>initCDNSeriesEvents(7,5);</script><ul><li class="b-simple_season__item" data-tab_id="1">One</li></ul><ul id="simple-episodes-list-1"><li class="b-simple_episode__item" data-episode_id="2">Two</li></ul>';
    const item=parseDetails(html,'https://rezka.example/series/7-a.html',series);expect(item.isSeries).toBe(true);expect(item.translators?.filter(t=>!t.premium).map(t=>t.id)).toEqual(['5']);expect(item.seasons?.[0].episodes[0].season).toBe('1');
  });
  it('finds a fallback translation in player initialization',()=>{expect(parseDetails('<div class="b-post__title"><span itemprop="name">A film</span></div><script>initCDNMoviesEvents(42,5);</script>','https://rezka.example/films/42-a.html',film).translators?.[0].id).toBe('5');});
  it('detects verification without treating it as an empty catalogue',()=>{expect(()=>parseCatalogue('<html>anubis_challenge</html>','https://rezka.example')).toThrow(VerificationRequired);});
  it('parses episodes across separate fragments without duplicates',()=>{expect(parseSeasons('<li class="b-simple_season__item" data-tab_id="2">Two</li>','<li class="b-simple_episode__item" data-season_id="2" data-episode_id="4">Four</li>')[0].episodes[0]).toEqual({id:'4',season:'2',title:'Four'});});
  it('parses nested comment wrappers once',()=>{const html='<li class="comments-tree-item" data-id="9"><div id="comment-id-9"><div class="message"><div class="info"><span class="name">Ada</span><span class="date">Today</span></div><div class="text">Good story</div></div></div></li>';expect(parseComments(html,'https://rezka.example').comments).toHaveLength(1);});

});
describe('directional remote focus',()=>{
  const current={id:'current',left:200,top:200,width:200,height:100};
  it('prefers the same shelf when moving sideways',()=>{expect(chooseTarget(current,[current,{id:'next',left:450,top:200,width:200,height:100},{id:'diagonal',left:410,top:40,width:200,height:100}],'right')).toBe('next');});
  it('moves down to the nearest aligned shelf',()=>{expect(chooseTarget(current,[current,{id:'below',left:200,top:350,width:200,height:100},{id:'far',left:800,top:350,width:200,height:100}],'down')).toBe('below');});
  it('does not wrap into the opposite direction at a row boundary',()=>{expect(chooseTarget(current,[current,{id:'left',left:0,top:200,width:100,height:100}],'right')).toBeUndefined();});
});
