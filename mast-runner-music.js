/* Original Mast Runner Arcade Theme — 132 BPM, 16 Takte.
 * Die Noten entsprechen der eigens komponierten MIDI-Fassung.
 * Web-Audio-Scheduler statt MP3-Neustart: Noten am Loop-Übergang bleiben samplegenau getaktet.
 */
(function(){
"use strict";
const BPM=132, BEAT=60/BPM, LOOP=64*BEAT, LOOKAHEAD=.46;
const DATA={
lead:"AABRAwQAVAMIAFgGEABYAxQAVgMYAFQDHABRAyAAUQMkAFQDKABYAywAWQMwAFgHOABUAzwAUQNAAE8DRABUA0gAWAZQAFsDVABYA1gAVgNcAFQDYABTBGQAVgNoAFsGcABZA3QAVgN4AFMHgABRBogAWAOMAFQDkABRA5QAVAOYAFYDnABYA6AAWQOkAFgDqABUB7AAUQO0AFQDuABYB8AAVgPEAFkDyABRA8wAVgPQAFQD1ABRA9gATQbgAFAD5ABTA+gAWAbwAFYD9ABTA/gAUAcAAVgDBAFUAwgBUQMMAVQDEAFYBhgBWwMcAVgDIAFZBigBWAMsAVQDMAFRAzQBVAM4AVkGQAFbA0QBWANIAVYDTAFUA1ABTwZYAVQDXAFYA2ABVgNkAVsDaAFZBnABVgN0AVMDeAFPBoABWQOEAVYDiAFRA4wBVgOQAVkDlAFYA5gBVgagAVQDpAFRA6gBTQOsAVEDsAFUA7QBWAO4AVkGwAFYA8QBVgPIAVMDzAFQA9ABUwbYAVgG4AFWA+QBUwPoAVAD7AFTA/ABWAP0AVMD+AFQA/wBTAM=",
bass:"AAAtBggALQQQADQFGAA5BiAAKQYoACkEMAAwBTgANQZAADAGSAAwBFAANwVYADwGYAArBmgAKwRwADIFeAA3BoAALQaIAC0EkAA0BZgAOQagACkGqAApBLAAMAW4ADUGwAAyBsgAMgTQADkF2AA+BuAAKAboACgE8AAvBfgANAYAAS0GCAEtBBABNAUYATkGIAEpBigBKQQwATAFOAE1BkABMAZIATAEUAE3BVgBPAZgASsGaAErBHABMgV4ATcGgAEyBogBMgSQATkFmAE+BqABKQaoASkEsAEwBbgBNQbAASgGyAEoBNABLwXYATQG4AEoBugBKATwAS8F+AE0Bg==",
arp:"AABFAgQASAIIAEwCDABPAhAARQIUAEgCGABMAhwATwIgAEUCJABIAigATAIsAEECMABFAjQASAI4AEwCPABBAkAASAJEAEwCSABPAkwASgJQAEgCVABMAlgATwJcAEoCYABHAmQASgJoAE0CbABDAnAARwJ0AEoCeABNAnwAQwKAAEUChABIAogATAKMAE8CkABFApQASAKYAEwCnABPAqAARQKkAEgCqABMAqwAQQKwAEUCtABIArgATAK8AEECwABKAsQATQLIAEUCzABIAtAASgLUAE0C2ABFAtwASALgAEQC5ABHAugASgLsAEwC8ABEAvQARwL4AEoC/ABMAgABRQIEAUgCCAFMAgwBTwIQAUUCFAFIAhgBTAIcAU8CIAFFAiQBSAIoAUwCLAFBAjABRQI0AUgCOAFMAjwBQQJAAUgCRAFMAkgBTwJMAUoCUAFIAlQBTAJYAU8CXAFKAmABRwJkAUoCaAFNAmwBQwJwAUcCdAFKAngBTQJ8AUMCgAFKAoQBTQKIAUUCjAFIApABSgKUAU0CmAFFApwBSAKgAUUCpAFIAqgBTAKsAUECsAFFArQBSAK4AUwCvAFBAsABTALEAUQCyAFHAswBSgLQAUwC1AFEAtgBRwLcAUoC4AFEAuQBRwLoAUoC7AFMAvABRAL0AUcC+AFKAvwBTAI=",
pad:"AAA5CAAAPAgAAEAIEAA5CBAAPAgQAEAIIAA1CCAAOQggADwIMAA1CDAAOQgwADwIQAA8CEAAQAhAAEMIUAA8CFAAQAhQAEMIYAA3CGAAOwhgAD4IcAA3CHAAOwhwAD4IgAA5CIAAPAiAAEAIkAA5CJAAPAiQAEAIoAA1CKAAOQigADwIsAA1CLAAOQiwADwIwAA+CMAAQQjAAEUI0AA+CNAAQQjQAEUI4AA0COAAOAjgADsI8AA0CPAAOAjwADsIAAE5CAABPAgAAUAIEAE5CBABPAgQAUAIIAE1CCABOQggATwIMAE1CDABOQgwATwIQAE8CEABQAhAAUMIUAE8CFABQAhQAUMIYAE3CGABOwhgAT4IcAE3CHABOwhwAT4IgAE+CIABQQiAAUUIkAE+CJABQQiQAUUIoAE1CKABOQigATwIsAE1CLABOQiwATwIwAE0CMABOAjAATsI0AE0CNABOAjQATsI4AE0COABOAjgATsI8AE0CPABOAjwATsI"
};
const LEVEL=.29;
const leanMobileAudio=window.matchMedia("(max-width:700px), (pointer:coarse)").matches;
// Musik läuft auch im Stumm-Modus zeitlich weiter, ohne Audio-Knoten zu erzeugen.
// Auf schwächeren Mobilgeräten bleiben Melodie, Bass und Takt erhalten.
function shouldRenderEvent(event){
  if(muted)return false;
  if(!leanMobileAudio)return true;
  if(event.kind==="arp"||event.kind==="hat"){
    return Math.round(event.beat*2)%2===0;
  }
  return true;
}
let muted=false;
try{muted=localStorage.getItem("mastRunnerMusicMuted")==="true";}catch(_){}

function decodeNotes(encoded,kind){
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)), notes=[];
  for(let i=0;i<bytes.length;i+=4){
    notes.push({kind,beat:(bytes[i]+256*bytes[i+1])/8,note:bytes[i+2],duration:bytes[i+3]/8});
  }
  return notes;
}
const events=[
  ...decodeNotes(DATA.lead,"lead"),...decodeNotes(DATA.bass,"bass"),
  ...decodeNotes(DATA.arp,"arp"),...decodeNotes(DATA.pad,"pad")
];
for(let bar=0;bar<16;bar++){
  const base=bar*4;
  for(let i=0;i<4;i++)events.push({beat:base+i,kind:i%2?"snare":"kick"});
  for(let i=0;i<8;i++)events.push({beat:base+i*.5,kind:i===7?"openhat":"hat"});
  if(bar%4===3){
    for(let j=0;j<4;j++)events.push({beat:base+3+j*.25,kind:"hat"});
  }
}
events.sort((a,b)=>a.beat-b.beat);
let context=null, master=null, timer=null, noise=null, startedAt=0, index=0, cycle=0, playing=false;

