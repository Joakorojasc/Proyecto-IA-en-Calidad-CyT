/* Prueba del vigilante de cámara sin cámara ni navegador: cuadros simulados en gris.
 * Lo más importante: con la línea simulada funcionando normal (fallas de etiqueta, fotos movidas, cambios de luz)
 * no debe haber ninguna falsa alarma de cámara ciega.
 * Uso: node scripts/test_salud.js [minutos de línea simulada=3]
 */
require("../frontend/motor.js");
require("../frontend/disparo.js");
require("../frontend/simulacion.js");
require("../frontend/salud.js");
const assert = require("node:assert");
const { Salud, Disparo, Simulacion: S } = globalThis;

const W = 160, H = 220, MS = 1000 / 30, MIN = +process.argv[2] || 3;

/** Fondo con textura de varios tamaños (manchas grandes y detalle fino), fijo para toda la prueba. */
function textura(w, h, semilla = 11) {
  const r = S.azar(semilla), t = new Float32Array(w * h), grande = new Float32Array(Math.ceil(w / 8) * Math.ceil(h / 8));
  for (let i = 0; i < grande.length; i++) grande[i] = r() * 60 - 30;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    t[y * w + x] = 120 + grande[(y >> 3) * Math.ceil(w / 8) + (x >> 3)] + (r() * 30 - 15);
  return t;
}
const FONDO = textura(W, H);

/** Cuadro de cámara: escena + brillo + ruido de sensor (siempre cambia algo). dx corre la cámara. */
function cuadro(r, { escena = FONDO, brillo = 0, dx = 0, borroso = 0 } = {}) {
  let base = escena;
  if (dx) { base = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) base[y * W + x] = escena[y * W + Math.min(W - 1, Math.max(0, x + dx))]; }
  if (borroso) base = desenfocar(base, borroso);
  const g = new Uint8ClampedArray(W * H);
  for (let i = 0; i < g.length; i++) g[i] = base[i] + brillo + (r() * 8 - 4);
  return g;
}

/** Desenfoque de caja (promedio de un cuadrado de lado 2·rad+1), como un lente fuera de foco. */
function desenfocar(img, rad, w = W, h = H) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += img[y * w + xx]; n++; } } tmp[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, n = 0; for (let k = -rad; k <= rad; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } } out[y * w + x] = s / n; }
  return out;
}
const lleno = (v, r) => Uint8ClampedArray.from({ length: W * H }, () => v + (r ? r() * 8 - 4 : 0));

/** Corre tramos [{ ms, f(r, t) -> { g } | null (sin imagen), libre }] y junta los eventos. */
function correr(tramos, m = Salud.crear(), semilla = 1) {
  const r = S.azar(semilla), eventos = [];
  let t = 0, ultimo = null;
  for (const tr of tramos) {
    const fin = t + tr.ms;
    for (; t < fin; t += MS) {
      const q = tr.f(r, t);
      ultimo = q ? m.cuadro(q, W, H, t, { libre: tr.libre ?? true }) : m.sinImagen(t);
      if (ultimo.cambio) eventos.push({ t, ...ultimo });
    }
  }
  return { eventos, ciegas: eventos.filter(e => e.cambio === "ciega"), ultimo, m, t };
}
const normal = { ms: 5000, f: r => cuadro(r) };

