// Formaciones: coordenadas relativas (x lateral -1..1, z profundidad 0 propia .. 1 rival)
export const FORMACIONES = {
  '4-3-3': [
    {r:'POR', x:0.0,  z:0.03},
    {r:'DEF', x:-0.62,z:0.20},{r:'DEF', x:-0.22,z:0.16},{r:'DEF', x:0.22,z:0.16},{r:'DEF', x:0.62,z:0.20},
    {r:'MED', x:-0.40,z:0.42},{r:'MED', x:0.0,  z:0.38},{r:'MED', x:0.40,z:0.42},
    {r:'DEL', x:-0.55,z:0.66},{r:'DEL', x:0.0,  z:0.72},{r:'DEL', x:0.55,z:0.66},
  ],
  '4-4-2': [
    {r:'POR', x:0.0,  z:0.03},
    {r:'DEF', x:-0.62,z:0.19},{r:'DEF', x:-0.22,z:0.15},{r:'DEF', x:0.22,z:0.15},{r:'DEF', x:0.62,z:0.19},
    {r:'MED', x:-0.62,z:0.44},{r:'MED', x:-0.20,z:0.40},{r:'MED', x:0.20,z:0.40},{r:'MED', x:0.62,z:0.44},
    {r:'DEL', x:-0.22,z:0.70},{r:'DEL', x:0.22,z:0.70},
  ],
  '3-5-2': [
    {r:'POR', x:0.0,  z:0.03},
    {r:'DEF', x:-0.38,z:0.17},{r:'DEF', x:0.0,  z:0.14},{r:'DEF', x:0.38,z:0.17},
    {r:'MED', x:-0.72,z:0.46},{r:'MED', x:-0.30,z:0.40},{r:'MED', x:0.0,z:0.34},
    {r:'MED', x:0.30,z:0.40},{r:'MED', x:0.72,z:0.46},
    {r:'DEL', x:-0.22,z:0.72},{r:'DEL', x:0.22,z:0.72},
  ],
  '5-3-2': [
    {r:'POR', x:0.0,  z:0.03},
    {r:'DEF', x:-0.75,z:0.20},{r:'DEF', x:-0.38,z:0.14},{r:'DEF', x:0.0,z:0.12},
    {r:'DEF', x:0.38,z:0.14},{r:'DEF', x:0.75,z:0.20},
    {r:'MED', x:-0.40,z:0.42},{r:'MED', x:0.0,  z:0.38},{r:'MED', x:0.40,z:0.42},
    {r:'DEL', x:-0.22,z:0.68},{r:'DEL', x:0.22,z:0.68},
  ],
};
export const NOMBRES_FORM = Object.keys(FORMACIONES);
export const FORMATION = FORMACIONES['4-3-3'];   // por defecto
