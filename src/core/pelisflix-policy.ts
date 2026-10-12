export const defaultMirror = 'https://pelisflix1.dog/';
export const mirrorHosts = ['pelisflix1.dog', 'pelisflix200.dog', 'pelisflix1.cfd', 'pelisflix200.bid', 'pelisflix200.biz', 'pelisflix200.watch', 'pelisflix1.app', 'pelisflix1.de', 'pelisflix1.pics', 'pelisflix200.best', 'pelisflix200.ceo', 'pelisflix200.homes'] as const;
export function sourceURL(raw:string,selected:string){return !!contentURL(raw,selected)||mirrorHosts.some(host=>!!contentURL(raw,`https://${host}/`));}
const playerHosts = new Set(['nupload.my','nupload.me','voe.sx']);
export function contentURL(raw:string|undefined,base:string):string|undefined {
  if(!raw)return;
  try { const url=new URL(raw,base),origin=new URL(base);
    if(url.protocol!=='https:'||url.hostname!==origin.hostname||url.username||url.password||url.port)return;
    return url.href;
  }catch{return;}
}
export function trustedPlayerURL(raw:string):string|undefined {
  try{const url=new URL(raw);return url.protocol==='https:'&&playerHosts.has(url.hostname)&&!url.username&&!url.password&&!url.port&&/^\/(?:watch|e)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)?url.href:undefined;}catch{return;}
}

export function mediaURL(raw:string){try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/(^|\.)ibra\.lat$|(^|\.)nupload\.me$|(^|\.)voe\.sx$/.test(url.hostname)?url.href:undefined;}catch{return;}}