const pruebas = {
  "1. cuadros normales con textura y ruido: nunca ciega"() {
    const { ciegas, ultimo } = correr([{ ms: 30000, f: r => cuadro(r) }]);
    assert.strictEqual(ciegas.length, 0, `alarmas: ${ciegas.map(e => e.causa)}`);
    assert.strictEqual(ultimo.nivel, "ok");
  },
  "2. negro: ciega 'oscura' tras ~2 s (no antes) y luego 'recuperada' con su duración"() {
    const { eventos, ciegas } = correr([normal, { ms: 5000, f: r => lleno(4, r) }, normal]);
    assert.strictEqual(ciegas.length, 1);
    assert.strictEqual(ciegas[0].causa, "oscura");
    const tarda = ciegas[0].t - 5000;
    assert.ok(tarda >= 2000 && tarda < 2100, `tardó ${tarda.toFixed(0)} ms`);
    const rec = eventos.find(e => e.cambio === "recuperada");
    assert.ok(rec, "debería recuperarse");
    assert.ok(rec.t - 10000 >= 1500 && rec.t - 10000 < 1600, `se recuperó a los ${(rec.t - 10000).toFixed(0)} ms`);
    assert.ok(Math.abs(rec.duracionMs - 5000) < 100, `duración ${rec.duracionMs}`);
    assert.ok(Math.abs(ciegas[0].desde - 5000) < 50, "desde debe marcar cuando se puso negra");
  },
  "2b. un tapón corto (1 s) no alcanza a alarmar"() {
    assert.strictEqual(correr([normal, { ms: 1000, f: r => lleno(4, r) }, normal]).ciegas.length, 0);
  },
  "3. saturada: ciega 'quemada'"() {
    const { ciegas } = correr([normal, { ms: 4000, f: r => lleno(253, r) }]);
    assert.deepStrictEqual(ciegas.map(e => e.causa), ["quemada"]);
  },
  "4. el mismo cuadro por más de 3 s: 'congelada'"() {
    let fijo = null;
    const { ciegas } = correr([normal, { ms: 5000, f: r => (fijo ||= cuadro(r)) }]);
    assert.deepStrictEqual(ciegas.map(e => e.causa), ["congelada"]);
    assert.ok(ciegas[0].t - 5000 >= 3000 && ciegas[0].t - 5000 < 3100, `tardó ${(ciegas[0].t - 5000).toFixed(0)} ms`);
  },
  "4b. cada cuadro repetido 2 veces (la página pinta más rápido que la cámara): no es congelada"() {
    let c = 0, q = null;
    assert.strictEqual(correr([{ ms: 30000, f: r => (c++ % 2 ? q : (q = cuadro(r))) }]).ciegas.length, 0);
  },
  "5. imagen borrosa sostenida: 'desenfocada'"() {
    const { ciegas } = correr([normal, { ms: 6000, f: r => cuadro(r, { borroso: 4 }) }]);
    assert.deepStrictEqual(ciegas.map(e => e.causa), ["desenfocada"]);
  },
  "6. cámara corrida 6 px con la franja libre: 'posicion'"() {
    const { ciegas } = correr([normal, { ms: 4000, f: r => cuadro(r, { dx: 6 }) }]);
    assert.deepStrictEqual(ciegas.map(e => e.causa), ["posicion"]);
  },
  "6b. otra escena con la franja libre: 'posicion'"() {
    const otra = textura(W, H, 99);
    const { ciegas } = correr([normal, { ms: 4000, f: r => cuadro(r, { escena: otra }) }]);
    assert.deepStrictEqual(ciegas.map(e => e.causa), ["posicion"]);
  },
  "6c. otra escena pero con botella en la franja (libre=false): nada"() {
    const otra = textura(W, H, 99);
    assert.strictEqual(correr([normal, { ms: 6000, libre: false, f: r => cuadro(r, { escena: otra }) }, normal]).ciegas.length, 0);
  },
  "7. cambio de luz gradual (±30 en 20 s): nada"() {
    const brillo = t => t < 5000 ? 0 : t < 15000 ? 30 * (t - 5000) / 10000 : 30 - 60 * (t - 15000) / 10000;
    assert.strictEqual(correr([{ ms: 25000, f: (r, t) => cuadro(r, { brillo: brillo(t) }) }]).ciegas.length, 0);
  },
  "8. sin imagen desde el inicio: no conectada, no ciega"() {
    const { ciegas, ultimo } = correr([{ ms: 10000, f: () => null }]);
    assert.strictEqual(ciegas.length, 0);
    assert.strictEqual(ultimo.nivel, "aprendiendo");
  },
  "8b. deja de entregar imagen después de funcionar: 'sin_imagen' tras confirmar"() {
    const { ciegas, eventos } = correr([normal, { ms: 3000, f: () => null }, normal]);
    assert.deepStrictEqual(ciegas.map(e => e.causa), ["sin_imagen"]);
    assert.ok(ciegas[0].t - 5000 >= 2000 && ciegas[0].t - 5000 < 2100);
    assert.ok(eventos.some(e => e.cambio === "recuperada"));
  },
  "9. fotos movidas: aviso con 12 de 20 y fin del aviso al bajar"() {
    const m = Salud.crear();
    correr([normal], m);
    const res = [];
    for (let i = 0; i < 20; i++) res.push(m.lectura(i % 5 < 3, 6000 + i * 360));   // 12 de 20 movidas
    const aviso = res.filter(r => r.cambio === "aviso");
    assert.strictEqual(aviso.length, 1, "un solo aviso");
    assert.strictEqual(res[19].nivel, "aviso");
    assert.strictEqual(res[19].causa, "fotos_movidas");
    const fin = [];
    for (let i = 0; i < 20; i++) fin.push(m.lectura(false, 20000 + i * 360));
    assert.strictEqual(fin.filter(r => r.cambio === "fin_aviso").length, 1);
    assert.strictEqual(m.estado.nivel, "ok");
  },
  "9b. un aviso no tapa una cámara ciega"() {
    const m = Salud.crear();
    correr([normal], m);
    for (let i = 0; i < 20; i++) m.lectura(true, 5000 + i);
    const { ultimo } = correr([normal, { ms: 4000, f: r => lleno(2, r) }], m);
    assert.strictEqual(ultimo.nivel, "ciega");
  },
  "9c. reiniciar vuelve a aprender"() {
    const m = Salud.crear();
    correr([normal], m);
    m.reiniciar();
    assert.strictEqual(m.cuadro(cuadro(S.azar(3)), W, H, 0, { libre: true }).nivel, "aprendiendo");
  },
};

