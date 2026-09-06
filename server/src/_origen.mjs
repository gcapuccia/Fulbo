import WebSocket from 'ws';
const URL = process.env.URL || 'ws://localhost:2600';
const probar = (origin) => new Promise(res => {
  const ws = new WebSocket(URL, origin ? { origin } : {});
  const t = setTimeout(() => { ws.terminate(); res('sin respuesta'); }, 2500);
  ws.on('open',  () => { clearTimeout(t); ws.close(); res('ACEPTADO'); });
  ws.on('error', e => { clearTimeout(t); res('RECHAZADO (' + (e.message.match(/\d{3}/)||['?'])[0] + ')'); });
});
console.log('origen permitido  :', await probar('https://fulbo-ar.vercel.app'));
console.log('origen desconocido:', await probar('https://sitio-ajeno.example'));
console.log('sin origen        :', await probar(null));
process.exit(0);
