/* Quality AI · vigilante de cámara.
 *
 * Avisa cuando una cámara queda ciega: si la cámara no ve, las botellas pasan sin revisar.
 * Revisa cada cuadro (ya recortado al recuadro, en gris y chico) y decide un nivel:
 *   aprendiendo  los primeros segundos, mientras aprende cómo se ve la cámara sana (o si nunca entregó imagen).
 *   ok           todo bien.
 *   aviso        algo anda mal pero la cámara igual ve (muchas fotos movidas).
 *   ciega        la cámara no está viendo: negra, quemada, congelada, borrosa, movida o sin imagen.
 * Cada causa debe sostenerse un rato antes de avisar, y la vuelta a la normalidad también: así no parpadea.
 * Lógica pura, sin página: se prueba con node scripts/test_salud.js
 */
(function (global) {
  // de la más grave a la menos grave: si hay varias, se informa la primera
  const PRIORIDAD = ["sin_imagen", "congelada", "oscura", "quemada", "posicion", "desenfocada"];

  const TEXTOS = {
    oscura: "Imagen negra: la cámara está tapada o sin luz.",
    quemada: "Imagen quemada: demasiada luz o reflejo.",
    congelada: "La imagen no cambia: la cámara se congeló.",
    desenfocada: "Imagen borrosa: revisa el foco o limpia el lente.",
    posicion: "La cámara se movió o algo tapa el recuadro.",
    sin_imagen: "La cámara dejó de entregar imagen.",
    fotos_movidas: "Muchas fotos movidas: baja la exposición o agrega luz.",
    ok: "La cámara está viendo bien.",
    aprendiendo: "Aprendiendo cómo se ve la cámara…",
    no_conectada: "Esperando imagen de la cámara.",
  };

  const BASE = {
    msConfirmar: 2000,          // cuánto debe durar una falla antes de declarar la cámara ciega
    msRecuperar: 1500,          // cuánto debe durar sin fallas para darla por recuperada
    oscura: 18,                 // brillo medio bajo el cual la imagen es negra
    quemadaPx: 250,             // gris desde el cual un punto está quemado
    quemada: 0.6,               // fracción de puntos quemados para decir que la imagen está quemada
    plano: 1.5,                 // desviación bajo la cual la imagen es pareja (negra o blanca sin ruido): no se juzga congelada
    msCongelada: 3000,          // tiempo sin ningún cambio en la imagen para decir que se congeló
    cuadrosAprender: 60,        // cuadros nuevos para terminar de aprender...
    msAprender: 3000,           // ...o este tiempo, lo que pase primero
    sanosParaFuncionar: 3,      // cuadros sanos para decir que la cámara ya estuvo funcionando
    muestrasRef: 30,            // muestras de nitidez para fijar la referencia
    msVentana: 2000,            // ventana de la mediana móvil de nitidez
    minMuestras: 8,             // muestras mínimas en la ventana para juzgar desenfoque
    desenfoque: 0.3,            // borrosa si la nitidez cae bajo esta fracción de la referencia
    adaptaNitidez: 0.002,       // qué tan rápido la referencia sigue cambios lentos (solo si la nitidez está sana)
    franja: 0.08,               // franja central que el disparo asegura libre cuando libre=true (igual que Disparo)
    correlacion: 0.5,           // bajo esto el fondo ya no se parece a la plantilla
    cuantilCorrelacion: 0.75,   // se mira la correlación del 75 % de los bloques más parecidos: un pedazo de botella en el borde no basta
    texturaMin: 6,              // desviación mínima de un bloque de la plantilla para usarlo
    bloquesX: 8, bloquesY: 4,   // la plantilla se compara por bloques
    minBloques: 4,              // bloques con textura necesarios para juzgar la posición
    cuadrosPlantilla: 10,       // cuadros libres para aprender la plantilla del fondo
    adaptaPlantilla: 0.02,      // qué tan rápido la plantilla sigue al fondo (solo bloques que calzan bien)
    cadaNitidez: 1,             // se mide la nitidez de la franja cada tantos cuadros libres (es barata)
    cadaPosicion: 3,            // se compara con la plantilla cada tantos cuadros libres
    lecturasVentana: 20,        // últimas lecturas para contar fotos movidas
    lecturasMin: 10,            // lecturas mínimas para avisar
    movidas: 0.5,               // aviso si más de esta fracción salió movida
    finMovidas: 0.4,            // el aviso termina cuando baja de esta fracción
  };

  /** Nitidez: varianza del Laplaciano entre las columnas x0 y x1 (igual que Disparo.nitidez sobre todo el ancho). */
  function nitidez(g, w, h, x0 = 1, x1 = w - 1) {
    let suma = 0, suma2 = 0, n = 0;
    x0 = Math.max(1, x0); x1 = Math.min(w - 1, x1);
    for (let y = 1; y < h - 1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x, l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      suma += l; suma2 += l * l; n++;
    }
    return n ? suma2 / n - (suma / n) ** 2 : 0;
  }

  function cuantil(valores, q) {
    const s = Float64Array.from(valores).sort();
    if (!s.length) return 0;
    const p = q * (s.length - 1), i = Math.floor(p);
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (p - i) : s[i];
  }
  const mediana = v => cuantil(v, 0.5);

  function crear(opciones = {}) {
    const o = { ...BASE, ...opciones };
    let w0, h0, previo, tUltimoCambio, tPrimer, nuevos, sanos, cuentaNit, cuentaPos, sinSenal;
    let inicio, borrosa, posicionMal, nit;
    let plantilla, suma, cuadrosFondo, pw, ph;
    let lecturas, aviso, desdeAviso;
    let ciega, desdeCiega, tSano, nivelPrevio, desde, ultimo;

    function reiniciar() {
      w0 = h0 = 0; previo = null; tUltimoCambio = 0; tPrimer = null; nuevos = 0; sanos = 0; cuentaNit = 0; cuentaPos = 0; sinSenal = false;
      inicio = {}; borrosa = false; posicionMal = false; nit = { ref: null, primeras: [], ventana: [] };
      plantilla = null; suma = null; cuadrosFondo = 0;
      lecturas = []; aviso = false; desdeAviso = 0;
      ciega = null; desdeCiega = 0; tSano = null; nivelPrevio = "aprendiendo"; desde = 0;
      ultimo = { nivel: "aprendiendo", causa: null, texto: TEXTOS.aprendiendo, desde: 0 };
    }
    reiniciar();

    /** Marca si una causa está presente ahora. Guarda desde cuándo está presente sin interrupción. */
    function marcar(c, activa, t, desdeForzado) {
      if (!activa) inicio[c] = null;
      else if (inicio[c] == null) inicio[c] = desdeForzado ?? t;
    }

    /** Cambió el tamaño del recuadro: lo aprendido de la imagen ya no sirve. */
    function nuevaImagen(w, h) {
      w0 = w; h0 = h; previo = new Uint8Array(w * h); nuevos = 0; cuentaNit = 0; cuentaPos = 0;
      nit = { ref: null, primeras: [], ventana: [] }; borrosa = false; posicionMal = false;
      pw = Math.ceil(w / 2); ph = Math.ceil(h / 2);
      plantilla = null; suma = new Float32Array(pw * ph); cuadrosFondo = 0;
    }

    /**
     * Agrega una muestra de nitidez del fondo y revisa si la mediana reciente cayó muy bajo la referencia.
     * Solo se mide el fondo (franja libre): la nitidez de las botellas depende demasiado de qué lado muestran
     * (etiqueta o vidrio) y una racha de botellas sin etiqueta parecería un lente borroso.
     */
    function muestraNitidez(valor, t) {
      nit.ventana.push({ t, v: valor });
      while (t - nit.ventana[0].t > o.msVentana) nit.ventana.shift();
      if (nit.ref === null) {
        nit.primeras.push(valor);
        if (nit.primeras.length >= o.muestrasRef) { nit.ref = mediana(nit.primeras); nit.primeras = []; }
      }
      if (nit.ref === null || nit.ventana.length < o.minMuestras) { borrosa = false; return; }
      const med = mediana(nit.ventana.map(x => x.v));
      borrosa = med < o.desenfoque * nit.ref;
      // la referencia sigue cambios lentos solo mientras la imagen está sana
      if (med > 0.7 * nit.ref) nit.ref += (med - nit.ref) * o.adaptaNitidez;
    }

    /**
     * Compara el fondo (cuadro con la franja libre) con la plantilla, por bloques y sin la media de cada bloque,
     * así un cambio de brillo no afecta. Se toma un punto de cada 2 en x e y.
     */
    function revisarPosicion(g, w, h) {
      if (!plantilla) {
        for (let y = 0, j = 0; y < h; y += 2) for (let x = 0; x < w; x += 2, j++) suma[j] += g[y * w + x];
        if (++cuadrosFondo >= o.cuadrosPlantilla) { plantilla = suma.map(v => v / cuadrosFondo); suma = null; }
        return;
      }
      if (++cuentaPos % o.cadaPosicion) return;
      const nb = o.bloquesX * o.bloquesY, s = new Float64Array(nb * 6);   // n, sa, sb, saa, sbb, sab por bloque
      for (let y = 0, j = 0; y < h; y += 2) {
        const by = Math.min(o.bloquesY - 1, ((y >> 1) * o.bloquesY / ph) | 0);
        for (let x = 0; x < w; x += 2, j++) {
          const b = (by * o.bloquesX + Math.min(o.bloquesX - 1, ((x >> 1) * o.bloquesX / pw) | 0)) * 6;
          const a = g[y * w + x], p = plantilla[j];
          s[b]++; s[b + 1] += a; s[b + 2] += p; s[b + 3] += a * a; s[b + 4] += p * p; s[b + 5] += a * p;
        }
      }
      const corr = new Float64Array(nb).fill(NaN), usados = [];
      for (let b = 0; b < nb; b++) {
        const [n, sa, sb, saa, sbb, sab] = s.subarray(b * 6, b * 6 + 6);
        const va = saa - sa * sa / n, vb = sbb - sb * sb / n;
        if (!n || vb / n < o.texturaMin ** 2) continue;            // bloque sin textura en la plantilla: no sirve
        corr[b] = va > 1e-6 ? (sab - sa * sb / n) / Math.sqrt(va * vb) : 0;
        usados.push(corr[b]);
      }
      if (usados.length < o.minBloques) { posicionMal = false; return; }
      posicionMal = cuantil(usados, o.cuantilCorrelacion) < o.correlacion;
      if (posicionMal) return;
      // la plantilla sigue de a poco al fondo (luz lenta), solo en los bloques que calzan bien
      for (let y = 0, j = 0; y < h; y += 2) {
        const by = Math.min(o.bloquesY - 1, ((y >> 1) * o.bloquesY / ph) | 0);
        for (let x = 0; x < w; x += 2, j++) {
          const b = by * o.bloquesX + Math.min(o.bloquesX - 1, ((x >> 1) * o.bloquesX / pw) | 0);
          if (corr[b] > 0.8) plantilla[j] += (g[y * w + x] - plantilla[j]) * o.adaptaPlantilla;
        }
      }
    }

    /** Junta todo y decide el nivel. Devuelve el resultado con `cambio` solo cuando cambia el nivel. */
    function decidir(t) {
      const espera = c => c === "congelada" ? Math.max(o.msConfirmar, o.msCongelada) : o.msConfirmar;
      const confirmada = PRIORIDAD.find(c => inicio[c] != null && t - inicio[c] >= espera(c)) || null;
      const alguna = PRIORIDAD.some(c => inicio[c] != null);
      let duracionMs;

      if (!ciega) {
        if (confirmada) { ciega = confirmada; desdeCiega = inicio[confirmada]; tSano = null; }
      } else if (confirmada) { ciega = confirmada; tSano = null; }   // puede cambiar de causa sin dejar de estar ciega
      else if (alguna) tSano = null;
      else {
        if (tSano === null) tSano = t;
        if (t - tSano >= o.msRecuperar) { duracionMs = tSano - desdeCiega; ciega = null; tSano = null; }
      }

      const aprendiendo = nuevos < o.cuadrosAprender && (tPrimer === null || t - tPrimer < o.msAprender);
      const noConectada = sinSenal && sanos < o.sanosParaFuncionar;
      let nivel, causa = null, texto;
      if (ciega) { nivel = "ciega"; causa = ciega; texto = TEXTOS[ciega]; }
      else if (aviso) { nivel = "aviso"; causa = "fotos_movidas"; texto = TEXTOS.fotos_movidas; }
      else if (noConectada) { nivel = "aprendiendo"; texto = TEXTOS.no_conectada; }
      else if (aprendiendo) { nivel = "aprendiendo"; texto = TEXTOS.aprendiendo; }
      else { nivel = "ok"; texto = TEXTOS.ok; }

      let cambio = null;
      if (nivel !== nivelPrevio) {
        if (nivel === "ciega") { cambio = "ciega"; desde = desdeCiega; }
        else if (nivelPrevio === "ciega") cambio = "recuperada";
        else if (nivel === "aviso") cambio = "aviso";
        else if (nivelPrevio === "aviso") cambio = "fin_aviso";
        if (nivel === "aviso") desde = desdeAviso;
        else if (nivel !== "ciega") desde = t;
        nivelPrevio = nivel;
      }
      ultimo = { nivel, causa, texto, desde };
      const r = { ...ultimo, cambio };
      if (cambio === "recuperada") r.duracionMs = duracionMs;
      return r;
    }

    /** Un cuadro en gris (w x h) del recuadro. libre: el disparo dice que no hay botella en la franja. */
    function cuadro(g, w, h, t, { libre } = {}) {
      sinSenal = false; marcar("sin_imagen", false, t);
      if (w !== w0 || h !== h0) nuevaImagen(w, h);
      if (tPrimer === null) { tPrimer = t; if (nivelPrevio === "aprendiendo") desde = t; }

      const n = w * h;
      let s = 0, s2 = 0, quemados = 0, distinto = !nuevos;
      for (let i = 0; i < n; i++) { const v = g[i]; s += v; s2 += v * v; if (v >= o.quemadaPx) quemados++; }
      if (!distinto) for (let i = 0; i < n; i++) if (g[i] !== previo[i]) { distinto = true; break; }
      const media = s / n, desv = Math.sqrt(Math.max(0, s2 / n - media * media));
      const oscura = media < o.oscura, quemada = quemados / n > o.quemada, plano = desv < o.plano;
      if (distinto) { previo.set(g); tUltimoCambio = t; nuevos++; }

      marcar("congelada", !plano && t - tUltimoCambio >= o.msCongelada, t, tUltimoCambio);
      marcar("oscura", oscura, t);
      marcar("quemada", quemada, t);

      if (oscura || quemada) { posicionMal = false; borrosa = false; }
      else if (distinto) {
        sanos++;
        if (libre === true) {
          // con la franja libre se mide solo la franja: ahí se ve el fondo, sin pedazos de botella
          if (++cuentaNit % o.cadaNitidez === 0) {
            const x0 = Math.floor(w * (0.5 - o.franja / 2)), x1 = Math.ceil(w * (0.5 + o.franja / 2));
            muestraNitidez(nitidez(g, w, h, x0, x1), t);
          }
          revisarPosicion(g, w, h);
        }
      }
      // si la franja lleva rato ocupada, la ventana de nitidez se vacía y no se juzga
      if (nit.ventana.length && t - nit.ventana[nit.ventana.length - 1].t > o.msVentana) { nit.ventana = []; borrosa = false; }
      marcar("posicion", posicionMal, t);
      marcar("desenfocada", borrosa, t);
      return decidir(t);
    }

    /** La fuente no entregó imagen. Solo es falla si la cámara ya había funcionado (o ya estaba ciega). */
    function sinImagen(t) {
      sinSenal = true;
      for (const c of ["congelada", "oscura", "quemada", "posicion", "desenfocada"]) marcar(c, false, t);
      posicionMal = false; borrosa = false;
      nuevos = Math.max(nuevos, 1); previo && previo.fill(0); tUltimoCambio = t;   // el próximo cuadro cuenta como nuevo
      marcar("sin_imagen", sanos >= o.sanosParaFuncionar || !!ciega, t);
      return decidir(t);
    }

    /** Una botella leída por esta cámara. movida: la foto salió movida. */
    function lectura(movida, t) {
      lecturas.push(!!movida);
      if (lecturas.length > o.lecturasVentana) lecturas.shift();
      const frac = lecturas.filter(Boolean).length / lecturas.length;
      if (!aviso && lecturas.length >= o.lecturasMin && frac > o.movidas) { aviso = true; desdeAviso = t; }
      else if (aviso && frac < o.finMovidas) aviso = false;
      return decidir(t);
    }

    return { cuadro, sinImagen, lectura, reiniciar, get estado() { return { ...ultimo }; } };
  }

  global.Salud = { crear, BASE, TEXTOS, nitidez };
})(typeof window !== "undefined" ? window : globalThis);
