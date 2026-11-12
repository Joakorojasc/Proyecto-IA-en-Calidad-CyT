/* Quality AI · detector YOLOX (red neuronal entrenada con fotos marcadas).
 *
 * Reemplaza al detector clásico de motor.js cuando hay un modelo entrenado (frontend/modelos/etiquetas.onnx).
 * Recibe el recuadro de una cámara y devuelve la misma "vista" que motor.js, más la probabilidad de cada etiqueta:
 *   { frontal: { visto, confianza, prob }, trasera: { ... }, ve, dudosa, cajas: [...], ms }
 *
 * Corre en el navegador con ONNX Runtime Web. Las funciones de pre y post proceso son puras
 * (sin página) y se prueban con: node scripts/test_yolox.js
 */
(function (global) {
  const CLASES = ["frontal", "trasera"];      // el orden del entrenamiento (scripts/yolox/preparar_dataset.py)
  const PASOS = [8, 16, 32];                   // las 3 escalas de YOLOX
  const RELLENO = 114;                         // YOLOX rellena con gris 114 lo que sobra al cuadrar la imagen
  const ORT_VERSION = "1.17.3";
  const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  const ORT_LOCAL = "vendor/ort/";             // copia local (para el PC de la línea sin internet): scripts/yolox/bajar_ort.py

  const BASE = {
    puntajeMin: 0.25,     // cajas con menos puntaje ni se consideran
    iou: 0.45,            // dos cajas de la misma clase que se tapan más que esto son la misma etiqueta
    umbralVer: 0.5,       // desde aquí se da la etiqueta por vista en esta cámara
    zona: [0.1, 0.9],     // el centro de la caja tiene que caer en esta franja del recuadro: no cuentan las botellas vecinas
  };

  /* ---------------------------------------------------------------- pre proceso (puro) */

  /** Cuánto se achica la imagen para que quepa en el cuadrado de entrada, igual que en el entrenamiento. */
  const escalaPara = (w, h, tam) => Math.min(tam / w, tam / h);

  /**
   * RGBA (de un canvas de tam x tam ya relleno) a tensor CHW en orden BGR, valores 0-255 sin normalizar
   * (así lo espera YOLOX desde la versión 0.2).
   */
  function aTensor(rgba, tam) {
    const n = tam * tam, t = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      t[i] = rgba[i * 4 + 2];          // B
      t[n + i] = rgba[i * 4 + 1];      // G
      t[2 * n + i] = rgba[i * 4];      // R
    }
    return t;
  }

  /* ---------------------------------------------------------------- post proceso (puro) */

  const cantidadPara = tam => PASOS.reduce((s, p) => s + (tam / p) ** 2, 0);
  const tamPara = n => { for (const t of [320, 416, 480, 512, 608, 640, 736, 800, 960]) if (cantidadPara(t) === n) return t; return null; };

  /**
   * ¿La salida ya viene con las coordenadas decodificadas? Depende de cómo se exportó (--decode_in_inference).
   * Sin decodificar, x/y son desplazamientos dentro de una celda (cerca de 0-1) y w/h están en logaritmo (cerca de -3 a 3).
   */
  function vieneDecodificada(d, n, ancho) {
    let max = 0;
    for (let i = 0; i < n; i++) { const o = i * ancho; if (d[o + 4] > 0.3) max = Math.max(max, d[o], d[o + 1], d[o + 2], d[o + 3]); }
    return max > 20;
  }

  /** IoU entre dos cajas [x1, y1, x2, y2]. */
  function iou(a, b) {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const inter = ix * iy, ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
    return ua > 0 ? inter / ua : 0;
  }

  /** Supresión de no máximos por clase: de varias cajas sobre la misma etiqueta queda la de mayor puntaje. */
  function nms(cajas, umbral) {
    const orden = [...cajas].sort((a, b) => b.puntaje - a.puntaje), quedan = [];
    for (const c of orden) if (!quedan.some(q => q.clase === c.clase && iou(q.caja, c.caja) > umbral)) quedan.push(c);
    return quedan;
  }

  /**
   * Salida cruda del modelo → cajas en coordenadas del recuadro, normalizadas 0-1.
   * datos: Float32Array [n, 5 + clases] (x, y, w, h, objeto, clase0, clase1...). Ya trae sigmoide en objeto y clases.
   * tam: lado de entrada del modelo. escala: escalaPara(w, h, tam). w, h: tamaño del recuadro en píxeles.
   */
  function decodificar(datos, n, nClases, tam, escala, w, h, opciones = {}) {
    const o = { ...BASE, ...opciones }, ancho = 5 + nClases, cajas = [];
    const decodificada = o.decodificada ?? vieneDecodificada(datos, n, ancho);
    let i = 0;
    for (const paso of PASOS) {
      const lado = tam / paso;
      for (let gy = 0; gy < lado; gy++) for (let gx = 0; gx < lado; gx++, i++) {
        const k = i * ancho, obj = datos[k + 4];
        if (obj < o.puntajeMin) continue;
        let mejor = 0, clase = 0;
        for (let c = 0; c < nClases; c++) if (datos[k + 5 + c] > mejor) { mejor = datos[k + 5 + c]; clase = c; }
        const puntaje = obj * mejor;
        if (puntaje < o.puntajeMin) continue;
        const cx = decodificada ? datos[k] : (datos[k] + gx) * paso, cy = decodificada ? datos[k + 1] : (datos[k + 1] + gy) * paso;
        const bw = decodificada ? datos[k + 2] : Math.exp(datos[k + 2]) * paso, bh = decodificada ? datos[k + 3] : Math.exp(datos[k + 3]) * paso;
        // de la entrada del modelo (tam x tam, imagen arriba a la izquierda) al recuadro original
        const x1 = (cx - bw / 2) / escala, y1 = (cy - bh / 2) / escala, x2 = (cx + bw / 2) / escala, y2 = (cy + bh / 2) / escala;
        cajas.push({ clase, nombre: CLASES[clase] || "clase " + clase, puntaje, caja: [x1, y1, x2, y2] });
      }
    }
    return nms(cajas, o.iou).map(c => {
      const [x1, y1, x2, y2] = c.caja;
      const x = Math.max(0, x1 / w), y = Math.max(0, y1 / h), x2n = Math.min(1, x2 / w), y2n = Math.min(1, y2 / h);
      return { clase: c.clase, nombre: c.nombre, puntaje: c.puntaje, x, y, w: Math.max(0, x2n - x), h: Math.max(0, y2n - y) };
    });
  }

  /**
   * Cajas → vista de esta cámara. Solo cuentan las cajas cuyo centro cae en la zona central del recuadro
   * (la botella que se está revisando, no las vecinas). prob = el mayor puntaje de esa clase.
   */
  function vistaDesdeCajas(cajas, opciones = {}) {
    const o = { ...BASE, ...opciones };
    const enZona = c => { const cx = c.x + c.w / 2; return cx >= o.zona[0] && cx <= o.zona[1]; };
    const validas = cajas.filter(enZona), vista = { cajas, validas };
    let dudosa = false;
    for (const k of CLASES) {
      const prob = Math.max(0, ...validas.filter(c => c.nombre === k).map(c => c.puntaje));
      const visto = prob >= o.umbralVer;
      // confianza = qué tan segura es la decisión de esta cámara (vista o no vista), como en motor.js
      vista[k] = { visto, prob, confianza: visto ? prob : 1 - prob };
      if (prob >= o.umbralVer - 0.15 && prob < o.umbralVer + 0.15) dudosa = true;
    }
    const vistas = CLASES.filter(k => vista[k].visto);
    vista.ve = vistas.length === 2 ? "ambas" : vistas.length ? vistas[0] : "ninguna";
    vista.dudosa = dudosa;
    return vista;
  }

  /* ---------------------------------------------------------------- navegador */

  function cargarScript(src) {
    return new Promise((ok, mal) => {
      const s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = () => mal(new Error("no se pudo cargar " + src));
      document.head.appendChild(s);
    });
  }

  /** ONNX Runtime Web: primero la copia local (funciona sin internet), si no, desde el CDN. */
  async function cargarOrt() {
    if (global.ort) return global.ort;
    for (const base of [ORT_LOCAL, ORT_CDN]) {
      try {
        await cargarScript(base + "ort.min.js");
        global.ort.env.wasm.wasmPaths = new URL(base, location.href).href;
        global.ort.env.wasm.numThreads = global.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        return global.ort;
      } catch { /* prueba la siguiente */ }
    }
    throw new Error("No se pudo cargar ONNX Runtime (ni la copia local ni desde internet). Corre: python scripts/yolox/bajar_ort.py");
  }

  /**
   * Carga el modelo. origen: URL (por defecto modelos/etiquetas.onnx) o ArrayBuffer (archivo elegido a mano).
   * Devuelve un detector con detectar(fuente, roi) → Promise<vista>. Las detecciones van de a una (una sola sesión).
   */
  async function cargar(origen = "modelos/etiquetas.onnx", opciones = {}) {
    const ort = await cargarOrt();
    let bytes = origen;
    if (typeof origen === "string") {
      const r = await fetch(origen, { cache: "no-store" });
      if (!r.ok) throw Object.assign(new Error(`No está el modelo en frontend/${origen}. Copia ahí el etiquetas.onnx que exportaste en Colab, o cárgalo con el botón.`), { name: "SinModelo" });
      bytes = await r.arrayBuffer();
    }
    const sesion = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    const entrada = sesion.inputNames[0], salidaNombre = sesion.outputNames[0];
    const lienzo = document.createElement("canvas"), ctx = lienzo.getContext("2d", { willReadFrequently: true });
    let tam = opciones.tam || null, nClases = null, cola = Promise.resolve();

    async function correr(tensor, t) {
      const res = await sesion.run({ [entrada]: new ort.Tensor("float32", tensor, [1, 3, t, t]) });
      return res[salidaNombre];
    }
    // tamaño de entrada: se prueba con los habituales hasta que el modelo lo acepte (416 es el de exp_etiquetas.py)
    for (const t of tam ? [tam] : [416, 640, 320, 480, 512]) {
      try {
        const out = await correr(new Float32Array(3 * t * t).fill(RELLENO), t);
        const [, n, ancho] = out.dims;
        if (cantidadPara(t) !== n) continue;
        tam = t; nClases = ancho - 5; break;
      } catch { /* no era este tamaño */ }
    }
    if (!tam) throw new Error("El modelo no tiene la forma de YOLOX (entrada cuadrada de 320 a 640 px, salida [1, n, 5 + clases]).");
    if (nClases !== CLASES.length) console.warn(`El modelo tiene ${nClases} clases; se esperaban ${CLASES.length} (frontal, trasera).`);

    /** Una detección: recorta el recuadro, lo cuadra con relleno gris y corre el modelo. */
    async function detectarAhora(fuente, roi, ops) {
      const sw = fuente.videoWidth || fuente.width, sh = fuente.videoHeight || fuente.height;
      const r = roi || { x: 0, y: 0, w: sw, h: sh }, esc = escalaPara(r.w, r.h, tam);
      if (lienzo.width !== tam) { lienzo.width = tam; lienzo.height = tam; }
      ctx.fillStyle = `rgb(${RELLENO},${RELLENO},${RELLENO})`; ctx.fillRect(0, 0, tam, tam);
      ctx.drawImage(fuente, r.x, r.y, r.w, r.h, 0, 0, Math.round(r.w * esc), Math.round(r.h * esc));
      const t0 = performance.now();
      const out = await correr(aTensor(ctx.getImageData(0, 0, tam, tam).data, tam), tam);
      const cajas = decodificar(out.data, out.dims[1], out.dims[2] - 5, tam, esc, r.w, r.h, { ...opciones, ...ops });
      return { ...vistaDesdeCajas(cajas, { ...opciones, ...ops }), ms: performance.now() - t0 };
    }

    return {
      tam, nClases, nombre: typeof origen === "string" ? origen : "modelo cargado a mano",
      detectar(fuente, roi, ops = {}) {
        const p = cola.then(() => detectarAhora(fuente, roi, ops));
        cola = p.catch(() => {});
        return p;
      },
    };
  }

  global.Yolox = { CLASES, PASOS, BASE, escalaPara, aTensor, cantidadPara, tamPara, decodificar, vistaDesdeCajas, nms, iou, cargar, cargarOrt };
})(typeof window !== "undefined" ? window : globalThis);
