// TRANSPORTE — la única parte del cliente que sabe que existe una red.
//
// Todo lo demás (la sesión, el render, la UI) habla con esta interfaz. Si
// algún día el transporte pasa a WebRTC, a Colyseus o a otra cosa, se cambia
// este archivo y nada más. Usa el WebSocket nativo del navegador: el cliente
// no gana ni una dependencia por jugar online.
export function crearTransporte(url){
  let ws = null, abierto = false;
  const oyentes = new Map();          // tipo -> [callback]
  const cola = [];                    // mensajes pedidos antes de conectar

  const emitirLocal = (tipo, msg) => {
    for(const cb of (oyentes.get(tipo) || [])) cb(msg);
    for(const cb of (oyentes.get('*') || [])) cb(msg);
  };

  return {
    get abierto(){ return abierto; },
    get url(){ return url; },

    conectar(){
      return new Promise((resolver, rechazar) => {
        try { ws = new WebSocket(url); }
        catch(e){ return rechazar(e); }
        ws.onopen = () => {
          abierto = true;
          while(cola.length) ws.send(cola.shift());
          resolver();
        };
        ws.onmessage = ev => {
          let msg; try { msg = JSON.parse(ev.data); } catch { return; }
          emitirLocal(msg.t, msg);
        };
        ws.onclose = () => { abierto = false; emitirLocal('_cerrado', {}); };
        ws.onerror = () => { if(!abierto) rechazar(new Error('no se pudo conectar')); };
      });
    },

    enviar(t, datos = {}){
      const bruto = JSON.stringify({ t, ...datos });
      if(abierto && ws.readyState === 1) ws.send(bruto);
      else if(cola.length < 32) cola.push(bruto);
    },

    al(tipo, cb){
      if(!oyentes.has(tipo)) oyentes.set(tipo, []);
      oyentes.get(tipo).push(cb);
      return this;
    },

    cerrar(){ if(ws) ws.close(); abierto = false; },
  };
}
