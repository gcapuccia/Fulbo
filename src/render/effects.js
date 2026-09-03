// Efectos: confeti de gol y destellos de cámaras en las gradas.
import * as THREE from 'three';
import { F, HALF_W, HALF_L } from '../config/field.js';
import { S } from '../core/state.js';
import { G } from '../app/G.js';

export function buildConfetti(){
  const N=300; const geo=new THREE.BufferGeometry();
  const pos=new Float32Array(N*3), col=new Float32Array(N*3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos,3));
  geo.setAttribute('color', new THREE.BufferAttribute(col,3));
  const mat=new THREE.PointsMaterial({size:0.5,vertexColors:true,transparent:true});
  G.confetti=new THREE.Points(geo,mat); G.confetti.visible=false;
  G.confetti.userData={vel:new Float32Array(N*3),life:0,N};
  G.scene.add(G.confetti);
}

export function burstConfetti(team){
  const z = team===0? HALF_L : -HALF_L;
  const pos=G.confetti.geometry.attributes.position.array;
  const col=G.confetti.geometry.attributes.color.array;
  const vel=G.confetti.userData.vel; const c=new THREE.Color();
  const t = team===0?S.homeTeam:S.awayTeam;
  for(let i=0;i<G.confetti.userData.N;i++){
    pos[i*3]= (Math.random()-0.5)*14; pos[i*3+1]=2+Math.random()*4; pos[i*3+2]= z*0.9 + (Math.random()-0.5)*8;
    vel[i*3]=(Math.random()-0.5)*6; vel[i*3+1]=6+Math.random()*8; vel[i*3+2]=(Math.random()-0.5)*6;
    c.set(Math.random()<0.5?t.c1:t.c2); col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
  }
  G.confetti.geometry.attributes.position.needsUpdate=true;
  G.confetti.geometry.attributes.color.needsUpdate=true;
  G.confetti.visible=true; G.confetti.userData.life=2.2;
}

export function updateConfetti(dt){
  if(!G.confetti||!G.confetti.visible) return;
  const pos=G.confetti.geometry.attributes.position.array, vel=G.confetti.userData.vel;
  for(let i=0;i<G.confetti.userData.N;i++){
    vel[i*3+1]-=14*dt;
    pos[i*3]+=vel[i*3]*dt; pos[i*3+1]+=vel[i*3+1]*dt; pos[i*3+2]+=vel[i*3+2]*dt;
  }
  G.confetti.geometry.attributes.position.needsUpdate=true;
  G.confetti.userData.life-=dt;
  if(G.confetti.userData.life<=0) G.confetti.visible=false;
}

export function buildFlashes(){
  const N=260, pos=new Float32Array(N*3), alpha=new Float32Array(N), phase=new Float32Array(N);
  for(let i=0;i<N;i++){
    const lado=(Math.random()*4)|0;
    let x,z;
    if(lado<2){ x=(Math.random()<0.5?-1:1)*(HALF_W+30+Math.random()*18); z=(Math.random()-0.5)*(F.L+20); }
    else      { z=(Math.random()<0.5?-1:1)*(HALF_L+18+Math.random()*20); x=(Math.random()-0.5)*(F.W+26); }
    pos[i*3]=x; pos[i*3+1]=3+Math.random()*11; pos[i*3+2]=z;
    alpha[i]=0; phase[i]=Math.random()*8;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha,1));
  const m=new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    vertexShader:`attribute float alpha; varying float vA;
      void main(){ vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=7.0*(60.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader:`varying float vA;
      void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r=length(d);
      if(r>0.5) discard; gl_FragColor=vec4(1.0,0.97,0.9, vA*(1.0-r*2.0)); }`
  });
  G.flashes=new THREE.Points(g,m);
  G.flashes.userData={N, phase};
  G.scene.add(G.flashes);
}

export function updateCrowd(dt){
  G.crowdT+=dt;
  // destellos de cámaras fotográficas en las gradas
  if(G.flashes){
    const pos=G.flashes.geometry.attributes.position.array;
    const N=G.flashes.userData.N, ph=G.flashes.userData.phase;
    const op=G.flashes.geometry.attributes.alpha;
    for(let i=0;i<N;i++){
      ph[i]-=dt;
      if(ph[i]<=0){ ph[i]=1.5+Math.random()*7; op.array[i]=1; }
      else op.array[i]=Math.max(0, op.array[i]-dt*7);
    }
    op.needsUpdate=true;
  }
}

