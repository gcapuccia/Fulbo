// Equipos y jugadores inventados de la Superliga Estelar.
export const TEAMS = [
  { id:'rel', nombre:'Relámpago FC',    ciudad:'Ciudad Trueno',  c1:'#f9d423', c2:'#0b0b0b', ov:88 },
  { id:'tor', nombre:'Toros Rojos',     ciudad:'Valle Bravo',    c1:'#d33636', c2:'#ffffff', ov:86 },
  { id:'oce', nombre:'Océano United',   ciudad:'Puerto Azul',    c1:'#1e6fd6', c2:'#8fd3ff', ov:85 },
  { id:'ver', nombre:'Verde Valle',     ciudad:'Monteverde',     c1:'#2ecc71', c2:'#0a3d20', ov:83 },
  { id:'fen', nombre:'Fénix Capital',   ciudad:'Solaria',        c1:'#ff7b1c', c2:'#5b2a86', ov:87 },
  { id:'som', nombre:'Sombra Nocturna', ciudad:'Nébula',         c1:'#22252b', c2:'#c0c6d0', ov:84 },
  { id:'hie', nombre:'Hielo Polar',     ciudad:'Aurora Norte',   c1:'#e8f4ff', c2:'#2b8fcd', ov:82 },
  { id:'vol', nombre:'Volcán CF',       ciudad:'Caldera',        c1:'#e2402b', c2:'#f4a11e', ov:85 },
].map(t=>({...t, c2:t.c2.replace(' ','')}));

export const NOMBRES = ['Marco Vela','Rui Sancho','Iker Bravo','Dídac Roca','Nino Sala','Teo Márquez','Aldo Rey',
  'Zé Pinto','Luca Ferri','Omar Díaz','Beni Cruz','Pol Serra','Cai Moreno','Dario Lem','Kian Roso','Vito Nardo',
  'Samu Prat','Enzo Gil','Bruno Sanz','Nael Cid','Toni Vera','Rafa Osu','Malik Ndo','Yago Peña'];
