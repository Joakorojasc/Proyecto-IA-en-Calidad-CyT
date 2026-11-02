/* Prueba del disparo automático sin cámara ni navegador: botellas simuladas en cuadros de gris.
 * Uso: node scripts/test_disparo.js
 */
require("../frontend/disparo.js");
const assert = require("node:assert");
const { crearNucleo } = globalThis.Disparo;

const W = 160, H = 120, MS = 33;

function azar(semilla) { let s = semilla >>> 0; return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296; }

/** Fondo claro con ruido de cámara, con brillo opcional. */
function cuadroVacio(r, brillo = 0) {
  const g = new Uint8ClampedArray(W * H);
  for (let i = 0; i < g.length; i++) g[i] = 190 + brillo + (r() * 9 - 4);
  return g;
}

/** Botella oscura con una etiqueta del mismo tono que el fondo, en la posición x. */
function dibujarBotella(g, x, ancho = 50, conDetalle = true) {
  for (let v = 0; v < H; v++) for (let u = Math.max(0, x | 0); u < Math.min(W, x + ancho); u++) {
    const enEtiqueta = v > 35 && v < 85;
    let tono = enEtiqueta ? 190 : 30;
    if (enEtiqueta && conDetalle && (v % 8 < 2) && (u % 6 < 4)) tono = 60;
    g[v * W + u] = tono;
  }
}

/** Corre una secuencia: botellas [{ inicio, paso }] en cuadros; devuelve lo que pasó. */
function correr(botellas, { cuadros = 300, r = azar(1), brilloEn = null, opciones = {} } = {}) {
  const n = crearNucleo(opciones);
  const eventos = [];
  for (let c = 0; c < cuadros; c++) {
    const brillo = brilloEn !== null && c >= brilloEn ? 50 : 0;
    const g = cuadroVacio(r, brillo);
    for (const b of botellas) {
      const x = -60 + (c - b.inicio) * b.paso;
      if (c >= b.inicio && x < W) dibujarBotella(g, x);
    }
    const res = n.procesar(g, W, H, c * MS);
    if (res.evento) eventos.push({ c, ...res });
  }
  return { eventos, botellas: eventos.filter(e => e.evento === "botella"), nucleo: n };
}

const pruebas = {
  "una botella cuenta una vez"() {
    const { botellas } = correr([{ inicio: 20, paso: 6 }]);
    assert.strictEqual(botellas.length, 1);
    assert.ok(botellas[0].centrada, "debería haber elegido un cuadro centrado");
  },
  "50 botellas cuentan 50, sin duplicados"() {
    const lista = Array.from({ length: 50 }, (_, i) => ({ inicio: 20 + i * 45, paso: 6 }));
    assert.strictEqual(correr(lista, { cuadros: 2400 }).botellas.length, 50);
  },
  "cadencia de línea: una botella cada 360 ms a 30 cuadros por segundo"() {
    // 11 cuadros entre botellas; a 25 px por cuadro queda un hueco de 225 px menos 50 de botella
    const lista = Array.from({ length: 30 }, (_, i) => ({ inicio: 20 + i * 11, paso: 25 }));
    assert.strictEqual(correr(lista, { cuadros: 420 }).botellas.length, 30);
  },
  "varias botellas a la vez en el recuadro: el hueco es menor que el recuadro"() {
    // cada 90 px: botellas de 50 con hueco de 40. El recuadro (160) nunca queda vacío, pero la franja sí
    const lista = Array.from({ length: 40 }, (_, i) => ({ inicio: 20 + i * 15, paso: 6 }));
    assert.strictEqual(correr(lista, { cuadros: 700 }).botellas.length, 40);
  },
  "botella detenida un rato cuenta una vez y avisa"() {
    const n = crearNucleo(), r = azar(2);
    let botellas = 0, aviso = false;
    for (let c = 0; c < 500; c++) {
      const g = cuadroVacio(r);
      if (c > 20 && c < 450) dibujarBotella(g, 55);
      const res = n.procesar(g, W, H, c * MS);
      if (res.evento === "botella") botellas++;
      aviso = aviso || res.atascada;
    }
    assert.strictEqual(botellas, 1);
    assert.ok(aviso, "debería avisar que la zona lleva mucho rato ocupada");
  },
  "zona vacía con ruido no cuenta nada"() {
    assert.strictEqual(correr([], { cuadros: 1000 }).eventos.length, 0);
  },
  "cambio de luz de golpe no cuenta como botella"() {
    const { botellas, eventos } = correr([], { brilloEn: 100, cuadros: 200 });
    assert.strictEqual(botellas.length, 0);
    assert.strictEqual(eventos.filter(e => e.evento === "luz").length, 1);
  },
  "después de un cambio de luz sigue contando"() {
    assert.strictEqual(correr([{ inicio: 150, paso: 6 }], { brilloEn: 100, cuadros: 260 }).botellas.length, 1);
  },
  "un parpadeo de un cuadro no cuenta"() {
    const n = crearNucleo(), r = azar(3);
    let botellas = 0;
    for (let c = 0; c < 100; c++) {
      const g = cuadroVacio(r);
      if (c === 50) dibujarBotella(g, 55);
      if (n.procesar(g, W, H, c * MS).evento === "botella") botellas++;
    }
    assert.strictEqual(botellas, 0);
  },
  "registrar a mano mientras pasa no la cuenta dos veces"() {
    const n = crearNucleo(), r = azar(4);
    let botellas = 0;
    for (let c = 0; c < 100; c++) {
      const g = cuadroVacio(r);
      if (c > 20 && c < 50) dibujarBotella(g, 55);
      if (c === 30) n.cancelar();
      if (n.procesar(g, W, H, c * MS).evento === "botella") botellas++;
    }
    assert.strictEqual(botellas, 0);
  },
  "la nitidez elige el cuadro menos movido"() {
    const n = crearNucleo(), r = azar(5);
    let guardados = [], fin = null;
    for (let c = 0; c < 80; c++) {
      const g = cuadroVacio(r);
      if (c > 20 && c < 50) {
        dibujarBotella(g, 55, 50, c === 35);   // solo el cuadro 35 tiene el detalle fino de la etiqueta
      }
      const res = n.procesar(g, W, H, c * MS);
      if (res.guardar) guardados.push(c);
      if (res.evento === "botella") fin = res;
    }
    assert.ok(fin, "debería haber contado la botella");
    assert.strictEqual(guardados[guardados.length - 1], 35);
  },
};

let fallas = 0;
for (const [nombre, f] of Object.entries(pruebas)) {
  try { f(); console.log("ok   ", nombre); }
  catch (e) { fallas++; console.log("FALLA", nombre, "->", e.message); }
}
process.exit(fallas ? 1 : 0);
