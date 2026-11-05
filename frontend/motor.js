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

  /* ======================================================================
   * Detector por tipo de etiqueta: frontal, trasera o vidrio (sin etiqueta).
   *
   * La botella llega girada al azar: la etiqueta puede ocupar solo una franja de la vista.
   * Por eso no se compara la vista entera: se recorre con ventanas verticales de varios anchos
   * y cada ventana se compara con trozos de las fotos de referencia (tomadas en varios ángulos).
   * Todo trabaja sobre la vista en gris de GW x GH, así se puede probar en Node sin navegador.
   * ====================================================================== */
  const GW = 128, GH = 64;               // la vista (el recuadro) se lleva a gris de este tamaño
  const VC = 12, VF = 24;                // cada ventana se resume en una grilla de 12 columnas x 24 filas
  const ANCHOS = [0.2, 0.35, 0.6];       // anchos de ventana, como fracción de la vista
  const PASO = 0.08;                     // cuánto se corre la ventana cada vez al revisar
  const PASO_REF = 0.025;                // en las referencias, paso fino: así siempre hay un trozo alineado con lo que se revisa
  const CLASES = ["frontal", "trasera", "vidrio"];

  /** Reduce una imagen en gris (w x h) a ow x oh (por defecto GW x GH) promediando por bloques. roi opcional en píxeles. */
  function reducir(g, w, h, roi, ow = GW, oh = GH) {
    const r = roi || { x: 0, y: 0, w, h }, out = new Uint8ClampedArray(ow * oh);
    for (let Y = 0; Y < oh; Y++) {
      const y0 = Math.floor(r.y + Y * r.h / oh), y1 = Math.max(y0 + 1, Math.floor(r.y + (Y + 1) * r.h / oh));
      for (let X = 0; X < ow; X++) {
        const x0 = Math.floor(r.x + X * r.w / ow), x1 = Math.max(x0 + 1, Math.floor(r.x + (X + 1) * r.w / ow));
        let s = 0, n = 0;
        for (let y = y0; y < y1 && y < h; y++) for (let x = x0; x < x1 && x < w; x++) { s += g[y * w + x]; n++; }
        out[Y * ow + X] = n ? s / n : 0;
      }
    }
    return out;
  }

  /** En el navegador: lee el recuadro de una imagen, video o canvas y lo deja en gris de GW x GH. */
  const lienzoGris = lienzo ? document.createElement("canvas") : null;
  if (lienzoGris) { lienzoGris.width = GW; lienzoGris.height = GH; }
  const ctxGris = lienzoGris && lienzoGris.getContext("2d", { willReadFrequently: true });
  function grisDe(fuente, roi) {
    const sw = fuente.videoWidth || fuente.naturalWidth || fuente.width;
    const sh = fuente.videoHeight || fuente.naturalHeight || fuente.height;
    const r = roi || { x: 0, y: 0, w: sw, h: sh };
    ctxGris.drawImage(fuente, r.x, r.y, r.w, r.h, 0, 0, GW, GH);
    const px = ctxGris.getImageData(0, 0, GW, GH).data, g = new Uint8ClampedArray(GW * GH);
    for (let i = 0; i < g.length; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
    return g;
  }

  /**
   * Desenrolla la botella: en la foto, la etiqueta se aprieta hacia los bordes del cilindro. Si se reparte la imagen
   * por ángulo (no por píxel), una etiqueta girada se ve igual que de frente, solo corrida hacia un lado.
   * botella: fracción del ancho del recuadro que ocupa la botella. Se busca su centro por sus bordes verticales.
   */
  const ALFA_MAX = 72;   // más allá de este ángulo el borde de la botella se ve demasiado apretado para servir
  function desenrollar(g, botella = 0.8) {
    const ancho = botella * GW, perfil = new Float32Array(GW);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW - 1; x++) perfil[x] += Math.abs(g[y * GW + x + 1] - g[y * GW + x]);
    // centro: el par de bordes separados por el ancho de la botella con más contraste (buscando ±12 % alrededor del medio)
    let centro = GW / 2, mejor = -1;
    const pico = x => { let m = 0; for (let k = -1; k <= 1; k++) { const i = Math.round(x) + k; if (i >= 0 && i < GW) m = Math.max(m, perfil[i]); } return m; };
    if (ancho < GW - 2) for (let c = GW / 2 - 0.12 * GW; c <= GW / 2 + 0.12 * GW; c++) {
      const v = pico(c - ancho / 2) + pico(c + ancho / 2);
      if (v > mejor) { mejor = v; centro = c; }
    }
    const out = new Uint8ClampedArray(GW * GH);
    for (let X = 0; X < GW; X++) {
      const alfa = ((X + 0.5) / GW * 2 - 1) * ALFA_MAX * Math.PI / 180;
      const xf = Math.max(0, Math.min(GW - 1.001, centro + Math.sin(alfa) * ancho / 2 - 0.5)), x0 = Math.floor(xf), t = xf - x0;
      for (let y = 0; y < GH; y++) out[y * GW + X] = g[y * GW + x0] * (1 - t) + g[y * GW + x0 + 1] * t;
    }
    return out;
  }

  /** Suma acumulada 2D: permite promediar cualquier rectángulo en tiempo constante. */
  function integral(v, w, h) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let fila = 0;
      for (let x = 0; x < w; x++) { fila += v[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + fila; }
    }
    return I;
  }
  const sumaRect = (I, w, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];

  function normalizarEn(v, ini, fin, escala) {
    let m = 0; for (let i = ini; i < fin; i++) m += v[i]; m /= fin - ini;
    let n = 0; for (let i = ini; i < fin; i++) { v[i] -= m; n += v[i] ** 2; }
    n = Math.sqrt(n) || 1; for (let i = ini; i < fin; i++) v[i] *= escala / n;
  }

  /**
   * Recorre la vista con ventanas verticales. Para cada una devuelve su huella (forma de grises y de bordes,
   * independiente del brillo) y su textura: bordes promedio relativos al brillo, así una luz más fuerte no la infla.
   * paso: cuánto se corre la ventana (fracción de la vista).
   */
  function ventanas(g, paso = PASO) {
    // borde: cambio de un punto al siguiente. detalle: curvatura (segunda diferencia), que responde al texto y al dibujo
    // pero casi nada a un reflejo suave del vidrio. La textura se mide con el detalle.
    const borde = new Float32Array(GW * GH), detalle = new Float32Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x, v = g[i];
      borde[i] = (x < GW - 1 ? Math.abs(g[i + 1] - v) : 0) + (y < GH - 1 ? Math.abs(g[i + GW] - v) : 0);
      detalle[i] = (x > 0 && x < GW - 1 ? Math.abs(g[i + 1] + g[i - 1] - 2 * v) : 0) + (y > 0 && y < GH - 1 ? Math.abs(g[i + GW] + g[i - GW] - 2 * v) : 0);
    }
    const Ig = integral(g, GW, GH), Ib = integral(borde, GW, GH), Id = integral(detalle, GW, GH), lista = [];
    for (const a of ANCHOS) {
      const ancho = Math.round(a * GW), dx = Math.max(1, Math.round(paso * GW));
      for (let x0 = 0; x0 + ancho <= GW; x0 += dx) {
        const x1 = x0 + ancho, n = VC * VF, h = new Float32Array(n * 2);
        for (let f = 0; f < VF; f++) {
          const y0 = Math.floor(f * GH / VF), y1 = Math.floor((f + 1) * GH / VF);
          for (let c = 0; c < VC; c++) {
            const c0 = x0 + Math.floor(c * ancho / VC), c1 = x0 + Math.floor((c + 1) * ancho / VC), area = (c1 - c0) * (y1 - y0);
            h[f * VC + c] = sumaRect(Ig, GW, c0, y0, c1, y1) / area;
            h[n + f * VC + c] = sumaRect(Ib, GW, c0, y0, c1, y1) / area;
          }
        }
        // textura de cada tercio de la ventana; manda el tercio más liso. Así una ventana que solo toca el borde
        // de una etiqueta (papel contra vidrio) no cuenta: para votar, la ventana tiene que estar llena de etiqueta.
        let textura = Infinity;
        for (let k = 0; k < 3; k++) {
          const a0 = x0 + Math.floor(k * ancho / 3), a1 = x0 + Math.floor((k + 1) * ancho / 3), ar = (a1 - a0) * GH;
          textura = Math.min(textura, 100 * sumaRect(Id, GW, a0, 0, a1, GH) / ar / (sumaRect(Ig, GW, a0, 0, a1, GH) / ar + 24));
        }
        const brillo = sumaRect(Ig, GW, x0, 0, x1, GH) / (ancho * GH);
        normalizarEn(h, 0, n, Math.SQRT1_2); normalizarEn(h, n, 2 * n, Math.SQRT1_2);
        lista.push({ x0, x1, huella: h, textura, brillo });
      }
    }
    return lista;
  }

  const percentil = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const masParecido = (h, trozos) => { let m = -1; for (const t of trozos) { const p = punto(h, t); if (p > m) m = p; } return m; };

  /**
   * Calibra con fotos de referencia por tipo, no por cámara.
   * refs: [{ clase: "frontal" | "trasera" | "vidrio" | "lado", angulo, gris: GW x GH }]
   * "lado" es la botella vista de costado: puede mostrar un trozo de cada etiqueta, y cada trozo se asigna solo.
   */
  function calibrarTipos(refs, { botella = 0.8 } = {}) {
    const trozos = { frontal: [], trasera: [], vidrio: [] }, texturas = { frontal: [], trasera: [], vidrio: [] };
    const porRef = refs.map(r => ({ r, v: ventanas(desenrollar(r.gris, botella), PASO_REF) }));
    for (const { r, v } of porRef) if (r.clase === "vidrio") for (const w of v) { trozos.vidrio.push(w.huella); texturas.vidrio.push(w.textura); }
    const vidrioAlto = texturas.vidrio.length ? percentil(texturas.vidrio, 0.95) : 0;
    // de una foto con etiqueta solo sirven los trozos con textura: las partes de vidrio liso no enseñan nada de la etiqueta
    const sirve = w => w.textura >= vidrioAlto * 1.15;
    // Hasta ±30° se ve una sola etiqueta y sirve toda la foto. Con más giro asoma el borde de la otra etiqueta,
    // así que solo se aprende la mitad donde está la etiqueta pedida: ángulo positivo = etiqueta cargada a la derecha.
    // De lado (±90°): con +90 la frontal queda a la derecha y la trasera a la izquierda; con −90, al revés.
    const centro = w => (w.x0 + w.x1) / 2 / GW - 0.5;
    const angosta = w => w.x1 - w.x0 <= ANCHOS[1] * GW + 1;
    let lado = 0;
    for (const { r, v } of porRef) {
      if (r.clase === "vidrio") continue;
      const a = r.angulo ?? 0;
      for (const w of v) {
        if (!sirve(w)) continue;
        let k = null;
        if (r.clase === "lado") { if (angosta(w) && Math.abs(centro(w)) > 0.06) k = (centro(w) > 0) === (a > 0) ? "frontal" : "trasera"; }
        else if (Math.abs(a) <= 30) k = r.clase;
        else if (angosta(w) && centro(w) * a > 0) k = r.clase;
        if (!k) continue;
        trozos[k].push(w.huella); texturas[k].push(w.textura);
        if (r.clase === "lado") lado++;
      }
    }
    const faltan = [];
    if (refs.filter(r => r.clase === "frontal").length < 2) faltan.push("frontal");
    if (refs.filter(r => r.clase === "trasera").length < 2) faltan.push("trasera");
    if (refs.filter(r => r.clase === "vidrio").length < 1) faltan.push("vidrio");
    if (faltan.length) throw new Error("Faltan fotos de referencia: " + faltan.join(", ") + ".");
    // textura mínima: entre el vidrio más rugoso y la etiqueta más lisa. Si se cruzan, manda el vidrio (mejor rechazar de más).
    const etiquetaBaja = percentil([...texturas.frontal, ...texturas.trasera], 0.05);
    const texturaMinima = etiquetaBaja > vidrioAlto ? (etiquetaBaja + vidrioAlto) / 2 : vidrioAlto;
    return { trozos, botella, texturaMinima, vidrioAlto, etiquetaBaja, n: { frontal: trozos.frontal.length, trasera: trozos.trasera.length, vidrio: trozos.vidrio.length, lado } };
  }

  /** Margen que debe sacarle una clase a la segunda para creerle. Tolerancia 0 a 100: más tolerancia, menos margen. */
  const margenMinimo = (tol = 30) => 0.07 * (1 - tol / 100) + 0.01;

  /**
   * ¿Qué etiquetas se ven en esta vista? Devuelve, para frontal y trasera: visto, confianza (0 a 1) y la ventana donde se vio.
   * Las dos pueden verse a la vez (botella de lado). Si hay duda, NO se da por vista: es preferible rechazar.
   */
  function detectar(g, cal, tol = 30) {
    const M = margenMinimo(tol), tMin = cal.texturaMinima * (1 - 0.3 * (tol - 30) / 100);
    const res = { frontal: { visto: false, margen: -1, confianza: 0, ventana: null }, trasera: { visto: false, margen: -1, confianza: 0, ventana: null } };
    let texturaMax = 0, dudosa = false;
    for (const w of ventanas(desenrollar(g, cal.botella ?? 0.8))) {
      texturaMax = Math.max(texturaMax, w.textura);
      if (w.textura < tMin) continue;
      const s = { frontal: masParecido(w.huella, cal.trozos.frontal), trasera: masParecido(w.huella, cal.trozos.trasera), vidrio: masParecido(w.huella, cal.trozos.vidrio) };
      for (const k of ["frontal", "trasera"]) {
        const otra = Math.max(...CLASES.filter(c => c !== k).map(c => s[c])), margen = s[k] - otra;
        if (margen > res[k].margen) res[k] = { ...res[k], margen, ventana: [w.x0 / GW, w.x1 / GW], parecido: s[k] };
      }
    }
    for (const k of ["frontal", "trasera"]) {
      const r = res[k];
      r.visto = r.margen >= M;
      r.confianza = r.visto ? Math.min(1, r.margen / (2.5 * M)) : Math.min(1, Math.max(0, -r.margen) / (2.5 * M));
      if (r.margen >= M * 0.5 && r.margen < M * 1.5) dudosa = true;
    }
    const vistas = ["frontal", "trasera"].filter(k => res[k].visto);
    const ve = vistas.length === 2 ? "ambas" : vistas.length ? vistas[0] : "ninguna";
    return { ...res, ve, texturaMax, texturaMinima: tMin, margenMinimo: M, dudosa };
  }

  global.Motor = {
    W, H, G, rasgos, calibrar, umbral, presencia, parecidoMax, aLab,
    GW, GH, reducir, grisDe, desenrollar, ventanas, calibrarTipos, detectar, margenMinimo,
  };
})(typeof window !== "undefined" ? window : globalThis);
