// Texturas del juego, generadas por canvas (sin archivos externos).
import * as THREE from 'three';
import { F, HALF_W, HALF_L } from '../config/field.js';

let _shadowTex=null;
export function softShadowTexture(){
  if(_shadowTex) return _shadowTex;
  const N=128, c=document.createElement('canvas'); c.width=c.height=N;
  const g=c.getContext('2d');
  const gr=g.createRadialGradient(N/2,N/2,0,N/2,N/2,N/2);
  gr.addColorStop(0,'rgba(0,0,0,0.75)'); gr.addColorStop(0.55,'rgba(0,0,0,0.35)');
  gr.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=gr; g.fillRect(0,0,N,N);
  _shadowTex=new THREE.CanvasTexture(c);
  return _shadowTex;
}

export function skinTex(c1,c2,num){
  const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  g.fillStyle=c1; g.fillRect(0,0,128,128);
  g.fillStyle=c2; g.fillRect(0,0,128,20); // hombros
  g.fillStyle='rgba(255,255,255,.15)'; g.fillRect(54,0,20,128); // franja central
  g.fillStyle=c2; g.font='bold 54px Arial'; g.textAlign='center'; g.textBaseline='middle';
  g.fillText(num, 64, 74);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}

export function makePitchTexture(){
  // Lienzo PROPORCIONAL al plano (84 x 121 m) y dibujado en metros: así el
  // círculo central es un círculo de verdad y no una elipse.
  const W=F.W+16, L=F.L+16, k=16;                 // k = píxeles por metro
  const c=document.createElement('canvas');
  c.width=Math.round(W*k); c.height=Math.round(L*k);
  const g=c.getContext('2d');
  g.save();
  g.translate(c.width/2, c.height/2);
  g.scale(k,k);                                    // a partir de aquí, 1 unidad = 1 metro

  // --- franjas de corte (perpendiculares al largo) ---
  const n=20, sw=L/n;
  for(let i=0;i<n;i++){
    g.fillStyle = i%2 ? '#33a446' : '#2b8f3a';
    g.fillRect(-W/2, -L/2+i*sw, W, sw+0.03);
  }
  // --- vetas de rodillo dentro de cada franja ---
  g.globalAlpha=0.05;
  for(let i=0;i<n;i++){
    g.fillStyle = i%2 ? '#000' : '#fff';
    for(let j=0;j<7;j++) g.fillRect(-W/2, -L/2+i*sw+j*(sw/7), W, sw/16);
  }
  g.globalAlpha=1;
  // --- ruido de hierba ---
  for(let i=0;i<26000;i++){
    g.globalAlpha=Math.random()*0.07;
    g.fillStyle=Math.random()<0.5?'#0b3d18':'#7fe08a';
    g.fillRect((Math.random()-0.5)*W, (Math.random()-0.5)*L, 0.14, 0.30);
  }
  // --- desgaste frente a las porterías y en el centro ---
  g.globalAlpha=1;
  for(const [cx,cz,r] of [[0,HALF_L-6,9],[0,-HALF_L+6,9],[0,0,7]]){
    const gr=g.createRadialGradient(cx,cz,0,cx,cz,r);
    gr.addColorStop(0,'rgba(150,120,70,0.13)'); gr.addColorStop(1,'rgba(150,120,70,0)');
    g.fillStyle=gr; g.beginPath(); g.arc(cx,cz,r,0,Math.PI*2); g.fill();
  }

  // --- LÍNEAS REGLAMENTARIAS (todo en metros) ---
  g.strokeStyle='rgba(255,255,255,0.94)'; g.fillStyle='rgba(255,255,255,0.94)';
  g.lineWidth=0.12; g.lineJoin='miter';
  g.strokeRect(-HALF_W,-HALF_L,F.W,F.L);                       // perímetro
  g.beginPath(); g.moveTo(-HALF_W,0); g.lineTo(HALF_W,0); g.stroke();   // línea media
  g.beginPath(); g.arc(0,0,9.15,0,Math.PI*2); g.stroke();      // círculo central (¡redondo!)
  g.beginPath(); g.arc(0,0,0.16,0,Math.PI*2); g.fill();        // punto central

  const ARCO=Math.acos(5.5/9.15);                              // semiángulo del arco del área
  for(const s of [1,-1]){
    const zc=s*HALF_L;
    g.strokeRect(-20.16, s>0? zc-16.5 : zc, 40.32, 16.5);      // área grande
    g.strokeRect(-9.16,  s>0? zc-5.5  : zc, 18.32, 5.5);       // área chica
    const pz = zc - s*11;                                       // punto de penal
    g.beginPath(); g.arc(0,pz,0.16,0,Math.PI*2); g.fill();
    g.beginPath();                                              // arco del área
    const base = s>0 ? 1.5*Math.PI : 0.5*Math.PI;
    g.arc(0,pz,9.15, base-ARCO, base+ARCO); g.stroke();
  }
  // arcos de córner (recortados al terreno)
  g.save();
  g.beginPath(); g.rect(-HALF_W,-HALF_L,F.W,F.L); g.clip();
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    g.beginPath(); g.arc(sx*HALF_W, sz*HALF_L, 1, 0, Math.PI*2); g.stroke();
  }
  g.restore();
  g.restore();

  const tex=new THREE.CanvasTexture(c);
  tex.anisotropy=16; tex.colorSpace=THREE.SRGBColorSpace;
  return tex;
}

export function makeNetTexture(){
  const N=64, c=document.createElement('canvas'); c.width=c.height=N;
  const g=c.getContext('2d');
  g.clearRect(0,0,N,N);
  g.strokeStyle='#ffffff'; g.lineWidth=3.2;
  g.beginPath();
  g.moveTo(0,0); g.lineTo(N,0); g.moveTo(0,0); g.lineTo(0,N);   // celda de rejilla
  g.stroke();
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  return t;
}

export function makeLedTexture(c1, c2, texto){
  const w=1024,h=96, c=document.createElement('canvas'); c.width=w; c.height=h;
  const g=c.getContext('2d');
  const grd=g.createLinearGradient(0,0,w,0);
  grd.addColorStop(0,c1); grd.addColorStop(0.5,c2); grd.addColorStop(1,c1);
  g.fillStyle=grd; g.fillRect(0,0,w,h);
  g.fillStyle='rgba(255,255,255,0.92)';
  g.font='bold 52px Arial'; g.textAlign='center'; g.textBaseline='middle';
  for(let i=0;i<3;i++) g.fillText(texto, w*(i+0.5)/3, h/2);
  // rejilla de píxeles LED
  g.globalAlpha=0.16; g.fillStyle='#000';
  for(let x=0;x<w;x+=4) g.fillRect(x,0,2,h);
  for(let y=0;y<h;y+=4) g.fillRect(0,y,w,2);
  const t=new THREE.CanvasTexture(c);
  t.wrapS=THREE.RepeatWrapping; t.colorSpace=THREE.SRGBColorSpace;
  return t;
}

