export type DeviceLayout = 'tv' | 'touch';
// Native device identity wins over resolution and input hints. A TV can expose
// a touch-capable WebView or the same CSS width as a tablet.
export function deviceLayout(userAgent:string,coarsePointer=false,touchPoints=0):DeviceLayout {
  if(userAgent.includes('RezkaDeviceTV'))return 'tv';
  if(userAgent.includes('RezkaDeviceTouch'))return 'touch';
  if(/Android.*(?:TV|AFT)|GoogleTV|SmartTV|HbbTV/i.test(userAgent))return 'tv';
  return /Android|iPhone|iPad|iPod/i.test(userAgent)||coarsePointer&&touchPoints>0?'touch':'tv';
}
export const isTouch=deviceLayout(navigator.userAgent,window.matchMedia?.('(pointer: coarse)').matches,navigator.maxTouchPoints)==='touch';
document.documentElement.dataset.device=isTouch?'touch':'tv';
if(navigator.userAgent.includes('RezkaDeviceTV'))document.querySelector('meta[name="viewport"]')?.setAttribute('content','width=1920, user-scalable=no');
