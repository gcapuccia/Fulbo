// Modo torneo: liga de todos contra todos entre los ocho equipos.
// Los partidos del usuario se juegan; el resto se simulan por fuerza de plantilla.
import { TEAMS } from '../config/teams.js';
import { activo } from '../core/activo.js';
import { badgeCSS } from '../ui/badge.js';

export const LIGA = { activa:false, jornada:0, calendario:[], tabla:null, ultimos:[] };

export function generarCalendario(ids){
  const n=ids.length, arr=[...ids], rondas=[];
  for(let r=0;r<n-1;r++){
    const jornada=[];
    for(let i=0;i<n/2;i++) jornada.push([arr[i], arr[n-1-i]]);
    rondas.push(jornada);
    arr.splice(1,0,arr.pop());        // método del círculo: rota todos menos el primero
  }
  return rondas;
}

export function crearLiga(){
  LIGA.tabla={};
  TEAMactivo().S.forEach(t=>LIGA.tabla[t.id]={id:t.id,pj:0,g:0,e:0,p:0,gf:0,gc:0,pts:0});
  LIGA.calendario=generarCalendario(TEAMactivo().S.map(t=>t.id));
  LIGA.jornada=0; LIGA.activa=true; LIGA.ultimos=[];
}

export function registrar(idL, idV, gl, gv){
  const L=LIGA.tabla[idL], V=LIGA.tabla[idV];
  L.pj++; V.pj++; L.gf+=gl; L.gc+=gv; V.gf+=gv; V.gc+=gl;
  if(gl>gv){ L.g++; V.p++; L.pts+=3; }
  else if(gl<gv){ V.g++; L.p++; V.pts+=3; }
  else { L.e++; V.e++; L.pts++; V.pts++; }
  LIGA.ultimos.push({idL,idV,gl,gv});
}

export function golesSimulados(fuerza, rival){
  const lam=Math.max(0.18, 1.15 + (fuerza-rival)*0.05);
  let k=0, p=1, L=Math.exp(-lam);
  do { k++; p*=Math.random(); } while(p>L);
  return k-1;
}

export function simularJornada(saltar){
  const j=LIGA.calendario[LIGA.jornada]; if(!j) return;
  for(const [a,b] of j){
    if(saltar && (a===saltar[0]&&b===saltar[1] || a===saltar[1]&&b===saltar[0])) continue;
    const A=TEAMactivo().S.find(t=>t.id===a), B=TEAMactivo().S.find(t=>t.id===b);
    registrar(a,b, golesSimulados(A.ov+3,B.ov), golesSimulados(B.ov,A.ov+3));
  }
}

export function clasificacion(){
  return Object.values(LIGA.tabla).sort((x,y)=>
    y.pts-x.pts || (y.gf-y.gc)-(x.gf-x.gc) || y.gf-x.gf);
}

export function partidoUsuario(){
  const j=LIGA.calendario[LIGA.jornada]; if(!j) return null;
  return j.find(([a,b])=>a===activo().S.homeTeam.id||b===activo().S.homeTeam.id) || null;
}

export function mostrarTorneo(){
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').style.display='none';
  const el=document.getElementById('torneo');
  el.classList.remove('hidden');
  const cuerpo=document.getElementById('tablaBody');
  cuerpo.innerHTML = clasificacion().map((r,i)=>{
    const t=TEAMactivo().S.find(x=>x.id===r.id);
    const yo = r.id===activo().S.homeTeam.id;
    return `<tr class="${yo?'yo':''}">
      <td>${i+1}</td>
      <td><span class="bd" style="background:${badgeCSS(t)}"></span>${t.nombre}</td>
      <td>${r.pj}</td><td>${r.g}</td><td>${r.e}</td><td>${r.p}</td>
      <td>${r.gf}</td><td>${r.gc}</td><td>${r.gf-r.gc>0?'+':''}${r.gf-r.gc}</td>
      <td><b>${r.pts}</b></td></tr>`;
  }).join('');

  // resultados de la jornada anterior
  const res=document.getElementById('ultimos');
  res.innerHTML = LIGA.ultimos.length
    ? '<h4>Última jornada</h4>' + LIGA.ultimos.map(u=>{
        const A=TEAMactivo().S.find(t=>t.id===u.idL), B=TEAMactivo().S.find(t=>t.id===u.idV);
        return `<div class="res"><span>${A.nombre}</span><b>${u.gl} - ${u.gv}</b><span>${B.nombre}</span></div>`;
      }).join('') : '';

  const prox=partidoUsuario();
  const btn=document.getElementById('jugarJornada');
  const info=document.getElementById('proxInfo');
  if(prox && LIGA.jornada < LIGA.calendario.length){
    const rivalId = prox[0]===activo().S.homeTeam.id? prox[1] : prox[0];
    const rival=TEAMactivo().S.find(t=>t.id===rivalId);
    const local = prox[0]===activo().S.homeTeam.id;
    activo().S.awayTeam = rival;
    info.innerHTML=`Jornada ${LIGA.jornada+1} de ${LIGA.calendario.length} ·
      <b>${activo().S.homeTeam.nombre}</b> vs <b>${rival.nombre}</b> ${local?'(local)':'(visitante)'}`;
    btn.style.display=''; btn.textContent='▶ Jugar jornada '+(LIGA.jornada+1);
  } else {
    const campeon=clasificacion()[0];
    info.innerHTML=`<b>Torneo finalizado</b> · Campeón: ${TEAMactivo().S.find(t=>t.id===campeon.id).nombre}`;
    btn.style.display='none';
  }
}

