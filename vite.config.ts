import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {mediaPolicy} from './src/core/providers/policy';
const sessions = new Map<string,string>();
function localContentProxy():Plugin {
  return {name:'rezka-preview-content',configureServer(server) {
    server.middlewares.use('/api/media',async(req,res)=>{
      try {
        const params=new URL(req.url||'','http://localhost').searchParams,url=new URL(params.get('url')||''),referer=params.get('referer')||'',provider=params.get('provider')||'',policy=mediaPolicy(provider);
        if(req.method!=='GET'||url.protocol!=='https:'||url.username||url.password||url.port||!policy.media(url.href)||!policy.referer(referer))throw new Error('Unsupported video address');
        const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',...(referer?{Referer:referer}:{}),...(req.headers.range?{Range:req.headers.range}:{})}});
        if(!policy.media(response.url))throw new Error('Unsupported video redirect');
        res.statusCode=response.status;
        const type=response.headers.get('content-type')||'application/octet-stream';res.setHeader('Content-Type',type);
        const link=(raw:string)=>`/api/media?url=${encodeURIComponent(new URL(raw,response.url).href)}&referer=${encodeURIComponent(referer)}${provider?`&provider=${encodeURIComponent(provider)}`:''}`;
        if(/mpegurl/i.test(type)||!new URL(response.url).pathname.includes('.')&& !req.headers.range){const body=await response.text();if(body.trimStart().startsWith('#EXTM3U')){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(body.split('\n').map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,url)=>`URI="${link(url)}"`):line.trim()?link(line.trim()):line).join('\n'));}else res.end(body);}
        else if(response.body)await pipeline(Readable.fromWeb(response.body as any),res);else res.end();
      }catch(error){if(res.headersSent)res.destroy();else{res.statusCode=502;res.end(error instanceof Error?error.message:'Video request failed');}}
    });
    server.middlewares.use('/api/content',async(req,res)=>{
      try {
        const raw=new URL(req.url||'','http://localhost').searchParams.get('url');
        if(!raw)throw new Error('Missing content address');const url=new URL(raw);
        if(url.protocol!=='https:'||url.username||url.password||url.port||isIP(url.hostname)||url.hostname==='localhost'||url.hostname.endsWith('.local'))throw new Error('A public secure content address is required');
        const chunks:Buffer[]=[];let length=0;
        for await(const chunk of req){length+=chunk.length;if(length>65536)throw new Error('Request too large');chunks.push(chunk);}
        const response=await fetch(url,{method:req.method,body:req.method==='POST'?Buffer.concat(chunks):undefined,signal:AbortSignal.timeout(Math.min(18000,Math.max(3000,Number(req.headers['x-rezka-timeout'])||15000))),headers:{'User-Agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36','Accept':'*/*','Accept-Language':'es-ES,es;q=0.9,en;q=0.7',Referer:String(req.headers['x-rezka-referer']||url.origin+'/'),...(req.method==='POST'?{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest',Origin:url.origin}:{}),...(sessions.get(url.hostname)?{Cookie:sessions.get(url.hostname)!}:{})}});
        const cookies=response.headers.getSetCookie().map(c=>c.split(';')[0]);if(cookies.length)sessions.set(url.hostname,cookies.join('; '));
        const bytes=await response.arrayBuffer();let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1251').decode(bytes);}
        res.statusCode=response.status;res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('X-Rezka-URL',response.url);res.end(text);
      }catch(e){res.statusCode=502;res.end(e instanceof Error?e.message:'Content request failed');}
    });
  }};
}
export default defineConfig({plugins:[react(),localContentProxy()],server:{port:5173,strictPort:true,watch:{ignored:['**/android/**']}},build:{target:'es2020'},test:{environment:'jsdom',include:['tests/**/*.test.ts']}});
