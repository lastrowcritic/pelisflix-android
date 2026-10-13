export const defaultMirror = 'https://pelisflix1.dog/';
export const mirrorHosts = ['pelisflix1.dog', 'pelisflix200.dog', 'pelisflix1.cfd', 'pelisflix200.bid', 'pelisflix200.biz', 'pelisflix200.watch', 'pelisflix1.app', 'pelisflix1.de', 'pelisflix1.pics', 'pelisflix200.best', 'pelisflix200.ceo', 'pelisflix200.homes'] as const;
export function sourceURL(raw:string,selected:string){return !!contentURL(raw,selected)||mirrorHosts.some(host=>!!contentURL(raw,`https://${host}/`));}
// Moves a catalogue link onto the mirror in use, keeping the stable path.
export function rebaseURL(raw:string,base:string){const url=new URL(raw,base);if(!sourceURL(url.href,base))throw new Error('This catalog link is outside the selected mirror.');url.host=new URL(base).host;return url.href;}
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
// Some titles link to nupload's iframe page, which only wraps a VOE player. The wrapped player is the real link.
export function playerURL(raw:string):string|undefined {
  const direct=trustedPlayerURL(raw);if(direct)return direct;
  try{const url=new URL(raw),inner=url.searchParams.get('url');
    if(url.protocol!=='https:'||!/^nupload\.m[ey]$/.test(url.hostname)||url.username||url.password||url.port||!/^\/iframe\/?$/.test(url.pathname)||!inner)return;
    return new URL(inner).hostname==='voe.sx'?trustedPlayerURL(inner):undefined;
  }catch{return;}
}
// VOE answers with a redirect to an embed page on a domain that changes often, so only the secure public address, the /e/ path and the file ID are checked.
export function voeEmbedURL(raw:string,id:string):string|undefined {
  try{const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!==`/e/${id}`)return;
    if(!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)||/\.(?:local|localhost|internal)$/i.test(url.hostname))return;
    return url.href;
  }catch{return;}
}

export function mediaURL(raw:string){try{const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/(^|\.)ibra\.lat$|(^|\.)nupload\.me$|(^|\.)voe\.sx$|(^|\.)cloudwindow-route\.com$/.test(url.hostname)?url.href:undefined;}catch{return;}}
