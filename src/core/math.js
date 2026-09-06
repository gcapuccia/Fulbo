// Vector 3D del núcleo de simulación.
//
// Es un reemplazo directo de THREE.Vector3 para el estado autoritativo
// (posición y velocidad de jugadores y balón). ¿Por qué no usar el de Three?
// Porque el servidor no puede importar Three: el núcleo tiene que correr
// headless en Node. La API es la misma, así que ambos tipos interoperan
// mientras dure la migración (los dos son {x, y, z}).
export class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }

  set(x, y, z)        { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(v)        { this.x = v; this.y = v; this.z = v; return this; }
  copy(v)             { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone()             { return new Vec3(this.x, this.y, this.z); }

  add(v)              { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v)              { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addVectors(a, b)    { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  subVectors(a, b)    { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  multiplyScalar(s)   { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s)     { return this.multiplyScalar(1 / s); }
  negate()            { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }

  lengthSq()          { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length()            { return Math.sqrt(this.lengthSq()); }
  normalize()         { const l = this.length(); return l ? this.divideScalar(l) : this; }
  setLength(l)        { return this.normalize().multiplyScalar(l); }
  dot(v)              { return this.x * v.x + this.y * v.y + this.z * v.z; }

  lerp(v, a)          { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a;
                        this.z += (v.z - this.z) * a; return this; }

  distanceToSquared(v){ const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
                        return dx * dx + dy * dy + dz * dz; }
  distanceTo(v)       { return Math.sqrt(this.distanceToSquared(v)); }

  toArray()           { return [this.x, this.y, this.z]; }
  fromArray(a, o = 0) { this.x = a[o]; this.y = a[o+1]; this.z = a[o+2]; return this; }
}

// Vector de dos componentes para las entradas (stick / teclas). Antes el
// estado de cada asiento guardaba un THREE.Vector2: el asiento es dato de
// partido y viaja por la red, así que no puede depender del motor de dibujo.
export class Vec2 {
  constructor(x = 0, y = 0){ this.x = x; this.y = y; }
  set(x, y){ this.x = x; this.y = y; return this; }
  length(){ return Math.hypot(this.x, this.y); }
  clone(){ return new Vec2(this.x, this.y); }
}
