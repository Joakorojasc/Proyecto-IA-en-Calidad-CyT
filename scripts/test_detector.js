/* Prueba del detector por tipo de etiqueta con botellas simuladas giradas al azar.
 * La estación simulada se calibra sola (frontal y trasera en 0°, ±30°, ±60°, de lado y vidrio) y después
 * se pasan botellas con giro de 0 a 360°, fallas en rachas, cambios de luz y fotos movidas.
 * Uso: node scripts/test_detector.js [botellas] [diseño de etiqueta]
 */
require("../frontend/motor.js");
require("../frontend/simulacion.js");
require("../frontend/botella.js");
const assert = require("node:assert");
const { Motor, Simulacion: S, Botella } = globalThis;

const N = +process.argv[2] || 1000;
const tex = S.texturas(+process.argv[3] || 7);   // otro número = otro diseño de etiqueta
const cal = Motor.calibrarTipos(S.referencias(tex));
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "0.0") + " %";

/** Pasa n botellas por las dos vistas y compara con la verdad. */
function lote(opciones, n = N) {
  const linea = S.crearLinea(opciones);
  const m = { botellas: 0, buenas: 0, buenasRechazadas: 0, sinEtiqueta: 0, detectadas: 0, sePasaron: 0, defectos: 0, defectosRechazados: 0, ms: 0, dudosas: 0 };
  for (let i = 0; i < n; i++) {
    const b = linea.siguiente(), t0 = performance.now();
    const A = Motor.detectar(S.vistaCentrada(b, b.theta, tex), cal), B = Motor.detectar(S.vistaCentrada(b, b.theta + 180, tex), cal);
    m.ms += performance.now() - t0;
    const f = Botella.fusionar({ A, B });
    m.botellas++; if (A.dudosa || B.dudosa) m.dudosas++;
    const c = b.verdad.clase;
    if (c === "buena") { m.buenas++; if (f.final !== "OK") m.buenasRechazadas++; }
    else if (c === "sin_etiqueta") { m.sinEtiqueta++; if (f.final === "OK") m.sePasaron++; else m.detectadas++; }
    else { m.defectos++; if (f.final !== "OK") m.defectosRechazados++; }
  }
  m.msPorBotella = +(m.ms / n).toFixed(1); delete m.ms;
  return m;
}

function informe(nombre, m) {
  console.log(`\n${nombre}`);
  console.log(`  botellas ${m.botellas} · sin etiqueta ${m.sinEtiqueta} · detectadas ${m.detectadas} · se pasaron ${m.sePasaron} · buenas rechazadas ${m.buenasRechazadas} de ${m.buenas} (${pct(m.buenasRechazadas, m.buenas)})`);
  console.log(`  con defecto (corrida o a medio pegar): ${m.defectos}, rechazadas ${m.defectosRechazados} · casos dudosos ${m.dudosas} · ${m.msPorBotella} ms por botella (2 vistas)`);
}

let fallas = 0;
const revisar = (nombre, f) => { try { f(); console.log("ok   ", nombre); } catch (e) { fallas++; console.log("FALLA", nombre, "->", e.message); } };

console.log(`Calibración simulada: ${cal.n.frontal} trozos de frontal, ${cal.n.trasera} de trasera, ${cal.n.vidrio} de vidrio. Textura mínima ${cal.texturaMinima.toFixed(2)}.`);

// 1. Cada giro, de 5 en 5 grados: ¿la vista ve lo que de verdad alcanza a ver? Con dos cámaras opuestas, ¿la botella sale bien?
revisar("con cualquier giro (0 a 355°): ninguna sin etiqueta aprobada y menos de 2 % de buenas rechazadas", () => {
  const malas = [], rechazos = [];
  let vistasFalsas = 0, buenas = 0, buenasRech = 0;
  for (let th = 0; th < 360; th += 5) for (const luz of [0.8, 1, 1.2]) for (const movido of [0, 2]) {
    for (const caso of ["buena", "frontal", "trasera"]) {
      const b = { id: th * 100 + luz * 10 + movido, theta: th, frontal: caso === "frontal" ? "falta" : "ok", trasera: caso === "trasera" ? "falta" : "ok", luz, movido };
      const A = Motor.detectar(S.vistaCentrada(b, th, tex), cal), B = Motor.detectar(S.vistaCentrada(b, th + 180, tex), cal);
      for (const [d, ang] of [[A, th], [B, th + 180]]) {
        const v = S.visibles(b, ang);
        for (const k of ["frontal", "trasera"]) if (d[k].visto && !v[k]) vistasFalsas++;
      }
      const f = Botella.fusionar({ A, B }).final;
      if (caso !== "buena" && f === "OK") malas.push(`${th}° luz ${luz} movida ${movido}: sin ${caso} -> ${f}`);
      if (caso === "buena") { buenas++; if (f !== "OK") { buenasRech++; rechazos.push(`${th}°/${luz}/${movido}`); } }
    }
  }
  console.log(`      giros probados: ${72 * 6 * 3} botellas; etiquetas vistas donde no había: ${vistasFalsas}; sin etiqueta aprobadas: ${malas.length}; buenas rechazadas: ${buenasRech} de ${buenas}${rechazos.length ? " (" + rechazos.join(", ") + ")" : ""}`);
  if (malas.length) console.log("      " + malas.join("\n      "));
  assert.strictEqual(vistasFalsas, 0, "vio una etiqueta que no estaba");
  assert.deepStrictEqual(malas, []);
  assert.ok(buenasRech / buenas < 0.02, "demasiadas buenas rechazadas");
});

const normal = lote({ semilla: 11, pRacha: 0.01, pSuelta: 0.02 });
informe(`Lote normal (${N} botellas, fallas en rachas)`, normal);
revisar("lote normal: 0 sin etiqueta aprobadas y menos de 2 % de buenas rechazadas", () => {
  assert.strictEqual(normal.sePasaron, 0);
  assert.ok(normal.buenasRechazadas / normal.buenas < 0.02, pct(normal.buenasRechazadas, normal.buenas));
});

const dificil = lote({ semilla: 23, pRacha: 0.02, pSuelta: 0.03, luz: 0.3, pMovida: 0.3, movidoMax: 4 });
informe(`Lote difícil (${N} botellas, más luz variable y 30 % de fotos movidas)`, dificil);
revisar("lote difícil: 0 sin etiqueta aprobadas", () => assert.strictEqual(dificil.sePasaron, 0));

console.log("");
process.exit(fallas ? 1 : 0);
