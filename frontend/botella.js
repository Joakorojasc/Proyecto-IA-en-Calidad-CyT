/* Quality AI · la botella como unidad.
 *
 * Cada cámara (estación) entrega una lectura por botella que ve: qué etiquetas aparecen en su vista.
 * Aquí se juntan las lecturas de la misma botella y se decide:
 *   OK          solo si, sumando todas las vistas, aparecen la frontal y la trasera.
 *   RECHAZO     si falta alguna (se indica cuál).
 *   NO_REVISADA si alguna cámara no vio la botella. Cuenta como rechazo y nunca como OK.
 * Funciones puras, sin página: se prueban con node scripts/test_botella.js
 */
(function (global) {
  const NOMBRE = { frontal: "frontal", trasera: "trasera" };

  /** Umbrales de la decisión conjunta cuando las vistas traen probabilidad (detector YOLOX). */
  const UMBRALES = { ok: 0.9, rechazo: 0.5 };

  /**
   * Probabilidad conjunta de que una etiqueta exista, juntando todas las cámaras: P = 1 − Π(1 − p).
   * Basta con que UNA cámara la vea con seguridad; dos vistas dudosas que coinciden suman confianza.
   */
  const conjunta = ps => 1 - ps.reduce((m, p) => m * (1 - Math.min(1, Math.max(0, p))), 1);

  /**
   * lecturas: { A: vista | null, B: vista | null }. vista = { frontal: { visto, confianza, prob? }, trasera: { ... } }
   * La decisión es CONJUNTA: si A ve solo la frontal y B solo la trasera, la botella tiene las dos y pasa.
   *  - Con detector YOLOX (las vistas traen prob): OK si P ≥ umbrales.ok en las dos etiquetas; RECHAZO si alguna
   *    queda bajo umbrales.rechazo; en medio, RECHAZO marcado como dudoso (para revisar con la foto).
   *  - Con el detector clásico (sin prob): OK si alguna cámara vio cada etiqueta.
   */
  function fusionar(lecturas, umbrales = UMBRALES) {
    const est = Object.keys(lecturas);
    const sinVer = est.filter(e => !lecturas[e]);
    const vistas = est.filter(e => lecturas[e]).map(e => lecturas[e]);
    const conProb = vistas.length > 0 && vistas.every(v => typeof v.frontal?.prob === "number" && typeof v.trasera?.prob === "number");
    const prob = conProb ? Object.fromEntries(["frontal", "trasera"].map(k => [k, conjunta(vistas.map(v => v[k].prob))])) : null;
    const hay = k => conProb ? prob[k] >= umbrales.ok : vistas.some(v => v[k]?.visto);
    const frontal = hay("frontal"), trasera = hay("trasera");
    const conf = k => conProb ? prob[k] : Math.max(0, ...vistas.filter(v => v[k]?.visto).map(v => v[k].confianza ?? 0));
    const faltan = [!frontal && "frontal", !trasera && "trasera"].filter(Boolean);
    // dudosa: no llega a OK, pero tampoco hay evidencia clara de que falte (P entre los dos umbrales)
    const dudas = conProb ? faltan.filter(k => prob[k] >= umbrales.rechazo) : [];
    const pct = k => Math.round(100 * prob[k]) + " %";
    let final, motivo;
    if (sinVer.length) {
      final = "NO_REVISADA";
      motivo = `La cámara ${sinVer.join(" y ")} no vio la botella: no se puede asegurar que tenga sus etiquetas.`;
    } else if (!faltan.length) {
      final = "OK";
      motivo = conProb ? `Se vieron las dos etiquetas entre las cámaras (frontal ${pct("frontal")}, trasera ${pct("trasera")}).` : "Se vieron las dos etiquetas: frontal y trasera.";
    } else {
      final = "RECHAZO";
      if (dudas.length === faltan.length) motivo = `Duda: la etiqueta ${dudas.map(k => `${NOMBRE[k]} (${pct(k)})`).join(" y la ")} no se vio con seguridad. Revisar.`;
      else motivo = faltan.length === 2 ? "No se vio ninguna etiqueta." : `Falta la etiqueta ${NOMBRE[faltan[0]]}${conProb ? ` (${pct(faltan[0])})` : ""}.`;
    }
    return { final, frontal, trasera, faltan, sinVer, motivo, prob, dudosa: final === "RECHAZO" && dudas.length > 0 && dudas.length === faltan.length,
      confianza: final === "OK" ? Math.min(conf("frontal"), conf("trasera")) : null };
  }

  /**
   * Empareja las lecturas de varias estaciones por orden de llegada dentro de una ventana de tiempo.
   * desfaseMs: cuánto después que la primera estación llega la misma botella a la segunda (puede ser 0).
   * ventanaMs: tolerancia alrededor de ese desfase. Una lectura sin pareja al vencer la ventana sale sola (NO_REVISADA).
   * Con una sola estación (o con espejo) cada lectura es una botella.
   */
  function crearEmparejador({ estaciones = ["A", "B"], ventanaMs = 150, desfaseMs = 0, umbrales = UMBRALES } = {}) {
    const cola = Object.fromEntries(estaciones.map(e => [e, []]));
    const stats = { lecturas: 0, emparejadas: 0, vencidas: 0 };
    // momento esperado de la botella en la primera estación, para comparar entre estaciones
    const base = (e, t) => e === estaciones[0] ? t : t - desfaseMs;

    function botella(lecturas, t, porVencer) {
      const l = Object.fromEntries(estaciones.map(e => [e, lecturas[e] ?? null]));
      const tiempos = Object.fromEntries(estaciones.map(e => [e, lecturas[e] ? lecturas[e].t : null]));
      return { t, tiempos, lecturas: Object.fromEntries(estaciones.map(e => [e, l[e]?.vista ?? null])), extra: Object.fromEntries(estaciones.map(e => [e, l[e]?.extra ?? null])), vencida: !!porVencer, ...fusionar(Object.fromEntries(estaciones.map(e => [e, l[e]?.vista ?? null])), umbrales) };
    }

    /** Llega una lectura de la estación e en el momento t. Devuelve las botellas que quedaron completas. */
    function llega(e, vista, t, extra = null) {
      stats.lecturas++;
      const lectura = { vista, t, extra };
      if (estaciones.length === 1) return [botella({ [e]: lectura }, t)];
      const salida = revisar(t);
      const otras = estaciones.filter(x => x !== e);
      // por ahora 2 estaciones: busca en la otra la lectura más antigua dentro de la ventana
      const o = otras[0], b = base(e, t);
      const i = cola[o].findIndex(x => Math.abs(base(o, x.t) - b) <= ventanaMs);
      if (i >= 0) {
        const [par] = cola[o].splice(i, 1);
        // las que llegaron antes que la pareja en la otra cola ya no tienen con quién emparejarse
        stats.emparejadas++;
        salida.push(botella({ [e]: lectura, [o]: par }, Math.min(t, par.t)));
      } else cola[e].push(lectura);
      return salida;
    }

    /** Saca las lecturas que ya no pueden encontrar pareja (venció su ventana). */
    function revisar(t) {
      const salida = [];
      for (const e of estaciones) {
        const limite = e === estaciones[0] ? desfaseMs + ventanaMs : Math.max(0, ventanaMs - desfaseMs);
        while (cola[e].length && t - cola[e][0].t > limite) {
          const l = cola[e].shift();
          stats.vencidas++;
          salida.push(botella({ [e]: l }, l.t, true));
        }
      }
      return salida.sort((a, b) => a.t - b.t);
    }

    /** Fin de la prueba: todo lo pendiente sale como no revisado. */
    const vaciar = () => revisar(Infinity);
    return { llega, revisar, vaciar, stats, get pendientes() { return estaciones.reduce((s, e) => s + cola[e].length, 0); } };
  }

  /** Lleva la cuenta de rechazos seguidos para avisar "revisar etiquetadora". */
  function crearVigilante({ racha = 3 } = {}) {
    let seguidos = 0, avisada = false;
    return {
      botella(final) {
        seguidos = final === "OK" ? 0 : seguidos + 1;
        const aviso = seguidos >= racha && !avisada;
        if (aviso) avisada = true;
        if (seguidos === 0) avisada = false;
        return { seguidos, racha: seguidos >= racha, avisoNuevo: aviso };
      },
      reiniciar() { seguidos = 0; avisada = false; },
      get seguidos() { return seguidos; },
    };
  }

  global.Botella = { fusionar, conjunta, UMBRALES, crearEmparejador, crearVigilante };
})(typeof window !== "undefined" ? window : globalThis);
