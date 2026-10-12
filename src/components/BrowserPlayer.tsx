import { useEffect, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { ChevronLeft, Pause, Play, RotateCcw, RotateCw, Settings2 } from 'lucide-react';
import type { Item, Selection, Source } from '../core/types';
import { clock, nextEpisode } from '../core/store';
import { focus } from '../core/focus';
import { TVButton } from './TVButton';
export function BrowserPlayer({item,selection,source,position,quality,autoplay,onProgress,onClose,onNext}:{item:Item;selection:Selection;source:Source;position:number;quality:string;autoplay:boolean;onProgress:(position:number,duration:number)=>void;onClose:()=>void;onNext:(selection:Selection)=>void}) {
  const video=useRef<HTMLVideoElement>(null),initialPosition=useRef(position),sourceIndex=useRef(0);
  const [stream,setStream]=useState(source.streams.find(s=>s.quality===quality)||source.streams[0]);
  const [playing,setPlaying]=useState(false),[time,setTime]=useState(position),[duration,setDuration]=useState(0),[error,setError]=useState(''),[controls,setControls]=useState(true),[showSettings,setShowSettings]=useState(false),[settingsSection,setSettingsSection]=useState<'quality'|'subtitles'|'speed'>(),[speed,setSpeed]=useState(1),[countdown,setCountdown]=useState<number>();
  const progressRef=useRef(onProgress);progressRef.current=onProgress;
  const closeRef=useRef(onClose);closeRef.current=onClose;
  const [subtitle,setSubtitle]=useState(source.subtitles.find(t=>t.language===source.defaultSubtitle||t.label===source.defaultSubtitle)?.label||'Off');
  const next=nextEpisode(item,selection),lastInput=useRef(Date.now()),restorePlaying=useRef(true);
  const flush=()=>{const v=video.current;if(v)progressRef.current(v.currentTime,v.duration);};
  const reveal=()=>{lastInput.current=Date.now();setControls(true);};
  useEffect(()=>{
    const v=video.current!;let hls:Hls|undefined;let disposed=false;
    const urls=[stream.url,...stream.alternatives];sourceIndex.current=0;setError('');
    const load=async()=>{
      hls?.destroy();const url=urls[sourceIndex.current];
      if(stream.mimeType==='application/x-mpegURL'||/\.m3u8(?:\?|$)/i.test(url)) {
        try {
          const HlsPlayer=(await import('hls.js')).default;
          if(disposed)return;
          if(HlsPlayer.isSupported()) {hls=new HlsPlayer({enableInterstitialPlayback:false,interstitialsController:undefined});hls.attachMedia(v);hls.loadSource(url);hls.on(HlsPlayer.Events.ERROR,(_,data)=>{if(data.fatal)failure();});if(restorePlaying.current)v.play().catch(()=>{setPlaying(false);reveal();});return;}
        } catch { if(disposed)return; }
      }
      v.src=url;
    };
    const failure=()=>{if(disposed)return;if(sourceIndex.current+1<urls.length){initialPosition.current=v.currentTime||initialPosition.current;sourceIndex.current++;load();}else setError('This video could not be played. Try another quality or return to the title.');};
    const loaded=()=>{v.currentTime=Math.min(initialPosition.current,Math.max(0,v.duration-1));setDuration(v.duration);v.playbackRate=speed;if(restorePlaying.current)v.play().catch(()=>{setPlaying(false);reveal();});};
    v.addEventListener('loadedmetadata',loaded);v.addEventListener('error',failure);load();
    return ()=>{disposed=true;flush();v.pause();hls?.destroy();v.removeEventListener('loadedmetadata',loaded);v.removeEventListener('error',failure);v.removeAttribute('src');v.load();};
  },[stream]);
  useEffect(()=>{
    const v=video.current!;let lastSave=Date.now();const timer=setInterval(()=>{if(Date.now()-lastSave>=5000){flush();lastSave=Date.now();}if(v.paused||showSettings||Date.now()-lastInput.current<5000)return;setControls(false);},1000);
    const lifecycle=()=>{if(document.hidden){flush();v.pause();setCountdown(undefined);}};
    const key=(event:KeyboardEvent)=>{
      reveal();if(event.key===' '||event.key==='MediaPlayPause'){event.preventDefault();v.paused?v.play().catch(()=>{}):v.pause();}
      if(event.key==='MediaFastForward'||event.key==='MediaRewind'){event.preventDefault();v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+(event.key==='MediaFastForward'?10:-10)));flush();}
      if(event.key==='Escape'||event.key==='BrowserBack'){event.preventDefault();event.stopImmediatePropagation();if(settingsSection){setSettingsSection(undefined);setTimeout(()=>focus('settings-quality'),0);}else if(showSettings){setShowSettings(false);setTimeout(()=>focus('player-settings'),0);}else{flush();closeRef.current();}}
    };
    window.addEventListener('keydown',key,true);window.addEventListener('pagehide',flush);document.addEventListener('visibilitychange',lifecycle);
    return ()=>{clearInterval(timer);window.removeEventListener('keydown',key,true);window.removeEventListener('pagehide',flush);document.removeEventListener('visibilitychange',lifecycle);};
  },[showSettings,settingsSection]);
  useEffect(()=>{focus('player-toggle');},[]);
  useEffect(()=>{if(video.current)video.current.playbackRate=speed;},[speed,stream]);
  useEffect(()=>{const tracks=video.current?.textTracks;if(tracks)for(const track of tracks)track.mode=track.label===subtitle?'showing':'disabled';},[subtitle,stream]);
  useEffect(()=>{if(countdown===undefined)return;if(countdown===0){if(next)onNext(next);return;}const timer=setTimeout(()=>setCountdown(countdown-1),1000);return ()=>clearTimeout(timer);},[countdown]);
  const skip=(seconds:number)=>{const v=video.current!;v.currentTime=Math.max(0,Math.min(v.duration||0,v.currentTime+seconds));flush();reveal();};
  return <div className="player" data-focus-scope="active" onMouseMove={reveal}>
    <video preload="auto" ref={video} onTimeUpdate={()=>setTime(video.current?.currentTime||0)} onPlay={()=>setPlaying(true)} onPause={()=>{setPlaying(false);flush();}} onEnded={()=>{flush();if(autoplay&&next)setCountdown(5);else reveal();}} playsInline>
      {source.subtitles.map(track=><track key={track.url} src={track.url} kind="subtitles" label={track.label} srcLang={track.language} default={track.language===source.defaultSubtitle||track.label===source.defaultSubtitle}/>)}
    </video>
    <div className={`player-ui ${controls||showSettings||error||countdown!==undefined?'visible':''}`}>
      <div className="player-heading"><TVButton id="player-back" onClick={()=>{flush();onClose();}}><ChevronLeft/>Back to title</TVButton><div><h2>{item.title}</h2><p>{selection.season?`Season ${selection.season}, episode ${selection.episode}`:'Now playing'}</p></div></div>
      {error&&<div className="player-error"><h2>Playback needs attention</h2><p>{error}</p><TVButton id="player-retry" onClick={()=>{initialPosition.current=time;setStream({...stream});}}>Retry video</TVButton></div>}
      <div className="player-bottom"><div className="timeline"><span style={{width:`${duration?time/duration*100:0}%`}}/></div><div className="timeline-labels"><span>{clock(time)}</span><span>{clock(duration)}</span></div>
        <div className="player-actions"><TVButton id="player-rewind" onClick={()=>skip(-10)} aria-label="Back ten seconds"><RotateCcw/>10 seconds</TVButton><TVButton id="player-toggle" className="primary" onClick={()=>{const v=video.current!;v.paused?v.play().catch(()=>setError('Press Play to start the video.')):v.pause();}}>{playing?<Pause/>:<Play fill="currentColor"/>}{playing?'Pause':'Play'}</TVButton><TVButton id="player-forward" onClick={()=>skip(10)} aria-label="Forward ten seconds"><RotateCw/>10 seconds</TVButton><TVButton id="player-settings" onClick={()=>{setShowSettings(true);setSettingsSection(undefined);setTimeout(()=>focus('settings-quality'),0);}}><Settings2/>Settings</TVButton></div>
      </div>
    </div>
    {showSettings&&<div className="player-settings-backdrop"><section className="player-settings" data-focus-scope="active" role="dialog" aria-modal="true" aria-label="Playback settings"><h2>{settingsSection==='quality'?'Video quality':settingsSection==='subtitles'?'Subtitles':settingsSection==='speed'?'Playback speed':'Playback settings'}</h2><div className="player-settings-choices" data-focus-group="player-settings" data-focus-axis="column">
      {!settingsSection&&<><TVButton id="settings-quality" onClick={()=>{setSettingsSection('quality');setTimeout(()=>focus(`quality-${stream.quality}`),0);}}>Video quality <span>{stream.quality}</span></TVButton><TVButton id="settings-subtitles" onClick={()=>{setSettingsSection('subtitles');setTimeout(()=>focus('subtitle-0'),0);}}>Subtitles <span>{subtitle}</span></TVButton><TVButton id="settings-speed" onClick={()=>{setSettingsSection('speed');setTimeout(()=>focus(`speed-${speed}`),0);}}>Playback speed <span>{speed===1?'Normal':`${speed} times`}</span></TVButton></>}
      {settingsSection==='quality'&&source.streams.map(s=><TVButton id={`quality-${s.quality}`} key={s.quality} aria-pressed={s.quality===stream.quality} onClick={()=>{initialPosition.current=time;restorePlaying.current=!video.current!.paused;setStream(s);setSettingsSection(undefined);setTimeout(()=>focus('settings-quality'),0);}}>{s.quality}</TVButton>)}
      {settingsSection==='subtitles'&&['Off',...source.subtitles.map(t=>t.label)].map((label,i)=><TVButton id={`subtitle-${i}`} key={label} aria-pressed={subtitle===label} onClick={()=>{setSubtitle(label);setSettingsSection(undefined);setTimeout(()=>focus('settings-subtitles'),0);}}>{label}</TVButton>)}
      {settingsSection==='speed'&&[.5,.75,1,1.25,1.5,2].map(value=><TVButton id={`speed-${value}`} key={value} aria-pressed={speed===value} onClick={()=>{setSpeed(value);setSettingsSection(undefined);setTimeout(()=>focus('settings-speed'),0);}}>{value===1?'Normal':`${value} times`}</TVButton>)}
      <TVButton id="settings-close" onClick={()=>{if(settingsSection){setSettingsSection(undefined);setTimeout(()=>focus('settings-quality'),0);}else{setShowSettings(false);setTimeout(()=>focus('player-settings'),0);}}}>{settingsSection?'Back to settings':'Close'}</TVButton>
    </div></section></div>}
    {countdown!==undefined&&next&&<div className="next-episode"><p>Next episode in {countdown} seconds</p><h2>Season {next.season}, episode {next.episode}</h2><TVButton id="next-now" onClick={()=>onNext(next)}>Play now</TVButton><TVButton id="next-cancel" onClick={()=>{setCountdown(undefined);reveal();}}>Stay here</TVButton></div>}
  </div>;
}
