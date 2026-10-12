import { describe, it, expect } from 'vitest';
import { pivotOffset, rowNeighbor } from '../src/core/focus';
import { categoryArtworkAsset, categoryPaths, categorySlug, genreArtwork, uniqueCategories } from '../src/core/categories';
import { demoCategories } from '../src/core/demo';
import { ContentSource } from '../src/core/source';
import { loadState } from '../src/core/store';
describe('TV navigation boundaries',()=>{
  it('wraps within a shelf and preserves nonwrapping navigation boundaries',()=>{
    expect(rowNeighbor(['film-a','film-b','film-c'],'film-c','right')).toBe('film-a');
    expect(rowNeighbor(['film-a','film-b','film-c'],'film-a','left')).toBe('film-c');
    expect(rowNeighbor(['key-s','key-x'],'key-x','right',false)).toBeUndefined();
    expect(rowNeighbor(['home','settings'],'home','left',false)).toBeUndefined();
  });
  it('centres a section including its heading and prevents negative top scroll',()=>{
    expect(pivotOffset(800,400,1080,0)).toBe(460);
    expect(pivotOffset(0,400,1080,0)).toBe(0);
    expect(pivotOffset(-60,260,540,500)).toBe(300);
    expect(pivotOffset(800,400,1080,0,30)).toBe(490);
  });
});
describe('genres across content types',()=>{
  it('retains semantic genre across movies and series',()=>{
    expect(categoryPaths(demoCategories,'drama','films/')).toEqual(['films/drama/']);
    expect(categoryPaths(demoCategories,'drama','series/')).toEqual(['series/drama/']);
    expect(categoryPaths(demoCategories,'drama','')).toHaveLength(4);
    expect(uniqueCategories(demoCategories)).toHaveLength(10);
    expect(categorySlug('https://omnirezka.tv/series/fiction/')).toBe('fiction');
    expect(genreArtwork({name:'Фантастика',url:'films/fiction/'})).toBe('/artwork/categories/scifi.jpg');
  });
  it('uses the iOS category art mapping without repeating images',()=>{
    const slugs='action adult adventures anime arthouse biographical cognitive comedy concert crime detective documentary drama ecchi educational erotic everyday fairytale family fantasy fiction fighting foreign full-length historical horror kids kodomo mahoushoujo mecha melodrama military multseries musical mystery parody realtv romance russian samurai school short shoujo shoujoai shounen shounenai soyzmyltfilm sport standup telecasts theatre thriller travel ukrainian western'.split(' ');
    const assets=slugs.map(categoryArtworkAsset);
    expect(assets.every(Boolean)).toBe(true);
    expect(new Set(assets).size).toBe(slugs.length);
    expect(categoryArtworkAsset('anime')).toBe('animation');
    expect(categoryArtworkAsset('concert')).toBe('music');
    expect(categoryArtworkAsset('science-fiction')).toBe('scifi');
    expect(categoryArtworkAsset('adventure')).toBe('adventures');
    expect(categoryArtworkAsset('unknown-genre')).toBeUndefined();
  });
  it('filters actual preview titles by both kind and genre',async()=>{
    const source=new ContentSource({...loadState().settings,mode:'demo'});
    expect((await source.catalogue('series/drama/')).items.map(i=>i.title)).toEqual(['Northbound']);
    expect((await source.catalogue('films/drama/')).items).toEqual([]);
    expect((await source.catalogue('films/comedy/')).items.map(i=>i.title)).toEqual(['Life, Sideways']);
  });
});
