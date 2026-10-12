import { describe, expect, it } from 'vitest';
import { parseStreams } from '../src/core/decoder';
import { parseComments, parseDetails, parsePerson } from '../src/core/parser';
import { ContentSource } from '../src/core/source';
import { defaults } from '../src/core/store';
import type { Item } from '../src/core/types';
const film:Item={id:'42',title:'Film',genre:'',synopsis:'',kind:'movie'};
describe('iOS parser parity',()=>{
  it('accepts the sanitized MP4 response captured on the iPhone',()=>{
    const response='[360p]https://stream.voidboost.one/session/1/5/4/bg8gs.mp4,[480p]https://stream.voidboost.one/session/1/5/4/jbfw8.mp4,[720p]https://stream.voidboost.one/session/1/5/4/p63wn.mp4,[1080p]https://stream.voidboost.one/session/1/5/4/u4564.mp4,[<span class="pjs-prem-quality">4K<img src="https://static.hdrezka.ac/prem-icon.svg" alt=""></span>]https://stream.voidboost.one/session/premium.mp4';
    const streams=parseStreams(response);expect(streams.map(s=>s.quality)).toEqual(['1080p','720p','480p','360p']);expect(streams.every(s=>new URL(s.url).pathname.endsWith('.mp4'))).toBe(true);
  });
  it('preserves original artwork, cast photos, both ratings and the player movie ID',()=>{
    const html='<div class="b-post__title"><h1 itemprop="name">A film</h1></div><div class="b-sidecover"><a data-imagelightbox="cover" href="/original.jpg"><img src="/thumbnail.jpg"></a></div><span itemprop="actor" data-photo="/actor.jpg"><a href="/person/1"><span itemprop="name">A Person</span> extra text</a></span><div class="b-post__info_rates imdb"><b class="bold">8.1</b><a href="https://imdb.com/title/tt123/">IMDb</a></div><div class="b-post__info_rates kp"><b class="bold">7.9</b></div><script>initCDNMoviesEvents(99,7,0);</script>';
    const item=parseDetails(html,'https://rezka.example/films/42-title.html',film);expect(item.poster).toBe('https://rezka.example/original.jpg');expect(item.actors?.[0]).toMatchObject({name:'A Person',image:'https://rezka.example/actor.jpg'});expect(item.ratings?.map(r=>r.value)).toEqual(['8.1','7.9']);expect(item.rezkaID).toBe('99');
  });
  it('preserves franchise metadata, release schedules and person career links',()=>{
    const html='<div class="b-post__title"><h1 itemprop="name">A film</h1></div><div class="b-post__franchise_link_title">All films</div><div class="b-post__partcontent_item"><div class="td title"><a href="/films/43-next.html">Next</a></div><div class="td year">2025</div><div class="td rating"><i>8.2</i></div></div><div class="b-post__schedule_block"><div class="b-post__schedule_block_title"><span class="title">Season one</span></div><table class="b-post__schedule_table"><tbody><tr><td class="td-1">1 season 2 episode</td><td class="td-2"><b>Arrival</b></td><td class="td-4">9 October 2026</td></tr></tbody></table></div>';
    const item=parseDetails(html,'https://rezka.example',film);expect(item.franchiseTitle).toBe('All films');expect(item.franchise?.[0]).toMatchObject({name:'Next',year:'2025',rating:'8.2'});expect(item.schedule?.[0].rows[0].title).toBe('Arrival');
    const person=parsePerson('<div class="b-post__title"><span itemprop="name">A Person</span></div><div class="b-person__career"><a href="/person/1/?filter=actor">Actor</a><a href="/films/42-title.html">A film</a></div>','https://rezka.example');expect(person.careers[0].name).toBe('Actor');expect(person.careers).toHaveLength(1);
  });
  it('preserves threaded comment relationships and avatars',()=>{
    const comment=(id:string,indent:number)=>`<li class="comments-tree-item" data-id="${id}" data-indent="${indent}"><div id="comment-id-${id}"><div class="ava"><img src="/avatar.jpg"></div><div class="message"><div class="info"><span class="name">Ada</span></div><div class="text">A comment</div></div></div></li>`;
    const result=parseComments(comment('10',0)+comment('11',1),'https://rezka.example');expect(result.comments[1].parentID).toBe('10');expect(result.comments[0].avatar).toBe('https://rezka.example/avatar.jpg');
  });

});
