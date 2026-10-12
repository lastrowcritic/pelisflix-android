export interface ContentRequest {url:string;method:string;body?:string;referer?:string;timeout?:number}
export interface ContentResponse {text:string;url:string;status:number}

// Protected requests share a verification turn. A queued stale challenge must
// retry against the newly verified session before opening another screen.
export class VerificationCoordinator {
  private tail:Promise<unknown>=Promise.resolve();
  private generations=new Map<string,number>();
  async request(options:ContentRequest,send:(options:ContentRequest)=>Promise<ContentResponse>,verify:(url:string,request:ContentRequest)=>Promise<unknown>,challenged:(text:string)=>boolean){
    const origin=new URL(options.url).origin,generation=this.generations.get(origin)||0;
    const response=await send(options);
    if(!challenged(response.text))return response;
    const result=this.tail.then(async()=>{
      let latest=response;
      if((this.generations.get(origin)||0)!==generation)latest=await send(options);
      if(!challenged(latest.text))return latest;
      await verify(latest.url,options);
      this.generations.set(origin,(this.generations.get(origin)||0)+1);
      return send(options);
    });
    this.tail=result.catch(()=>{});
    return result;
  }
  async idle(){await this.tail;}
}
