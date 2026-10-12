import { describe,it,expect } from 'vitest';
import { VerificationCoordinator,type ContentRequest } from '../src/core/verification';

describe('shared website verification',()=>{
  it('retries simultaneous stale challenges after one verification',async()=>{
    const coordinator=new VerificationCoordinator();let verified=false,checks=0;
    const send=async(options:ContentRequest)=>({url:options.url,status:verified?200:403,text:verified?'catalogue':'challenge'});
    const verify=async()=>{checks++;verified=true;};
    const results=await Promise.all(['films','series','categories','details'].map(path=>coordinator.request({url:`https://example.com/${path}`,method:'GET'},send,verify,text=>text==='challenge')));
    expect(checks).toBe(1);expect(results.every(response=>response.status===200)).toBe(true);
  });
  it('passes the exact blocked POST request and allows a fresh later challenge',async()=>{
    const coordinator=new VerificationCoordinator(),received:ContentRequest[]=[];let verified=false;
    const options={url:'https://example.com/ajax',method:'POST',body:'id=2259&translator_id=1',referer:'https://example.com/film'};
    const send=async(request:ContentRequest)=>({url:request.url,status:verified?200:403,text:verified?'streams':'challenge'});
    const verify=async(_url:string,request:ContentRequest)=>{received.push(request);verified=true;};
    await coordinator.request(options,send,verify,text=>text==='challenge');verified=false;
    await coordinator.request(options,send,verify,text=>text==='challenge');
    expect(received).toEqual([options,options]);
  });
  it('does not leave the queue blocked after cancellation',async()=>{
    const coordinator=new VerificationCoordinator();let verified=false;
    const send=async(options:ContentRequest)=>({url:options.url,status:verified?200:403,text:verified?'titles':'challenge'});
    const options={url:'https://example.com/',method:'GET'};
    await expect(coordinator.request(options,send,async()=>{throw new Error('Cancelled');},text=>text==='challenge')).rejects.toThrow('Cancelled');
    const result=await coordinator.request(options,send,async()=>{verified=true;},text=>text==='challenge');
    expect(result.status).toBe(200);
  });
});
