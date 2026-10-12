import type { Item } from './types';
import { previewCategoryLinks } from './categories';
const film = (id:string,title:string,genre:string,art:string,year:number,kind:Item['kind']='movie'): Item => ({
  id:`preview-${id}`,title,kind,year,genre,synopsis:'A story worth getting lost in. Explore the picture, choose your episode, and settle in for the evening.',poster:`/artwork/${art}.jpg`,backdrop:`/artwork/${art}.jpg`,stream:'/preview.mp4',duration:110,countries:['US'],rating:'8.2',
  translators:[{id:'original',name:'Original audio',selected:true,premium:false}],isSeries:kind==='series',
  seasons:kind==='series'?[{id:'1',title:'Season 1',episodes:[{id:'1',season:'1',title:'The arrival'},{id:'2',season:'1',title:'A different sky'}]},{id:'2',title:'Season 2',episodes:[{id:'1',season:'2',title:'The way home'}]}]:[],
});
export const demoItems: Item[] = [
  {...film('meridian','Meridian','Science fiction','scifi',2026,'series'),synopsis:'Beyond the edge of the familiar, a lone astronaut discovers that the greatest journey is the one that brings us home.'},
  film('northbound','Northbound','Drama','drama',2025,'series'),film('after-hours','After Hours','Crime','crime',2026),film('last-light','The Last Light','Adventure','fantasy',2025),film('wild','A Wilder World','Documentary','documentary',2026),film('glass','Glass Houses','Thriller','arthouse',2025,'series'),film('sunday','Sunday Kind of Love','Romance','romance',2026),film('sideways','Life, Sideways','Comedy','comedy',2025),film('orbit','Little Orbit','Animation','animation',2026,'animation'),film('still','Still Water','Horror','horror',2025),film('west','Way Out West','Western','western',2026),film('home','The Long Way Home','Family','family',2025)
];
export const demoCategories = previewCategoryLinks(['Drama','Comedy','Science fiction','Crime','Documentary','Romance','Animation','Horror','Adventure','Family']);