function noiseBuffer(ctx){
  if(noise && noise.sampleRate===ctx.sampleRate)return noise;
  const n=Math.round(ctx.sampleRate*.18);
  noise=ctx.createBuffer(1,n,ctx.sampleRate);
  const data=noise.getChannelData(0);
  let seed=53971;
  for(let i=0;i<n;i++){seed=(1664525*seed+1013904223)>>>0;data[i]=((seed/4294967296)*2-1);}
  return noise;
}
function note(ctx,bus,e,t){
  const wave={lead:"square",bass:"triangle",arp:"triangle",pad:"sine"}[e.kind];
  const volume={lead:.13,bass:.105,arp:.062,pad:.048}[e.kind];
  const dur=e.duration*BEAT;
  const osc=ctx.createOscillator();
  const gain=ctx.createGain();
  osc.type=wave;
  osc.frequency.setValueAtTime(440*Math.pow(2,(e.note-69)/12),t);
  gain.gain.setValueAtTime(.0001,t);
  gain.gain.linearRampToValueAtTime(volume,t+(e.kind==="pad"?.028:.005));
  gain.gain.linearRampToValueAtTime(volume*.66,t+Math.min(.10,dur*.6));
  gain.gain.setValueAtTime(volume*.58,t+dur);
  gain.gain.exponentialRampToValueAtTime(.0001,t+dur+(e.kind==="pad"?.16:.065));
  osc.connect(gain);gain.connect(bus);
  osc.start(t);osc.stop(t+dur+(e.kind==="pad"?.18:.08));
}
function percussion(ctx,bus,e,t){
  if(e.kind==="kick"){
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type="sine";
    osc.frequency.setValueAtTime(155,t);
    osc.frequency.exponentialRampToValueAtTime(48,t+.13);
    gain.gain.setValueAtTime(.085,t);
    gain.gain.exponentialRampToValueAtTime(.0001,t+.19);
    osc.connect(gain);gain.connect(bus);
    osc.start(t);osc.stop(t+.20);
    return;
  }
  const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
  src.buffer=noiseBuffer(ctx);
  filter.type="highpass";
  filter.frequency.value=e.kind==="snare"?1100:6500;
  const level=e.kind==="snare"?.053:.020;
  const duration=e.kind==="snare"?.145:e.kind==="openhat"?.14:.055;
  gain.gain.setValueAtTime(level,t);
  gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  src.connect(filter);filter.connect(gain);gain.connect(bus);
  src.start(t);src.stop(t+duration+.01);
}
function schedule(){
  if(!playing||!context||!master)return;
  const horizon=context.currentTime+LOOKAHEAD;
  let processed=0;
  while(processed<250){
    const e=events[index], t=startedAt+cycle*LOOP+e.beat*BEAT;
    if(t>horizon)break;
    if(t>=context.currentTime-.02&&shouldRenderEvent(e)){
      if(e.note!==undefined)note(context,master,e,t);
      else percussion(context,master,e,t);
    }
    if(++index===events.length){index=0;cycle++;}
    processed++;
  }
}
function stop(){
  playing=false;
  if(timer!==null){clearInterval(timer);timer=null;}
  if(master&&context){
    const now=context.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(0,now,.02);
  }
  master=null;
}
function start(audioContext){
  stop();
  if(!audioContext)return;
  context=audioContext;
  context.resume().catch(()=>{});
  master=context.createGain();
  master.gain.setValueAtTime(muted?0:LEVEL,context.currentTime);
  master.connect(context.destination);
  startedAt=context.currentTime+.08;
  cycle=0;index=0;playing=true;
  schedule();
  timer=setInterval(schedule,85);
}
function setMuted(value){
  muted=!!value;
  try{localStorage.setItem("mastRunnerMusicMuted",String(muted));}catch(_){}
  if(master&&context)master.gain.setTargetAtTime(muted?0:LEVEL,context.currentTime,.026);
}
window.MastRunnerMusic={start,stop,setMuted,isMuted:()=>muted};
})();