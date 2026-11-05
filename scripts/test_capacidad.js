/* Prueba de capacidad: la línea a 10.000 botellas por hora (una cada 360 ms) vista por 2 cámaras simuladas.
 * Cada cámara entrega cuadros a 30 por segundo; cada una pasa por su disparo automático (fotocelda virtual),
 * el detector revisa el mejor cuadro de cada botella y el emparejador junta las dos vistas.
 * Reporta: botellas contadas contra reales, duplicados, emparejamientos fallidos, tiempo por botella y cuadros perdidos.
 *
 * Dos escenarios:
 *   1. cámaras que entregan todos sus cuadros: el conteo tiene que ser exacto.
 *   2. cámaras que pierden el 1 % de los cuadros (USB cargado): si se pierde una botella, tiene que quedar
 *      NO REVISADA (rechazo), nunca aprobada ni cruzada con otra.
 * Uso: node scripts/test_capacidad.js [minutos=10] [botellas por hora=10000]
 */
require("../frontend/motor.js");
require("../frontend/disparo.js");
require("../frontend/simulacion.js");
require("../frontend/botella.js");
const assert = require("node:assert");
const { Motor, Disparo, Simulacion: S, Botella } = globalThis;

const MIN = +process.argv[2] || 10, POR_HORA = +process.argv[3] || 10000, FPS = 30;

function correr(perdida, semilla) {
  const escena = S.crearEscena({ porHora: POR_HORA, semilla, linea: { pRacha: 0.01, pSuelta: 0.02 } });
  const { w, h } = escena.opciones;
  const cal = Motor.calibrarTipos(S.referencias(escena.tex));
  const roi = { x: Math.round(w * 0.25), y: Math.round(h * 0.15), w: Math.round(w * 0.5), h: Math.round(h * 0.7) };
  const emp = Botella.crearEmparejador({ ventanaMs: 150, desfaseMs: escena.opciones.desfaseMs });
  const azarPerdida = S.azar(semilla * 13 + 77);
  const est = {};
  for (const cam of ["A", "B"]) est[cam] = { nucleo: Disparo.crearNucleo(), mejor: null, lecturas: [], perdidos: 0, cuadros: 0, msDisparo: 0, msDetector: 0 };
  const recortar = g => {
    const out = new Uint8ClampedArray(roi.w * roi.h);
    for (let y = 0; y < roi.h; y++) out.set(g.subarray((roi.y + y) * w + roi.x, (roi.y + y) * w + roi.x + roi.w), y * roi.w);
    return out;
  };

  const botellas = [], fin = MIN * 60000, inicioReloj = performance.now();
  for (let c = 0; c * 1000 / FPS <= fin + 2000; c++) {
    const t = c * 1000 / FPS;
    for (const cam of ["A", "B"]) {
      const e = est[cam];
      if (t > 0 && azarPerdida() < perdida) { e.perdidos++; continue; }   // la cámara no entregó este cuadro
      e.cuadros++;
      const q = escena.cuadro(cam, t), g = recortar(q.g);
      let t0 = performance.now();
      const r = e.nucleo.procesar(g, roi.w, roi.h, t);
      e.msDisparo += performance.now() - t0;
      if (r.guardar) e.mejor = { g, centro: q.centro };
      if (r.evento === "botella" && e.mejor) {
        t0 = performance.now();
        const vista = Motor.detectar(Motor.reducir(e.mejor.g, roi.w, roi.h), cal);
        e.msDetector += performance.now() - t0;
        e.lecturas.push({ id: e.mejor.centro, t });
        botellas.push(...emp.llega(cam, vista, t, { id: e.mejor.centro }));
      }
    }
    botellas.push(...emp.revisar(t));
  }
  botellas.push(...emp.vaciar());
  const segundos = (performance.now() - inicioReloj) / 1000;

  // --- resultados ---
  const reales = escena.llegadas(fin), idsReales = new Set(reales.map(b => b.id));
  const cam = {};
  for (const k of ["A", "B"]) {
    const e = est[k], vistos = e.lecturas.filter(l => idsReales.has(l.id)), cuenta = new Map();
    for (const l of vistos) cuenta.set(l.id, (cuenta.get(l.id) || 0) + 1);
    cam[k] = {
      contadas: cuenta.size, duplicados: [...cuenta.values()].reduce((s, n) => s + n - 1, 0), perdidas: reales.filter(b => !cuenta.has(b.id)).length,
      sinBotella: e.lecturas.filter(l => l.id === null).length, cuadrosPerdidos: e.perdidos, cuadros: e.cuadros + e.perdidos,
      msPorCuadro: +(e.msDisparo / e.cuadros).toFixed(2), msPorBotella: +(e.msDetector / Math.max(1, e.lecturas.length)).toFixed(1),
    };
  }
  const dentro = botellas.filter(b => idsReales.has(b.extra.A?.id ?? b.extra.B?.id));
  const cruces = dentro.filter(b => b.extra.A && b.extra.B && b.extra.A.id !== b.extra.B.id).length;
  const noRev = dentro.filter(b => b.final === "NO_REVISADA");
  const m = { buenas: 0, buenasRechazadas: 0, sinEtiqueta: 0, detectadas: 0, sePasaron: 0, incompletasAprobadas: dentro.filter(b => (!b.extra.A || !b.extra.B) && b.final === "OK").length };
  for (const b of dentro) {
    if (b.final === "NO_REVISADA" || !b.extra.A || !b.extra.B || b.extra.A.id !== b.extra.B.id) continue;
    const v = escena.botella(b.extra.A.id).verdad.clase;
    if (v === "buena") { m.buenas++; if (b.final !== "OK") m.buenasRechazadas++; }
    if (v === "sin_etiqueta") { m.sinEtiqueta++; if (b.final === "OK") m.sePasaron++; else m.detectadas++; }
  }

  console.log(`\n${MIN} min a ${POR_HORA.toLocaleString("es-CL")} botellas/hora, 2 cámaras simuladas a ${FPS} cuadros/s, ${(perdida * 100).toFixed(0)} % de cuadros perdidos.`);
  console.log(`  Botellas reales: ${reales.length}. Botellas armadas: ${dentro.length}. Emparejadas (con sus 2 vistas): ${dentro.filter(b => b.extra.A && b.extra.B).length}. Cruces (A y B de botellas distintas): ${cruces}. No revisadas: ${noRev.length}.`);
  for (const k of ["A", "B"]) {
    const i = cam[k];
    console.log(`  Cámara ${k}: contó ${i.contadas} de ${reales.length} · duplicados ${i.duplicados} · se le pasaron ${i.perdidas} · disparos sin botella ${i.sinBotella} · cuadros perdidos ${i.cuadrosPerdidos} de ${i.cuadros} · ${i.msPorCuadro} ms por cuadro (disparo) · ${i.msPorBotella} ms por botella (detector)`);
  }
  console.log(`  Detección: buenas ${m.buenas}, rechazadas por error ${m.buenasRechazadas} · sin etiqueta ${m.sinEtiqueta}, detectadas ${m.detectadas}, se pasaron ${m.sePasaron}.`);
  console.log(`  Tiempo de cálculo: ${segundos.toFixed(0)} s para ${MIN * 60} s de línea (${(segundos / MIN / 60 * 100).toFixed(0)} % de un núcleo, sin dibujar en pantalla).`);
  return { reales, cam, cruces, noRev, m, segundos };
}

