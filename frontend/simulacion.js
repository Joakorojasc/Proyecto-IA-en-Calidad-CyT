/* Quality AI · simulación realista de la línea, mientras haya una sola cámara.
 *
 * - Cada botella pasa girada al azar (0 a 360°). La cámara A ve el ángulo θ y la B, al otro lado, ve θ + 180°.
 * - La etiqueta frontal está centrada en 0° y la trasera en 180°, alrededor de la botella.
 * - Las fallas vienen en rachas (por ejemplo, cuando se acaba un rollo) y también sueltas.
 *   Tipos: sin etiqueta, etiqueta corrida, etiqueta a medio pegar.
 * - Cada botella cambia un poco de luz y a veces sale movida.
 * - La simulación guarda la verdad de cada botella, para medir aciertos.
 * Todo en gris y sin página, así se prueba con Node. La página solo pinta el resultado.
 */
(function (global) {
  const ETIQUETAS = { frontal: { centro: 0, ancho: 110 }, trasera: { centro: 180, ancho: 90 } };
  const TEX_W = 220, TEX_H = 110;

  function azar(semilla = 1) {
    let s = semilla >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  const envolver = d => ((d % 360) + 540) % 360 - 180;   // ángulo en -180..180

  /** Etiquetas de mentira pero distintas entre sí: la frontal con título grande y escudo, la trasera con texto chico y código de barras. 1 = tinta. */
  function texturas(semilla = 7) {
    const r = azar(semilla);
    const nueva = () => new Float32Array(TEX_W * TEX_H);
    const rect = (t, x0, y0, x1, y1, v = 1) => {
      for (let y = Math.max(0, y0 | 0); y < Math.min(TEX_H, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(TEX_W, x1); x++) t[y * TEX_W + x] = v;
    };
    const f = nueva();
    rect(f, 4, 4, TEX_W - 4, 7); rect(f, 4, TEX_H - 7, TEX_W - 4, TEX_H - 4); rect(f, 4, 4, 7, TEX_H - 4); rect(f, TEX_W - 7, 4, TEX_W - 4, TEX_H - 4);
    for (let x = 30; x < TEX_W - 30;) { const a = 9 + r() * 10; rect(f, x, 14, x + a, 36); rect(f, x + 2, 18, x + a - 2, 32, 0.15); x += a + 5; }   // título
    for (let y = 0; y < TEX_H; y++) for (let x = 0; x < TEX_W; x++) {                                           // escudo
      const d = Math.hypot(x - TEX_W / 2, (y - 64) * 1.2);
      if (d < 22 && d > 16) f[y * TEX_W + x] = 1; else if (d < 12 && (x + y) % 6 < 3) f[y * TEX_W + x] = 0.8;
    }
    for (let k = 0; k < 2; k++) for (let x = 50; x < TEX_W - 50;) { const a = 3 + r() * 6; rect(f, x, 90 + k * 7, x + a, 94 + k * 7); x += a + 2; }

    const t = nueva();
    rect(t, 70, 6, 150, 14);                                                                                    // nombre chico arriba
    for (let y = 22; y < 78; y += 5) for (let x = 12; x < TEX_W - 12 - r() * 40;) { const a = 2 + r() * 7; rect(t, x, y, x + a, y + 2.5); x += a + 1.5 + (r() < 0.12 ? 5 : 0); }
    for (let x = 120; x < 200;) { const a = 1 + (r() * 3 | 0); rect(t, x, 82, x + a, 104); x += a + 1 + (r() * 3 | 0); }  // código de barras
    rect(t, 20, 84, 70, 100, 0.6);                                                                              // logo de reciclaje
    return { frontal: f, trasera: t };
  }

  /**
   * Una columna de botella vista desde una cámara. estado de cada etiqueta: "ok" | "falta" | "corrida" | "medio".
   * Devuelve la imagen de la botella (ancho bw x alto bh, gris 0 a 255) para pegarla en el cuadro.
   */
  function pintarBotella(b, anguloCamara, tex, { bw = 128, bh = 240, etqY0 = 0.33, etqY1 = 0.67 } = {}) {
    const img = new Float32Array(bw * bh), r = azar((b.id || 1) * 7919 + (anguloCamara | 0));
    const y0 = Math.round(etqY0 * bh), y1 = Math.round(etqY1 * bh), altoEtq = y1 - y0;
    for (let i = 0; i < bw; i++) {
      const xn = (i + 0.5) / bw * 2 - 1, alfa = Math.asin(xn) * 180 / Math.PI;
      const phi = anguloCamara + alfa, sombra = 0.3 + 0.7 * Math.cos(alfa * Math.PI / 180);
      const brillo = 130 * Math.exp(-(((xn + 0.38) / 0.09) ** 2));                 // reflejo fijo de la luz sobre el vidrio
      for (let y = 0; y < bh; y++) img[y * bw + i] = (38 + 30 * sombra) + brillo;
      for (const k of ["frontal", "trasera"]) {
        const estado = b[k] || "ok";
        if (estado === "falta") continue;
        const e = ETIQUETAS[k], corrida = estado === "corrida";
        const centro = e.centro + (corrida ? (b.corrimiento ?? 28) : 0), dy = corrida ? Math.round(altoEtq * 0.3) : 0;
        const d = envolver(phi - centro);
        if (Math.abs(d) > e.ancho / 2) continue;
        const u = (d + e.ancho / 2) / e.ancho;
        for (let y = Math.max(0, y0 + dy); y < Math.min(bh, y1 + dy); y++) {
          const v = (y - y0 - dy) / altoEtq;
          let tinta = tex[k][Math.min(TEX_H - 1, (v * TEX_H) | 0) * TEX_W + Math.min(TEX_W - 1, (u * TEX_W) | 0)];
          let papel = 222;
          if (estado === "medio" && u > 0.5) {                                      // la mitad despegada cuelga: se ve el dorso liso
            if (v > 0.15 + (u - 0.5) * 0.6) continue;
            tinta = 0; papel = 205;
          }
          img[y * bw + i] = (papel - 185 * tinta) * sombra + brillo * 0.3;
        }
      }
    }
    for (let k = 0; k < img.length; k++) img[k] = Math.max(0, Math.min(255, img[k] * (b.luz ?? 1) + (r() * 8 - 4)));
    if (b.movido) desenfocar(img, bw, bh, b.movido);
    return { img, bw, bh };
  }

  /** Foto movida: promedio horizontal de radio rad. */
  function desenfocar(img, w, h, rad) {
    const fila = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let k = -rad; k <= rad; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += img[y * w + xx]; n++; } }
        fila[x] = s / n;
      }
      img.set(fila, y * w);
    }
  }

  /** Cuadro de una cámara: fondo claro con ruido y las botellas pegadas en su posición x (centro). */
  function cuadro(w, h, botellas, r, luzFondo = 1) {
    const g = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) { const base = (176 + 14 * (y / h)) * luzFondo; for (let x = 0; x < w; x++) g[y * w + x] = base + (r() * 8 - 4); }
    for (const { pintura, x } of botellas) {
      const { img, bw, bh } = pintura, x0 = Math.round(x - bw / 2), yOff = Math.round((h - bh) / 2);
      for (let i = 0; i < bw; i++) {
        const X = x0 + i; if (X < 0 || X >= w) continue;
        for (let yy = 0; yy < bh; yy++) { const Y = yy + yOff; if (Y >= 0 && Y < h) g[Y * w + X] = img[yy * bw + i]; }
      }
    }
    return g;
  }

  /** Qué etiquetas alcanza a ver de verdad una cámara: al menos `minimo` grados de etiqueta dentro de ±visible. */
  function visibles(b, anguloCamara, { visible = 75, minimo = 20 } = {}) {
    const out = {};
    for (const k of ["frontal", "trasera"]) {
      if ((b[k] || "ok") === "falta") { out[k] = false; continue; }
      const e = ETIQUETAS[k], c = envolver(e.centro + (b[k] === "corrida" ? (b.corrimiento ?? 28) : 0) - anguloCamara);
      const ini = Math.max(c - e.ancho / 2, -visible), fin = Math.min(c + e.ancho / 2, visible);
      out[k] = fin - ini >= minimo;
    }
    return out;
  }

  /**
   * Generador de botellas con la verdad. Las fallas siguen una cadena de Markov: normal ↔ racha de falla.
   * pRacha: probabilidad por botella de que empiece una racha. largoRacha: botellas promedio que dura.
   * pSuelta: falla aislada. tipos: peso de cada tipo de falla. luz: variación de luz (±). pMovida: fotos movidas.
   */
  const OPCIONES_LINEA = { semilla: 1, pRacha: 0.004, largoRacha: 8, pSuelta: 0.006, tipos: { falta: 0.6, corrida: 0.25, medio: 0.15 }, luz: 0.2, pMovida: 0.1, movidoMax: 3 };
  function crearLinea(opciones = {}) {
    const o = { ...OPCIONES_LINEA, ...opciones, tipos: { ...OPCIONES_LINEA.tipos, ...(opciones.tipos || {}) } };
    const r = azar(o.semilla);
    let id = 0, racha = null, luzLenta = 1;
    const elegirTipo = () => { const tot = Object.values(o.tipos).reduce((a, b) => a + b, 0); let x = r() * tot; for (const [k, p] of Object.entries(o.tipos)) { if ((x -= p) < 0) return k; } return "falta"; };
    const elegirLado = () => (r() < 0.5 ? "frontal" : "trasera");
    return {
      opciones: o,
      siguiente() {
        id++;
        if (racha && r() < 1 / o.largoRacha) racha = null;
        if (!racha && r() < o.pRacha) racha = { tipo: elegirTipo(), lado: elegirLado() };   // p. ej. se acabó el rollo de la trasera
        const b = { id, theta: r() * 360, frontal: "ok", trasera: "ok", falla: null, enRacha: !!racha };
        if (racha && r() < 0.9) { b[racha.lado] = racha.tipo; b.falla = racha.tipo; }
        else if (r() < o.pSuelta) { const lado = elegirLado(), tipo = elegirTipo(); b[lado] = tipo; b.falla = tipo; }
        if (b.frontal === "corrida" || b.trasera === "corrida") b.corrimiento = (r() < 0.5 ? -1 : 1) * (20 + r() * 25);
        luzLenta += (1 - luzLenta) * 0.02 + (r() - 0.5) * 0.03;
        b.luz = Math.max(1 - o.luz, Math.min(1 + o.luz, luzLenta + (r() - 0.5) * o.luz));
        b.movido = r() < o.pMovida ? 1 + ((r() * o.movidoMax) | 0) : 0;
        b.verdad = verdad(b);
        return b;
      },
    };
  }

  /** La verdad de una botella: buena (las 2 etiquetas bien), sin etiqueta (le falta alguna) o con defecto (corrida o a medio pegar). */
  function verdad(b) {
    const falta = ["frontal", "trasera"].filter(k => b[k] === "falta");
    if (falta.length) return { clase: "sin_etiqueta", falta };
    if (b.frontal !== "ok" || b.trasera !== "ok") return { clase: "defecto", falta: [] };
    return { clase: "buena", falta: [] };
  }

  /** Vista de una cámara con la botella centrada, recortada al recuadro y llevada a gris de Motor.GW x Motor.GH. */
  function vistaCentrada(b, anguloCamara, tex, { w = 320, h = 240, roiW = 0.5, roiH = 0.7, semilla = 3 } = {}) {
    const pintura = pintarBotella(b, anguloCamara, tex, { bw: Math.round(w * 0.4), bh: h });
    const g = cuadro(w, h, [{ pintura, x: w / 2 }], azar(semilla + (b.id | 0)));
    const roi = { x: w * (1 - roiW) / 2, y: h * (1 - roiH) / 2, w: w * roiW, h: h * roiH };
    return global.Motor.reducir(g, w, h, roi);
  }

  /**
   * Ángulo de cámara que corresponde a un paso de la guía de calibración.
   * Convención de la guía: ángulo positivo = la etiqueta pedida queda cargada a la DERECHA de la imagen.
   * De lado +90 = frontal a la derecha y trasera a la izquierda.
   */
  const anguloGuia = (clase, a) => clase === "trasera" ? 180 - a : -a;

  /** Referencias simuladas para calibrar la estación simulada: frontal y trasera en 0°, ±30°, ±60°; de lado; y vidrio. */
  function referencias(tex, opciones = {}) {
    const refs = [], base = { luz: 1, movido: 0 };
    let id = 900000;
    for (const a of [0, 30, -30, 60, -60]) {
      refs.push({ clase: "frontal", angulo: a, gris: vistaCentrada({ ...base, id: id++ }, anguloGuia("frontal", a), tex, opciones) });
      refs.push({ clase: "trasera", angulo: a, gris: vistaCentrada({ ...base, id: id++ }, anguloGuia("trasera", a), tex, opciones) });
    }
    for (const a of [90, -90]) refs.push({ clase: "lado", angulo: a, gris: vistaCentrada({ ...base, id: id++ }, anguloGuia("frontal", a), tex, opciones) });
    for (const a of [0, 90, 180]) refs.push({ clase: "vidrio", angulo: a, gris: vistaCentrada({ ...base, id: id++, frontal: "falta", trasera: "falta" }, a, tex, opciones) });
    return refs;
  }

  /**
   * La línea en movimiento, vista por dos cámaras (A y B, una a cada lado). Entrega el cuadro de cada cámara en el momento t.
   * porHora: botellas por hora (10.000 = una cada 360 ms). velocidad: px por segundo de la cinta en el cuadro.
   * desfaseMs: la misma botella llega a B este tiempo después que a A (con ±jitterMs al azar).
   * La cámara B ve la botella del otro lado (θ + 180°) y pasando en sentido contrario.
   * inicioMs: la primera botella llega después de este tiempo, para que el disparo aprenda el fondo vacío.
   */
  function crearEscena(opciones = {}) {
    const o = { porHora: 10000, w: 320, h: 240, velocidad: 600, desfaseMs: 175, jitterMs: 5, separacionJitterMs: 20, inicioMs: 1000, semilla: 1, linea: {}, ...opciones };
    const tex = o.tex || texturas(), linea = crearLinea({ semilla: o.semilla, ...o.linea }), r = azar(o.semilla * 31 + 5);
    const periodo = 3600000 / o.porHora, bw = Math.round(o.w * 0.4), recorrido = (o.w + bw) / o.velocidad * 1000;
    const botellas = [];             // { b, t0, d, pinturas }
    let proxima = 0;
    function asegurar(t) {
      while (o.inicioMs + proxima * periodo <= t + 100) {
        const b = linea.siguiente();
        botellas.push({ b, t0: o.inicioMs + proxima * periodo + (r() * 2 - 1) * o.separacionJitterMs, d: o.desfaseMs + (r() * 2 - 1) * o.jitterMs, pinturas: {} });
        proxima++;
      }
      // las botellas que ya salieron de las dos cámaras no se dibujan más
      for (const x of botellas) if (x.pinturas && t - x.t0 - x.d > recorrido + 200) x.pinturas = null;
      if (botellas.length > 3000) botellas.splice(0, 1000);   // en una corrida larga se olvidan las más viejas
    }
    function pintura(x, cam) {
      if (!x.pinturas) return null;
      return x.pinturas[cam] || (x.pinturas[cam] = pintarBotella(x.b, cam === "A" ? x.b.theta : x.b.theta + 180, tex, { bw, bh: o.h }));
    }
    /** Cuadro de la cámara cam en t (ms). Devuelve { g, w, h, centro } con centro = id de la botella más cerca del medio. */
    function cuadroDe(cam, t, ruido = r) {
      asegurar(t);
      const visibles = [];
      let centro = null, dist = Infinity;
      for (const x of botellas) {
        const dt = t - x.t0 - (cam === "B" ? x.d : 0);
        if (dt < 0 || dt > recorrido) continue;
        const avance = o.velocidad * dt / 1000 - bw / 2, px = cam === "A" ? avance : o.w - avance;
        const p = pintura(x, cam);
        if (!p) continue;
        visibles.push({ pintura: p, x: px });
        if (Math.abs(px - o.w / 2) < dist) { dist = Math.abs(px - o.w / 2); centro = x.b.id; }
      }
      return { g: cuadro(o.w, o.h, visibles, ruido), w: o.w, h: o.h, centro: dist < bw / 2 ? centro : null };
    }
    /** Botellas que ya terminaron de pasar por las dos cámaras en t. */
    const pasadas = t => botellas.filter(x => t - x.t0 - Math.max(0, x.d) > recorrido).map(x => x.b);
    const llegadas = t => botellas.filter(x => x.t0 <= t).map(x => x.b);
    return { opciones: o, tex, cuadro: cuadroDe, pasadas, llegadas, botella: id => botellas.find(x => x.b.id === id)?.b, get todas() { return botellas.map(x => x.b); } };
  }

  global.Simulacion = {
    crearEscena, ETIQUETAS, azar, texturas, pintarBotella, cuadro, visibles, crearLinea, verdad, vistaCentrada, referencias, anguloGuia, OPCIONES_LINEA };
})(typeof window !== "undefined" ? window : globalThis);