/** La línea simulada a 30 cuadros/s, con libre tomado del disparo. fondoTexturado: el fondo tiene textura (prueba la posición). */
function linea({ minutos = MIN, semilla = 1, fondoTexturado = false, paradaDesdeMs = null, falla = null, fallaDesdeMs = Infinity } = {}) {
  const escena = S.crearEscena({ semilla, linea: { pRacha: 0.01, pSuelta: 0.02 } });
  const { w, h } = escena.opciones;
  const roi = { x: Math.round(w * 0.25), y: Math.round(h * 0.15), w: Math.round(w * 0.5), h: Math.round(h * 0.7) };
  const tex = fondoTexturado ? textura(w, h, semilla + 5) : null, rFondo = S.azar(semilla * 7 + 1);
  const disparo = Disparo.crearNucleo(), salud = Salud.crear();
  const eventos = [], niveles = {};
  let ms = 0, cuadros = 0, lecturas = 0, movidas = 0;
  for (let t = 0; t <= minutos * 60000; t += MS) {
    let { g } = paradaDesdeMs !== null && t >= paradaDesdeMs ? { g: S.cuadro(w, h, [], rFondo) } : escena.cuadro("A", t);
    if (tex) for (let y = 0; y < h; y++) {          // textura solo donde se ve el fondo
      const base = 176 + 14 * (y / h);
      for (let x = 0; x < w; x++) { const i = y * w + x; if (Math.abs(g[i] - base) < 12) g[i] = tex[i] + (g[i] - base) + 60; }
    }
    // falla de cámara a propósito, para ver que con la línea corriendo sí se detecta
    const dx = falla === "corrida" && t >= fallaDesdeMs ? 10 : 0;
    if (falla === "borrosa" && t >= fallaDesdeMs) g = Uint8ClampedArray.from(desenfocar(Float32Array.from(g), 4, w, h), v => v + rFondo() * 8 - 4);   // el ruido del sensor no se desenfoca
    const rec = new Uint8ClampedArray(roi.w * roi.h);
    for (let y = 0; y < roi.h; y++) rec.set(g.subarray((roi.y + y) * w + roi.x + dx, (roi.y + y) * w + roi.x + dx + roi.w), y * roi.w);
    // Si la cámara se corre, el disparo ve todo distinto y queda "ocupada" (no hay cuadros libres para comparar).
    // Aquí el disparo reaprende su fondo justo al golpe, como cuando lo detecta como cambio de luz; el vigilante no se reinicia.
    if (falla === "corrida" && t >= fallaDesdeMs && t - MS < fallaDesdeMs) disparo.reiniciar();
    const d = disparo.procesar(rec, roi.w, roi.h, t);
    const t0 = performance.now();
    let s = salud.cuadro(rec, roi.w, roi.h, t, { libre: d.estado === "libre" });
    ms += performance.now() - t0; cuadros++;
    if (s.cambio) eventos.push({ t, ...s });
    if (d.evento === "botella") {
      // la botella que acaba de pasar es la más antigua que llegó y aún no se contó; su foto sale movida si la simulación la movió
      const b = escena.llegadas(t).find(x => !x.contada);
      const movida = !!(b && b.movido);
      if (b) b.contada = true;
      lecturas++; if (movida) movidas++;
      s = salud.lectura(movida, t);
      if (s.cambio) eventos.push({ t, ...s });
    }
    niveles[s.nivel] = (niveles[s.nivel] || 0) + 1;
  }
  return { eventos, ciegas: eventos.filter(e => e.cambio === "ciega"), avisos: eventos.filter(e => e.cambio === "aviso"), msPorCuadro: ms / cuadros, cuadros, lecturas, movidas, niveles, roi };
}