let fallas = 0;
const revisar = (nombre, f) => { try { f(); console.log("ok   ", nombre); } catch (e) { fallas++; console.log("FALLA", nombre, "->", e.message); } };

const r1 = correr(0, 4);
revisar("cada cámara cuenta exacto, sin duplicados", () => {
  for (const k of ["A", "B"]) {
    assert.strictEqual(r1.cam[k].contadas, r1.reales.length, `cámara ${k}`);
    assert.strictEqual(r1.cam[k].duplicados, 0, `cámara ${k}`);
  }
});
revisar("ninguna botella cruzada entre cámaras y ninguna sin revisar", () => { assert.strictEqual(r1.cruces, 0); assert.strictEqual(r1.noRev.length, 0); });
revisar("0 botellas sin etiqueta aprobadas", () => assert.strictEqual(r1.m.sePasaron, 0));
revisar("menos de 2 % de buenas rechazadas", () => assert.ok(r1.m.buenasRechazadas / r1.m.buenas < 0.02));
revisar("alcanza: el cálculo toma menos que el tiempo real", () => assert.ok(r1.segundos < MIN * 60));

const r2 = correr(0.01, 9);
revisar("con cuadros perdidos: sin duplicados ni cruces", () => {
  for (const k of ["A", "B"]) assert.strictEqual(r2.cam[k].duplicados, 0, `cámara ${k}`);
  assert.strictEqual(r2.cruces, 0);
});
revisar("con cuadros perdidos: cada botella perdida queda NO REVISADA, ninguna aprobada", () => {
  const perdidas = r2.cam.A.perdidas + r2.cam.B.perdidas;
  assert.ok(r2.noRev.length >= Math.max(r2.cam.A.perdidas, r2.cam.B.perdidas) && r2.noRev.length <= perdidas, `${r2.noRev.length} no revisadas para ${perdidas} perdidas`);
  assert.strictEqual(r2.m.incompletasAprobadas, 0);
  assert.strictEqual(r2.m.sePasaron, 0);
});
console.log("");
process.exit(fallas ? 1 : 0);
