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

  /** lecturas: { A: vista | null, B: vista | null }. vista = { frontal: { visto, confianza }, trasera: { ... } } */
  function fusionar(lecturas) {
    const est = Object.keys(lecturas);
    const sinVer = est.filter(e => !lecturas[e]);
    const vistas = est.filter(e => lecturas[e]).map(e => lecturas[e]);
    const frontal = vistas.some(v => v.frontal?.visto), trasera = vistas.some(v => v.trasera?.visto);
    const conf = k => Math.max(0, ...vistas.filter(v => v[k]?.visto).map(v => v[k].confianza ?? 0));
    const faltan = [!frontal && "frontal", !trasera && "trasera"].filter(Boolean);
    let final, motivo;
    if (sinVer.length) {
      final = "NO_REVISADA";
      motivo = `La cámara ${sinVer.join(" y ")} no vio la botella: no se puede asegurar que tenga sus etiquetas.`;
    } else if (!faltan.length) {
      final = "OK";
      motivo = "Se vieron las dos etiquetas: frontal y trasera.";
    } else {
      final = "RECHAZO";
      motivo = faltan.length === 2 ? "No se vio ninguna etiqueta." : `Falta la etiqueta ${NOMBRE[faltan[0]]}.`;
    }
    return { final, frontal, trasera, faltan, sinVer, motivo, confianza: final === "OK" ? Math.min(conf("frontal"), conf("trasera")) : null };
  }

  /**
   * Empareja las lecturas de varias estaciones por orden de llegada dentro de una ventana de tiempo.
   * desfaseMs: cuánto después que la primera estación llega la misma botella a la segunda (puede ser 0).
   * ventanaMs: tolerancia alrededor de ese desfase. Una lectura sin pareja al vencer la ventana sale sola (NO_REVISADA).
   * Con una sola estación (o con espejo) cada lectura es una botella.
   */
  function crearEmparejador({ estaciones = ["A", "B"], ventanaMs = 150, desfaseMs = 0 } = {}) {
    const cola = Object.fromEntries(estaciones.map(e => [e, []]));
    const stats = { lecturas: 0, emparejadas: 0, vencidas: 0 };
    // momento esperado de la botella en la primera estación, para comparar entre estaciones
    const base = (e, t) => e === estaciones[0] ? t : t - desfaseMs;

    function botella(lecturas, t, porVencer) {
      const l = Object.fromEntries(estaciones.map(e => [e, lecturas[e] ?? null]));
      const tiempos = Object.fromEntries(estaciones.map(e => [e, lecturas[e] ? lecturas[e].t : null]));
      return { t, tiempos, lecturas: Object.fromEntries(estaciones.map(e => [e, l[e]?.vista ?? null])), extra: Object.fromEntries(estaciones.map(e => [e, l[e]?.extra ?? null])), vencida: !!porVencer, ...fusionar(Object.fromEntries(estaciones.map(e => [e, l[e]?.vista ?? null]))) };
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

  global.Botella = { fusionar, crearEmparejador, crearVigilante };
})(typeof window !== "undefined" ? window : globalThis);