let fallas = 0;
const revisar = (nombre, f) => { try { f(); console.log("ok   ", nombre); } catch (e) { fallas++; console.log("FALLA", nombre, "->", e.message); } };
for (const [nombre, f] of Object.entries(pruebas)) revisar(nombre, f);

const resumen = [];
for (const [nombre, op] of [
  ["fondo liso", { semilla: 1 }],
  ["fondo con textura", { semilla: 2, fondoTexturado: true }],
  ["fondo con textura, línea detenida a la mitad", { semilla: 3, fondoTexturado: true, paradaDesdeMs: MIN * 30000 }],
  ["fondo liso, línea detenida a la mitad", { semilla: 4, paradaDesdeMs: MIN * 30000 }],
]) {
  const r = linea(op);
  resumen.push(r);
  console.log(`\n  Línea simulada (${nombre}): ${MIN} min, ${r.cuadros} cuadros de ${r.roi.w}x${r.roi.h}, ${r.lecturas} botellas (${r.movidas} movidas).`);
  console.log(`    Alarmas de ciega: ${r.ciegas.length}${r.ciegas.length ? " (" + r.ciegas.map(e => `${e.causa} a los ${(e.t / 1000).toFixed(1)} s`).join(", ") + ")" : ""} · avisos: ${r.avisos.length} · ${r.msPorCuadro.toFixed(3)} ms por cuadro`);
  console.log(`    Cuadros por nivel: ${JSON.stringify(r.niveles)}`);
  revisar(`10. línea simulada (${nombre}): 0 falsas alarmas de ciega`, () => assert.strictEqual(r.ciegas.length, 0, r.ciegas.map(e => e.causa).join(", ")));
}

// con la línea corriendo, una falla real de cámara sí se detecta (si el fondo tiene textura)
for (const [falla, causa] of [["corrida", "posicion"], ["borrosa", "desenfocada"]]) {
  const r = linea({ minutos: 1, semilla: 5, fondoTexturado: true, falla, fallaDesdeMs: 30000 });
  const tarda = r.ciegas.length ? ((r.ciegas[0].t - 30000) / 1000).toFixed(1) : "-";
  console.log(`\n  Línea simulada con cámara ${falla} a los 30 s: alarmas ${r.ciegas.map(e => e.causa).join(", ") || "ninguna"} (a los ${tarda} s de la falla).`);
  revisar(`10b. línea corriendo y cámara ${falla}: '${causa}' (y nada antes)`, () => {
    assert.ok(r.ciegas.length >= 1 && r.ciegas[0].causa === causa, r.ciegas.map(e => e.causa).join(", ") || "sin alarma");
    assert.ok(r.ciegas[0].t >= 30000 && r.ciegas[0].t < 36000, `a los ${r.ciegas[0].t} ms`);
  });
}
revisar("11. liviano: menos de 1 ms por cuadro en promedio", () => {
  // además de la línea simulada, el peor caso: 160x220 con la franja siempre libre (nitidez y plantilla en cada vuelta)
  const m = Salud.crear(), r = S.azar(8), lista = Array.from({ length: 30 }, () => cuadro(r));
  let ms = 0;
  for (let c = 0; c < 3000; c++) { const t0 = performance.now(); m.cuadro(lista[c % 30], W, H, c * MS, { libre: true }); ms += performance.now() - t0; }
  console.log(`\n  Tiempo por cuadro: ${(ms / 3000).toFixed(3)} ms en ${W}x${H} con franja libre; ${Math.max(...resumen.map(x => x.msPorCuadro)).toFixed(3)} ms en la línea simulada.`);
  const peor = Math.max(ms / 3000, ...resumen.map(x => x.msPorCuadro));
  assert.ok(peor < 1, `${peor.toFixed(3)} ms por cuadro`);
});
console.log(`\n${fallas ? fallas + " pruebas fallaron" : "todas las pruebas pasaron"}`);
process.exit(fallas ? 1 : 0);
