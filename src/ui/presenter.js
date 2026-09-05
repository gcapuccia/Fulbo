// PRESENTADOR — traduce los eventos del partido en imagen y sonido.
//
// Es el único lugar que reacciona a lo que ocurre en el campo. El núcleo se
// limita a anotar "hubo un gol del equipo 0"; decidir que eso significa un
// cartel, confeti, un silbato y una ovación es cosa de aquí.
export function crearPresentador(dep){
  const { announce, updateScorebug, updateCardsUI, burstConfetti,
          playWhistle, playKick, crowdCheer, mostrarTarjeta, teamName, nombreGoleador } = dep;

  return function presentar(eventos){
    for(const e of eventos){
      switch(e.tipo){

        case 'GOL':
          updateScorebug();
          announce('¡GOOOL!', `${teamName(e.team)} — ${nombreGoleador(e.team, e.scorerIdx)}`);
          burstConfetti(e.team);
          playWhistle(2);
          crowdCheer();
          break;

        case 'SAQUE':                    // banda, córner, saque de puerta, falta, penal
          announce(e.etiqueta, teamName(e.team));
          playWhistle(1);
          break;

        case 'PATADA':
          playKick();
          break;

        case 'ATAJADA':                  // la palomita la dibuja la vista; aquí ruge la grada
          crowdCheer();
          break;

        case 'TARJETA':
          mostrarTarjeta(e.card);
          updateCardsUI();
          announce(e.card.startsWith('roja') ? '¡TARJETA ROJA!' : 'TARJETA AMARILLA', '');
          break;

        case 'FALTA':
          announce('FALTA', '');
          break;

        case 'FUERA_DE_JUEGO':
          announce('FUERA DE JUEGO', teamName(e.contra));
          break;

        case 'DESCANSO':
          announce('DESCANSO', '2do tiempo');
          playWhistle(1);
          break;

        case 'FINAL':
          announce('FINAL', e.texto);
          playWhistle(3);
          break;

        case 'FORMACION':
          announce('FORMACIÓN', e.nombre);
          break;
      }
    }
  };
}
