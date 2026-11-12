/* Prueba del detector YOLOX sin modelo ni navegador: pre/post proceso y decisión conjunta de 2 cámaras.
 * Uso: node scripts/test_yolox.js
 */
require("../frontend/yolox.js");
require("../frontend/botella.js");
const assert = require("node:assert");
const { decodificar, vistaDesdeCajas, aTensor, escalaPara, cantidadPara, tamPara, nms } = globalThis.Yolox;
const { fusionar, conjunta } = globalThis.Botella;

const TAM = 416, NC = 2, ANCHO = 5 + NC, N = cantidadPara(TAM);

/** Salida cruda falsa de YOLOX con una caja en la celda que corresponde a (cx, cy, w, h) en píxeles de entrada. */
function salidaCon(cajas, decodificada = false) {
  const d = new Float32Array(N * ANCHO);
  for (const { cx, cy, w, h, clase, obj = 0.95, cls = 0.95, paso = 16 } of cajas) {
    let i = 0;
    for (const p of [8, 16, 32]) { if (p === paso) break; i += (TAM / p) ** 2; }
    const lado = TAM / paso, gx = Math.floor(cx / paso), gy = Math.floor(cy / paso), k = (i + gy * lado + gx) * ANCHO;
    if (decodificada) { d[k] = cx; d[k + 1] = cy; d[k + 2] = w; d[k + 3] = h; }
    else { d[k] = cx / paso - gx; d[k + 1] = cy / paso - gy; d[k + 2] = Math.log(w / paso); d[k + 3] = Math.log(h / paso); }
    d[k + 4] = obj; d[k + 5 + clase] = cls;
  }
  return d;
}

const cerca = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) < tol, `${a} no está cerca de ${b}`);

