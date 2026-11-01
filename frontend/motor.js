/* Quality AI · motor de inspección.
 *
 * Funciones puras: reciben imágenes y devuelven números. No tocan la página ni guardan estado,
 * así el producto final y el simulador pueden usar el mismo cerebro.
 *
 * MVP: ¿hay etiqueta? Se calibra con fotos de botellas CON etiqueta (y, si se tienen, SIN etiqueta)
 * y cada foto nueva se compara contra ellas. La misma huella del simulador: tonos de gris y bordes.
 */
(function (global) {
  const W = 160, H = 160;          // tamaño al que se lleva la zona de la etiqueta
  const EMB = 32;                  // la huella se toma en una grilla de 32 x 32 puntos
  const G = 16;                    // grilla de color 16 x 16 (para la lupa y la revisión de color futura)

  const lienzo = typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (lienzo) { lienzo.width = W; lienzo.height = H; }
  const ctx = lienzo && lienzo.getContext("2d", { willReadFrequently: true });

  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  function aLab(r, g, b) {
    r = lin(r); g = lin(g); b = lin(b);
    const x = fLab((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = fLab(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = fLab((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  function normalizar(v) {
    let m = 0; for (const x of v) m += x; m /= v.length;
    let n = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; n += v[i] ** 2; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
  }
  const punto = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

  /** Lee una zona (roi en píxeles de la fuente; sin roi, la imagen entera) y devuelve su huella y su grilla de color. */
  function rasgos(fuente, roi) {
    const sw = fuente.videoWidth || fuente.naturalWidth || fuente.width;
    const sh = fuente.videoHeight || fuente.naturalHeight || fuente.height;
    const r = roi || { x: 0, y: 0, w: sw, h: sh };
    ctx.drawImage(fuente, r.x, r.y, r.w, r.h, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    const gris = new Float32Array(W * H), grilla = new Float32Array(G * G * 3), cuenta = new Float32Array(G * G);
    let suma = 0, bordes = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, [L, a, b] = aLab(px[i], px[i + 1], px[i + 2]);
      gris[y * W + x] = L; suma += L;
      const c = ((y * G / H) | 0) * G + ((x * G / W) | 0);
      grilla[c * 3] += L; grilla[c * 3 + 1] += a; grilla[c * 3 + 2] += b; cuenta[c]++;
    }
    for (let c = 0; c < G * G; c++) for (let k = 0; k < 3; k++) grilla[c * 3 + k] /= cuenta[c];

    const n = EMB * EMB, h = new Float32Array(n * 2);
    for (let y = 0; y < EMB; y++) for (let x = 0; x < EMB; x++) {
      const X = Math.min(W - 2, (x * W / EMB) | 0), Y = Math.min(H - 2, (y * H / EMB) | 0), v = gris[Y * W + X];
      const borde = Math.hypot(gris[Y * W + X + 1] - v, gris[(Y + 1) * W + X] - v);
      h[y * EMB + x] = v; h[n + y * EMB + x] = borde; bordes += borde;
    }
    return { huella: normalizar(h), grilla, brillo: suma / (W * H), textura: bordes / n };
  }

  const parecidoMax = (r, refs) => refs.reduce((m, x) => Math.max(m, punto(x.huella, r.huella)), -1);

  /** Calibra con referencias CON etiqueta (mínimo 3) y, opcional, SIN etiqueta. */
  function calibrar(conEtiqueta, sinEtiqueta = []) {
    if (conEtiqueta.length < 3) throw new Error("Hacen falta al menos 3 fotos con etiqueta para calibrar.");
    // cada referencia contra las demás, como si fuera nueva: cuánto se parecen entre sí las buenas
    const propios = conEtiqueta.map((r, k) => parecidoMax(r, conEtiqueta.filter((_, j) => j !== k)));
    const texturaCon = Math.min(...conEtiqueta.map(r => r.textura));
    const texturaSin = sinEtiqueta.length ? Math.max(...sinEtiqueta.map(r => r.textura)) : null;
    // una etiqueta tiene texto y dibujos (harta textura); el vidrio sin etiqueta es liso.
    // Con fotos sin etiqueta, el corte queda entre las dos clases; sin ellas, en la mitad de la etiqueta más lisa.
    const texturaMinima = texturaSin !== null ? (texturaCon + texturaSin) / 2 : texturaCon * 0.5;
    return {
      conEtiqueta, sinEtiqueta, texturaMinima,
      minimoBuenas: Math.min(...propios), promedioBuenas: propios.reduce((a, b) => a + b, 0) / propios.length,
    };
  }

  /** Umbral de parecido: el peor parecido entre buenas, menos una holgura que crece con la tolerancia (0 a 100). */
  function umbral(cal, tolerancia = 30) {
    const holgura = Math.max(0.02, 1 - cal.minimoBuenas);
    return cal.minimoBuenas - holgura * (0.3 + 0.7 * tolerancia / 100);
  }

  /**
   * ¿Hay etiqueta? Dos señales:
   *  1. Textura: una etiqueta tiene texto y dibujos; el vidrio es liso. Si no hay textura, no hay etiqueta.
   *  2. Parecido: con fotos sin etiqueta, gana la clase más parecida (vecino más cercano);
   *     sin ellas, tiene que parecerse a las buenas al menos lo que dice el umbral.
   * Hay etiqueta solo si las dos señales están de acuerdo.
   */
  function presencia(r, cal, tolerancia = 30) {
    const conE = parecidoMax(r, cal.conEtiqueta), u = umbral(cal, tolerancia);
    // la tolerancia mueve las dos señales; con el valor por defecto (30) no cambia nada.
    // Más tolerancia: pide menos textura y gana más fácil "con etiqueta" (menos falsas alarmas, más riesgo).
    const k = (tolerancia - 30) / 100, texturaMinima = cal.texturaMinima * (1 - 0.5 * k);
    const hayTextura = r.textura >= texturaMinima;
    let parecida, confianza, metodo, sinE = null;
    if (cal.sinEtiqueta.length) {
      sinE = parecidoMax(r, cal.sinEtiqueta);
      parecida = conE >= sinE - 0.2 * k;
      confianza = Math.min(1, Math.abs(conE - sinE) / 0.3);
      metodo = "vecino";
    } else {
      parecida = conE >= u;
      confianza = Math.min(1, Math.abs(conE - u) / Math.max(0.05, cal.promedioBuenas - u));
      metodo = "umbral";
    }
    const presente = hayTextura && parecida;
    let motivo;
    if (presente) motivo = "Se ve la etiqueta: tiene texto y dibujo, y se parece a las de referencia.";
    else if (!hayTextura) motivo = "No se ve texto ni dibujo: parece vidrio sin etiqueta.";
    else motivo = "Hay algo impreso, pero no se parece a la etiqueta de referencia.";
    return { presente, parecido: conE, parecidoSin: sinE, umbral: u, textura: r.textura, texturaMinima, hayTextura, confianza, metodo, motivo };
  }

  global.Motor = { W, H, G, rasgos, calibrar, umbral, presencia, parecidoMax, aLab };
})(typeof window !== "undefined" ? window : globalThis);
