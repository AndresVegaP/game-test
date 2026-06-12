#!/usr/bin/env node
// Verifica que los niveles de index.html sean ganables.
//
// Modela los alcances de salto de forma CONSERVADORA respecto a la física
// real del juego (JUMP=-13, GRAV=0.55, MAXVX=4.4, TILE=40):
//   - altura máx. de salto real: 13^2/(2*0.55) ≈ 153px (3.8 tiles)
//   - alcance horizontal real:   ~207px en plano (5.2 tiles)
// Reglas del modelo (centro a centro, en tiles):
//   subir 1-2 tiles  -> dx <= 4
//   subir 3 tiles    -> dx <= 2
//   mismo nivel      -> dx <= 4
//   bajar            -> dx <= 5
// Si el BFS alcanza la bandera y todas las estrellas con estas reglas,
// el juego real (más capaz) también puede.

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = html.match(/const LEVELS = (\[[\s\S]*?\n\]);/);
if (!m) { console.error('No se encontró LEVELS en index.html'); process.exit(1); }
const LEVELS = eval(m[1]); // solo literales

let failed = false;
function fail(msg) { console.error('  ✗ ' + msg); failed = true; }
function ok(msg) { console.log('  ✓ ' + msg); }

for (const L of LEVELS) {
  console.log(`\n— ${L.name}`);
  const map = L.map;
  const rows = map.length, cols = map[0].length;

  // 1) Todas las filas con el mismo ancho y chars válidos
  const valid = new Set([' ', '#', '=', '*', '^', 'e', 'P', 'F']);
  map.forEach((row, r) => {
    if (row.length !== cols) fail(`fila ${r} mide ${row.length}, esperado ${cols}`);
    for (const ch of row) if (!valid.has(ch)) fail(`fila ${r}: char inválido '${ch}'`);
  });

  const at = (c, r) => (r < 0 || r >= rows || c < 0 || c >= cols) ? ' ' : map[r][c];
  const solid = (c, r) => at(c, r) === '#' || at(c, r) === '=';
  const spike = (c, r) => at(c, r) === '^';

  // 2) P y F existen; cada 'e' y 'F' tiene piso directamente debajo
  let P = null, F = null, starsList = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = at(c, r);
    if (ch === 'P') P = { c, r };
    if (ch === 'F') F = { c, r };
    if (ch === '*') starsList.push({ c, r });
    if (ch === 'e' && !solid(c, r + 1)) fail(`enemigo en (${c},${r}) sin piso debajo`);
  }
  if (!P) { fail('falta P'); continue; }
  if (!F) { fail('falta F'); continue; }
  if (!solid(F.c, F.r + 1)) fail(`bandera en (${F.c},${F.r}) sin piso debajo`);

  // 3) Celdas "de pie": vacías (no pincho), con sólido debajo
  const standable = (c, r) => !solid(c, r) && !spike(c, r) && solid(c, r + 1);

  // Caída desde una columna: primera celda de pie hacia abajo; null si
  // cae en pinchos o al vacío
  function dropFrom(c, r) {
    for (let r2 = r; r2 < rows; r2++) {
      if (spike(c, r2)) return null;
      if (solid(c, r2)) return null;       // no debería pasar (dentro de muro)
      if (solid(c, r2 + 1)) return spike(c, r2) ? null : { c, r: r2 };
    }
    return null; // abismo
  }

  // 4) BFS de alcanzabilidad
  const start = dropFrom(P.c, P.r);
  if (!start) { fail('el punto de partida P no cae sobre piso seguro'); continue; }

  const key = (c, r) => c + ',' + r;
  const seen = new Set([key(start.c, start.r)]);
  const queue = [start];
  const reach = [];
  while (queue.length) {
    const cur = queue.shift();
    reach.push(cur);
    const moves = [];
    // caminar / caer por el borde
    for (const dc of [-1, 1]) {
      const nc = cur.c + dc;
      if (solid(nc, cur.r)) continue; // pared
      if (standable(nc, cur.r)) moves.push({ c: nc, r: cur.r });
      else {
        const d = dropFrom(nc, cur.r);
        if (d) moves.push(d);
      }
    }
    // saltos a cualquier celda de pie dentro del alcance del modelo
    for (let r2 = 0; r2 < rows; r2++) for (let c2 = 0; c2 < cols; c2++) {
      if (!standable(c2, r2)) continue;
      const rise = cur.r - r2, dx = Math.abs(c2 - cur.c);
      if (dx === 0 && rise === 0) continue;
      const okJump =
        (rise <= 0 && dx <= 5) ||          // bajar o plano
        (rise >= 1 && rise <= 2 && dx <= 4) ||
        (rise === 3 && dx <= 2);
      if (rise === 0 && dx > 4) continue;
      if (okJump && (rise !== 0 || dx <= 4)) {
        moves.push({ c: c2, r: r2 });
      }
    }
    for (const mv of moves) {
      const k = key(mv.c, mv.r);
      if (!seen.has(k)) { seen.add(k); queue.push(mv); }
    }
  }

  // 5) Bandera alcanzable (zona de activación generosa: ±1 col, ±2 filas)
  const flagOk = reach.some(s => Math.abs(s.c - F.c) <= 1 && Math.abs(s.r - F.r) <= 2);
  if (flagOk) ok(`bandera alcanzable (${reach.length} posiciones accesibles)`);
  else fail('LA BANDERA NO ES ALCANZABLE');

  // 6) Todas las estrellas alcanzables (de pie en la celda o saltando
  //    desde <=3 filas más abajo, ±1 col)
  for (const s of starsList) {
    const sOk = reach.some(p2 => Math.abs(p2.c - s.c) <= 1 && p2.r - s.r >= 0 && p2.r - s.r <= 3);
    if (!sOk) fail(`estrella en (${s.c},${s.r}) inalcanzable`);
  }
  if (!failed) ok(`${starsList.length} estrellas alcanzables`);
}

console.log(failed ? '\n✗ VALIDACIÓN FALLIDA' : '\n✓ Todos los niveles son ganables');
process.exit(failed ? 1 : 0);
