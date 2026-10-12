import {mirrorHosts} from './pelisflix-policy';
import { isChallenge, VerificationRequired } from './challenge';

export const mirrorConfiguration='';
const bundled=mirrorHosts;
export function normalizeMirror(raw:string):string {
  const value=raw.trim(),url=new URL(value.includes('://')?value:`https://${value}`);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.'))throw new Error('Enter a valid secure mirror domain.');
  return `${url.origin}/`;
}
export class HTTPFailure extends Error {
  constructor(public status:number){super(`The content source returned error ${status}. Try another mirror.`);}
}
export class InvalidCatalogue extends Error {}
export function canFailOver(error:unknown) {
  if(error instanceof VerificationRequired || error instanceof SyntaxError)return false;
  if(error instanceof HTTPFailure)return error.status!==404&&error.status!==429;
  return error instanceof InvalidCatalogue || error instanceof Error&&/fetch|network|timeout|timed out|connect|could not be reached/i.test(error.message);
}
type Response={text:string;url:string;status:number};
type Request=(url:string,form?:Record<string,string>,referer?:string,timeout?:number)=>Promise<Response>;
export class MirrorManager {
  private configuration?:Promise<string[]>;
  private selection?:Promise<string>;
  constructor(private request:Request,private saved:()=>string,private select:(url:string)=>void){}
  private hosts() {
    return this.configuration ||= (async()=>{
      const hosts:string[]=[];
      return [...new Set([this.saved(),bundled[0],...hosts,...bundled].flatMap(raw=>{try{return [normalizeMirror(raw)];}catch{return [];}}))];
    })();
  }
  private find(excluded:Set<string>) {
    if(this.selection)return this.selection;
    this.selection=(async()=>{
      for(const candidate of await this.hosts()) {
        if(excluded.has(new URL(candidate).host))continue;
        try {
          const response=await this.request(candidate,undefined,undefined,6000);
          if(isChallenge(response.text))throw new VerificationRequired(response.url);
          // A parked domain or an unrelated redirect is not a working content mirror.
          if(!/class=.[^>]*TPost|peliculas-online/.test(response.text))continue;
          const selected=normalizeMirror(response.url);this.select(selected);return selected;
        }catch(error){
          // Preserve the site's verification flow instead of rotating through protected hosts.
          if(error instanceof VerificationRequired){this.select(candidate);throw error;}
        }
      }
      throw new Error('No mirror could be reached. Choose another mirror in Settings.');
    })().finally(()=>{this.selection=undefined;});
    return this.selection;
  }
  async run<T>(operation:(base:string)=>Promise<T>):Promise<T> {
    let base=this.saved();const excluded=new Set<string>();
    while(true) {
      try{return await operation(base);}catch(error){
        if(!canFailOver(error))throw error;
        excluded.add(new URL(base).host);base=await this.find(excluded);
      }
    }
  }
}
