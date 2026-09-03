// Audio procedural con WebAudio: ambiente de hinchada, silbato y golpeo.
// El contexto es privado del módulo; nadie de fuera lo toca.
let actx=null, crowdGain=null;

export function initAudio(){
  try{
    actx=new (window.AudioContext||window.webkitAudioContext)();
    // ambiente de multitud: ruido rosa filtrado suave
    const buf=actx.createBuffer(1, actx.sampleRate*2, actx.sampleRate);
    const d=buf.getChannelData(0); let last=0;
    for(let i=0;i<d.length;i++){ const w=Math.random()*2-1; last=(last+0.02*w)/1.02; d[i]=last*3; }
    const src=actx.createBufferSource(); src.buffer=buf; src.loop=true;
    const flt=actx.createBiquadFilter(); flt.type='bandpass'; flt.frequency.value=650; flt.Q.value=0.6;
    crowdGain=actx.createGain(); crowdGain.gain.value=0.05;
    src.connect(flt).connect(crowdGain).connect(actx.destination); src.start();
  }catch(e){}
}

export function playKick(){ if(!actx) return;
  const o=actx.createOscillator(),g=actx.createGain();
  o.type='sine'; o.frequency.setValueAtTime(180,actx.currentTime);
  o.frequency.exponentialRampToValueAtTime(60,actx.currentTime+0.08);
  g.gain.setValueAtTime(0.25,actx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,actx.currentTime+0.12);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime+0.13);
}

export function playWhistle(n){ if(!actx) return;
  for(let i=0;i<n;i++){ const t=actx.currentTime+i*0.18;
    const o=actx.createOscillator(),g=actx.createGain();
    o.type='square'; o.frequency.setValueAtTime(2100,t);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.12,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,t+0.14);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t+0.15);
  }
}

export function crowdCheer(){ if(!crowdGain) return;
  crowdGain.gain.cancelScheduledValues(actx.currentTime);
  crowdGain.gain.setValueAtTime(crowdGain.gain.value, actx.currentTime);
  crowdGain.gain.linearRampToValueAtTime(0.28, actx.currentTime+0.1);
  crowdGain.gain.linearRampToValueAtTime(0.05, actx.currentTime+3.2);
}


/** Crea el contexto de audio si hace falta, o lo reanuda si el navegador
 *  lo suspendió. Es la única puerta de entrada: `actx` no sale del módulo. */
export function ensureAudio(){
  if(!actx) initAudio();
  else if(actx.state==='suspended') actx.resume();
}
