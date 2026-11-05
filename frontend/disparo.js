/* Quality AI · disparo automático (fotocelda virtual).
 *
 * Mira una franja angosta al centro del recuadro y avisa cuando terminó de pasar una botella, con su cuadro más nítido.
 * Supone cámara fija y botellas separadas: una botella tapa la franja, sigue de largo, y la franja vuelve a quedar libre.
 * No sabe de etiquetas: solo decide cuándo revisar. La revisión la hace Motor.presencia().
 */
(function (global) {
  const ANCHO = 160;               // la zona se achica a este ancho para compararla con el fondo
  const MS_MINIMO = 30;            // el navegador pinta más rápido que la cámara: no contar dos veces el mismo cuadro

  const BASE = {
    umbralPx: 25,                  // diferencia de gris para que un punto cuente como "cambió"
    franja: 0.08,                  // ancho de la fotocelda, en el centro del recuadro. El hueco entre botellas debe ser mayor
    entrar: 0.12,                  // fracción de la franja que debe cambiar para decir que llegó una botella
    salir: 0.04,                   // fracción bajo la cual la franja vuelve a estar libre
    cambioLuz: 0.7,                // si esta fracción del recuadro cambia de golpe, es la luz o la exposición, no una botella
    cuadrosAprender: 10,           // cuadros para aprender el fondo vacío
    cuadrosEntrada: 2,             // cuadros seguidos sobre "entrar" para confirmar la botella
    cuadrosSalida: 2,              // cuadros seguidos bajo "salir" para darla por salida
    aprendizaje: 0.05,             // qué tan rápido el fondo sigue los cambios lentos de luz
    centrada: 0.2,                 // cuánto se puede alejar del centro para considerarla centrada (0 a 0,5)
    anchoMinimo: 0.2,              // ancho mínimo de la botella en el recuadro para elegir su cuadro como centrado
    huecoReflejo: 0.1,             // hueco máximo (fracción del recuadro) dentro de una botella, por reflejos
    avisoAtascoMs: 10000,          // tiempo ocupada tras el cual se sugiere reaprender el fondo
  };

  /** Nitidez: varianza del Laplaciano. Una foto movida da un número bajo. */
  function nitidez(g, w, h) {
    let suma = 0, suma2 = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      suma += l; suma2 += l * l; n++;
    }
    return n ? suma2 / n - (suma / n) ** 2 : 0;
  }

  /**
   * Foto movida: curvatura (segunda diferencia) dividida por borde (primera diferencia), en horizontal.
   * Un desenfoque por movimiento baja mucho más la curvatura que el borde, y la razón casi no depende de qué
   * se ve (etiqueta o vidrio). Nítida da cerca de 2; movida, bajo 1,6. Se compara con la mediana de la propia cámara.
   */
  function razonNitidez(g, w, h) {
    let L = 0, B = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      L += Math.abs(g[i + 1] + g[i - 1] - 2 * g[i]); B += Math.abs(g[i + 1] - g[i - 1]) / 2;
    }
    return L / (B + 1);
  }

  /** Lógica pura: recibe cuadros en gris y decide. No toca la página, así se puede probar sin cámara. */
  function crearNucleo(opciones = {}) {
    const o = { ...BASE, ...opciones };
    let fondo = null, columnas = null, estado = "aprendiendo", cuenta = 0, previa = 0, cancelada = false;
    let t0 = 0, mejor = null;

    function reiniciar() { fondo = null; estado = "aprendiendo"; cuenta = 0; previa = 0; cancelada = false; mejor = null; }

    /** Qué tan lejos del centro está la botella que tapa la franja: el tramo de columnas con cambios que pasa por ella. */
    function distanciaAlCentro(w, h, b0, b1) {
      const activa = x => columnas[x] >= 0.15 * h;
      let semilla = -1;
      for (let x = b0; x < b1; x++) if (activa(x) && (semilla < 0 || columnas[x] > columnas[semilla])) semilla = x;
      if (semilla < 0) return { distancia: 0.5, entera: false };
      // el tramo sigue a través de huecos chicos: un reflejo claro sobre el vidrio se parece al fondo y cortaría la botella en dos
      const salto = Math.max(1, Math.round(o.huecoReflejo * w));
      let ini = semilla, fin = semilla;
      for (let x = ini - 1; x >= 0 && ini - x <= salto; x--) if (activa(x)) ini = x;
      for (let x = fin + 1; x < w && x - fin <= salto; x++) if (activa(x)) fin = x;
      // si el tramo toca el borde del recuadro, la botella no está entera adentro; si es muy angosto, es solo su borde
      // o una sombra pasando por la franja. En los dos casos no cuenta como centrada.
      return { distancia: Math.abs((ini + fin + 1) / 2 / w - 0.5), entera: ini > 0 && fin < w - 1 && fin - ini + 1 >= o.anchoMinimo * w };
    }

    /** Procesa un cuadro. Devuelve { estado, ocupacion, guardar, evento, atascada }. evento: null | "botella" | "luz" */
    function procesar(g, w, h, t) {
      if (!fondo) { fondo = Float32Array.from(g); columnas = new Uint16Array(w); }
      if (estado === "aprendiendo") {
        ++cuenta;
        for (let i = 0; i < g.length; i++) fondo[i] += (g[i] - fondo[i]) / cuenta;
        if (cuenta >= o.cuadrosAprender) { estado = "libre"; cuenta = 0; }
        return { estado, ocupacion: 0, guardar: false, evento: null, atascada: false };
      }

      // Lo que no cambió sigue los cambios lentos de luz; lo que cambió no entra al fondo, así una botella detenida no se pierde.
      let cambiados = 0;
      columnas.fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, d = g[i] - fondo[i];
        if (Math.abs(d) > o.umbralPx) { cambiados++; columnas[x]++; } else fondo[i] += d * o.aprendizaje;
      }
      const b0 = Math.floor(w * (0.5 - o.franja / 2)), b1 = Math.ceil(w * (0.5 + o.franja / 2));
      let enFranja = 0;
      for (let x = b0; x < b1; x++) enFranja += columnas[x];
      const ocupacion = enFranja / ((b1 - b0) * h), total = cambiados / (w * h);
      let evento = null, guardar = false;

      if (estado === "libre") {
        if (total >= o.cambioLuz && previa < o.salir) {
          reiniciar();            // cambió todo de una: se vuelve a aprender el fondo sin contar nada
          return { estado, ocupacion, guardar: false, evento: "luz", atascada: false };
        }
        if (ocupacion >= o.entrar) {
          if (++cuenta >= o.cuadrosEntrada) { estado = "ocupada"; cuenta = 0; t0 = t; mejor = null; cancelada = false; }
        } else cuenta = 0;
      }

      if (estado === "ocupada") {
        // Se prefiere un cuadro centrado; entre los centrados, el más nítido. Nunca baja de categoría.
        const { distancia, entera } = distanciaAlCentro(w, h, b0, b1), esCentrada = entera && distancia <= o.centrada;
        const nit = nitidez(g, w, h);
        const mejora = !mejor
          || (esCentrada && !mejor.centrada)
          || (esCentrada && mejor.centrada && nit > mejor.nitidez)
          || (!esCentrada && !mejor.centrada && distancia < mejor.distancia);
        if (ocupacion >= o.entrar && mejora) { mejor = { nitidez: nit, centrada: esCentrada, distancia, razon: razonNitidez(g, w, h) }; guardar = true; }

        if (ocupacion < o.salir) {
          if (++cuenta >= o.cuadrosSalida) {
            if (mejor && !cancelada) evento = "botella";
            estado = "libre"; cuenta = 0; cancelada = false;
          }
        } else cuenta = 0;
      }

      previa = total;
      const atascada = estado === "ocupada" && t - t0 > o.avisoAtascoMs;
      return { estado, ocupacion, guardar, evento, nitidez: mejor?.nitidez ?? 0, razon: mejor?.razon ?? null, centrada: !!mejor?.centrada, atascada };
    }

    return {
      procesar, reiniciar,
      cancelar() { cancelada = true; },   // la botella que está pasando ya se registró a mano
      get estado() { return estado; },
    };
  }

  /** Conecta el núcleo con un video: achica el recuadro, lo pasa a gris y guarda el mejor cuadro en un canvas. */
  function crear(opciones = {}) {
    const nucleo = crearNucleo(opciones);
    const chico = document.createElement("canvas"), ctxChico = chico.getContext("2d", { willReadFrequently: true });
    const foto = document.createElement("canvas"), ctxFoto = foto.getContext("2d");
    let gris = null, tUltimo = -Infinity, ultimo = { atascada: false };

    /** roi en píxeles de la fuente. Si terminó de pasar una botella, devuelve también su mejor cuadro en `cuadro`. */
    function paso(fuente, roi, t) {
      if (t - tUltimo < MS_MINIMO) return { estado: nucleo.estado, evento: null, guardar: false, atascada: ultimo.atascada };
      tUltimo = t;
      const w = ANCHO, h = Math.max(8, Math.round(ANCHO * roi.h / roi.w));
      if (chico.width !== w || chico.height !== h) { chico.width = w; chico.height = h; gris = new Uint8ClampedArray(w * h); nucleo.reiniciar(); }
      ctxChico.drawImage(fuente, roi.x, roi.y, roi.w, roi.h, 0, 0, w, h);
      const px = ctxChico.getImageData(0, 0, w, h).data;
      for (let i = 0; i < gris.length; i++) gris[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;

      const r = ultimo = nucleo.procesar(gris, w, h, t);
      if (r.guardar) {
        const fw = Math.min(960, Math.round(roi.w)), fh = Math.round(fw * roi.h / roi.w);
        if (foto.width !== fw || foto.height !== fh) { foto.width = fw; foto.height = fh; }
        ctxFoto.drawImage(fuente, roi.x, roi.y, roi.w, roi.h, 0, 0, fw, fh);
      }
      return r.evento === "botella" ? { ...r, cuadro: foto } : r;
    }

    return { paso, reiniciar: nucleo.reiniciar, cancelar: nucleo.cancelar, get estado() { return nucleo.estado; } };
  }

  /** Sensibilidad de 0 a 100: más sensibilidad detecta diferencias de gris más chicas. */
  const umbralDeSensibilidad = s => Math.round(45 - 0.4 * s);

  global.Disparo = { crear, crearNucleo, nitidez, razonNitidez, umbralDeSensibilidad };
})(typeof window !== "undefined" ? window : globalThis);