const pruebas = {
  "tamaños de YOLOX: 416 → 3549 cajas, 640 → 8400"() {
    assert.strictEqual(cantidadPara(416), 3549);
    assert.strictEqual(cantidadPara(640), 8400);
    assert.strictEqual(tamPara(3549), 416);
  },
  "tensor: RGBA a CHW en orden BGR, sin normalizar"() {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]);
    const t = aTensor(rgba, 2);
    assert.deepStrictEqual([...t], [30, 60, 90, 120, 20, 50, 80, 110, 10, 40, 70, 100]);
  },
  "decodifica una caja y la devuelve en coordenadas del recuadro (con el achicado y el relleno)"() {
    // recuadro de 640 x 480: se achica a 416 x 312 y el resto queda relleno abajo
    const w = 640, h = 480, esc = escalaPara(w, h, TAM);
    cerca(esc, 0.65);
    // etiqueta frontal en el recuadro: centro (320, 240), 200 x 160 → en la entrada: (208, 156), 130 x 104
    const d = salidaCon([{ cx: 208, cy: 156, w: 130, h: 104, clase: 0 }]);
    const [c] = decodificar(d, N, NC, TAM, esc, w, h);
    assert.strictEqual(c.nombre, "frontal");
    cerca(c.x, (320 - 100) / 640); cerca(c.y, (240 - 80) / 480); cerca(c.w, 200 / 640); cerca(c.h, 160 / 480);
    cerca(c.puntaje, 0.95 * 0.95, 1e-4);
  },
  "también entiende la salida ya decodificada (exportada con --decode_in_inference)"() {
    const d = salidaCon([{ cx: 208, cy: 156, w: 130, h: 104, clase: 1 }], true);
    const [c] = decodificar(d, N, NC, TAM, escalaPara(640, 480, TAM), 640, 480);
    assert.strictEqual(c.nombre, "trasera");
    cerca(c.x, 220 / 640);
  },
  "cajas con poco puntaje se descartan"() {
    const d = salidaCon([{ cx: 100, cy: 100, w: 50, h: 50, clase: 0, obj: 0.3, cls: 0.5 }]);   // 0,15 < 0,25
    assert.strictEqual(decodificar(d, N, NC, TAM, 1, TAM, TAM).length, 0);
  },
  "NMS: dos cajas sobre la misma etiqueta quedan en una; de distinta clase se mantienen"() {
    const a = { clase: 0, puntaje: 0.9, caja: [0, 0, 10, 10] }, b = { clase: 0, puntaje: 0.8, caja: [1, 1, 11, 11] }, c = { clase: 1, puntaje: 0.7, caja: [0, 0, 10, 10] };
    assert.deepStrictEqual(nms([b, a, c], 0.45), [a, c]);
  },
  "vista: solo cuenta la botella del centro, no las etiquetas de las botellas vecinas"() {
    const cajas = [
      { nombre: "frontal", puntaje: 0.97, x: 0.0, y: 0.3, w: 0.12, h: 0.4 },   // botella vecina, en el borde izquierdo
      { nombre: "trasera", puntaje: 0.88, x: 0.35, y: 0.3, w: 0.3, h: 0.4 },   // la botella revisada
    ];
    const v = vistaDesdeCajas(cajas);
    assert.strictEqual(v.frontal.visto, false);
    assert.strictEqual(v.trasera.visto, true);
    cerca(v.trasera.prob, 0.88, 1e-9);
    assert.strictEqual(v.ve, "trasera");
  },
  "vista dudosa cerca del umbral"() {
    assert.strictEqual(vistaDesdeCajas([{ nombre: "frontal", puntaje: 0.55, x: 0.4, y: 0.3, w: 0.2, h: 0.3 }]).dudosa, true);
    assert.strictEqual(vistaDesdeCajas([{ nombre: "frontal", puntaje: 0.95, x: 0.4, y: 0.3, w: 0.2, h: 0.3 }]).dudosa, false);
  },
  "probabilidad conjunta: P = 1 − (1 − pA)(1 − pB)"() {
    cerca(conjunta([0.6, 0.7]), 0.88, 1e-9);
    cerca(conjunta([0.95, 0]), 0.95, 1e-9);
    cerca(conjunta([0, 0]), 0, 1e-9);
  },
  "decisión conjunta: A ve solo la frontal y B solo la trasera → OK"() {
    const v = (pf, pt) => vistaDesdeCajas([
      ...(pf ? [{ nombre: "frontal", puntaje: pf, x: 0.4, y: 0.3, w: 0.2, h: 0.4 }] : []),
      ...(pt ? [{ nombre: "trasera", puntaje: pt, x: 0.4, y: 0.3, w: 0.2, h: 0.4 }] : []),
    ]);
    assert.strictEqual(fusionar({ A: v(0.96, 0), B: v(0, 0.93) }).final, "OK");
    // botella de lado: cada cámara ve las dos etiquetas a medias (0,7); juntas llegan a 0,91
    const lado = fusionar({ A: v(0.7, 0.7), B: v(0.7, 0.7) });
    assert.strictEqual(lado.final, "OK");
    cerca(lado.prob.frontal, 0.91, 1e-9);
    // nadie ve la trasera → rechazo claro
    const sinTrasera = fusionar({ A: v(0.96, 0), B: v(0.9, 0.1) });
    assert.strictEqual(sinTrasera.final, "RECHAZO");
    assert.deepStrictEqual(sinTrasera.faltan, ["trasera"]);
    assert.strictEqual(sinTrasera.dudosa, false);
    // trasera vista a medias por una sola cámara (0,6): no llega a 0,9 → rechazo marcado como dudoso
    const duda = fusionar({ A: v(0.96, 0.6), B: v(0.9, 0) });
    assert.strictEqual(duda.final, "RECHAZO");
    assert.strictEqual(duda.dudosa, true);
    assert.match(duda.motivo, /Duda/);
    // una cámara no vio la botella → nunca OK, aunque la otra vea las dos
    assert.strictEqual(fusionar({ A: v(0.99, 0.99), B: null }).final, "NO_REVISADA");
  },
  "los umbrales se pueden ajustar"() {
    const v = { frontal: { visto: true, prob: 0.85, confianza: 0.85 }, trasera: { visto: true, prob: 0.85, confianza: 0.85 } };
    assert.strictEqual(fusionar({ A: v, B: { frontal: { visto: false, prob: 0, confianza: 1 }, trasera: { visto: false, prob: 0, confianza: 1 } } }).final, "RECHAZO");
    assert.strictEqual(fusionar({ A: v, B: { frontal: { visto: false, prob: 0, confianza: 1 }, trasera: { visto: false, prob: 0, confianza: 1 } } }, { ok: 0.8, rechazo: 0.5 }).final, "OK");
  },
};

let fallas = 0;
for (const [nombre, fn] of Object.entries(pruebas)) {
  try { fn(); console.log("ok   ", nombre); } catch (e) { fallas++; console.log("FALLA", nombre, "\n     ", e.message); }
}
console.log(fallas ? `\n${fallas} prueba(s) fallaron` : "\ntodas las pruebas pasaron");
process.exit(fallas ? 1 : 0);
