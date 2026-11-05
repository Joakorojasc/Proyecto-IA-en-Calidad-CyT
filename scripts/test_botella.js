/* Prueba de la botella como unidad: fusión de 2 vistas, emparejamiento y aviso de racha.
 * Uso: node scripts/test_botella.js
 */
require("../frontend/botella.js");
const assert = require("node:assert");
const { fusionar, crearEmparejador, crearVigilante } = globalThis.Botella;

const ve = (f, t) => ({ frontal: { visto: f, confianza: f ? 0.9 : 0 }, trasera: { visto: t, confianza: t ? 0.8 : 0 } });

const pruebas = {
  "OK solo si entre las dos vistas aparecen frontal y trasera"() {
    assert.strictEqual(fusionar({ A: ve(true, false), B: ve(false, true) }).final, "OK");
    assert.strictEqual(fusionar({ A: ve(true, true), B: ve(false, false) }).final, "OK");   // botella de lado: A ve las dos
    const r = fusionar({ A: ve(true, false), B: ve(true, false) });
    assert.strictEqual(r.final, "RECHAZO");
    assert.deepStrictEqual(r.faltan, ["trasera"]);
    assert.match(r.motivo, /trasera/);
  },
  "sin ninguna etiqueta: rechazo indicando las dos"() {
    const r = fusionar({ A: ve(false, false), B: ve(false, false) });
    assert.strictEqual(r.final, "RECHAZO");
    assert.deepStrictEqual(r.faltan, ["frontal", "trasera"]);
  },
  "si una cámara no vio la botella: NO_REVISADA, nunca OK"() {
    const r = fusionar({ A: ve(true, true), B: null });
    assert.strictEqual(r.final, "NO_REVISADA");
    assert.deepStrictEqual(r.sinVer, ["B"]);
  },
  "con una sola estación (espejo) basta su vista"() {
    const e = crearEmparejador({ estaciones: ["A"] });
    const [b] = e.llega("A", ve(true, true), 100);
    assert.strictEqual(b.final, "OK");
  },
  "empareja por orden de llegada con desfase"() {
    const e = crearEmparejador({ ventanaMs: 150, desfaseMs: 175 });
    const salida = [];
    for (let k = 0; k < 100; k++) {
      const t = k * 360, d = 175 + ((k * 37) % 80) - 40;
      salida.push(...e.llega("A", { ...ve(true, false), k }, t));
      salida.push(...e.llega("B", { ...ve(false, true), k }, t + d));
    }
    salida.push(...e.vaciar());
    assert.strictEqual(salida.length, 100);
    assert.ok(salida.every(b => b.final === "OK"));
    assert.ok(salida.every(b => b.lecturas.A.k === b.lecturas.B.k), "no debe cruzar botellas");
    assert.strictEqual(e.stats.vencidas, 0);
  },
  "si B pierde una botella, esa queda NO_REVISADA y las demás no se cruzan"() {
    const e = crearEmparejador({ ventanaMs: 150, desfaseMs: 175 });
    const salida = [];
    for (let k = 0; k < 30; k++) {
      const t = k * 360;
      salida.push(...e.llega("A", { ...ve(true, false), k }, t));
      if (k !== 12) salida.push(...e.llega("B", { ...ve(false, true), k }, t + 175));
    }
    salida.push(...e.vaciar());
    assert.strictEqual(salida.length, 30);
    const nr = salida.filter(b => b.final === "NO_REVISADA");
    assert.strictEqual(nr.length, 1);
    assert.strictEqual(nr[0].lecturas.A.k, 12);
    assert.ok(salida.filter(b => b.final === "OK").every(b => b.lecturas.A.k === b.lecturas.B.k));
  },
  "una lectura de más (duplicado) sale aparte, no se mezcla"() {
    const e = crearEmparejador({ ventanaMs: 100, desfaseMs: 0 });
    const salida = [...e.llega("A", ve(true, true), 0), ...e.llega("B", ve(true, true), 10), ...e.llega("B", ve(true, true), 30)];
    salida.push(...e.vaciar());
    assert.strictEqual(salida.length, 2);
    assert.strictEqual(salida.filter(b => b.final === "NO_REVISADA").length, 1);
  },
  "aviso de racha a los 3 rechazos seguidos, una sola vez por racha"() {
    const v = crearVigilante({ racha: 3 });
    const avisos = ["RECHAZO", "RECHAZO", "RECHAZO", "RECHAZO", "OK", "NO_REVISADA", "RECHAZO", "RECHAZO"].map(f => v.botella(f).avisoNuevo);
    assert.deepStrictEqual(avisos, [false, false, true, false, false, false, false, true]);
  },
};

let fallas = 0;
for (const [nombre, f] of Object.entries(pruebas)) {
  try { f(); console.log("ok   ", nombre); }
  catch (e) { fallas++; console.log("FALLA", nombre, "->", e.message); }
}
process.exit(fallas ? 1 : 0);
