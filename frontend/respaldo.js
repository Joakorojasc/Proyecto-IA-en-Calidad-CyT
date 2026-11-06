/* Quality AI · respaldo en disco.
 *
 * Manda cada botella (y la foto de los rechazos) y cada evento de cámara al servidor local (scripts/servidor.py),
 * que los guarda en datos/registro.sqlite y datos/fotos/. Así el registro no depende del navegador y queda
 * evidencia de cada rechazo.
 *   - Se manda por lotes cada 2 s: a 10.000 botellas por hora no conviene una solicitud por botella.
 *   - Si el servidor no responde, lo pendiente se guarda en memoria y se reintenta. El servidor no duplica:
 *     cada botella se identifica por (sesión, número).
 *   - Con `python -m http.server` (sin respaldo) la página sigue funcionando igual; solo avisa que no hay respaldo.
 */
(function (global) {
  const LOTE = 40;                 // botellas por envío (con fotos, ~5 MB como máximo)
  const MAX_PENDIENTES = 20000;    // ~2 horas a 10.000/h sin servidor; después se descartan las fotos más viejas
  const MAX_FOTOS_PENDIENTES = 400;

  const dos = v => String(v).padStart(2, "0");
  function nuevaSesion() {
    const d = new Date();
    return `${d.getFullYear()}${dos(d.getMonth() + 1)}${dos(d.getDate())}-${dos(d.getHours())}${dos(d.getMinutes())}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function crear({ base = "/api", cadaMs = 2000, alCambiar = null, alGuardar = null } = {}) {
    const sesion = nuevaSesion();
    const cola = [], eventos = [];
    let fotosEnCola = 0, enviando = false, reloj = null, reintentoMs = cadaMs;
    const st = { disponible: null, pendientes: 0, enviadas: 0, error: "", sinEspacio: false, carpeta: "", ultimo: 0, sesion };

    const avisar = () => { st.pendientes = cola.length + eventos.length; alCambiar?.(st); };

    async function revisarServidor() {
      try {
        const r = await fetch(base + "/estado", { cache: "no-store" });
        if (!r.ok) throw new Error("sin respaldo");
        const j = await r.json();
        st.disponible = !!j.ok; st.carpeta = j.carpeta || ""; st.error = "";
        st.sinEspacio = j.libreMB != null && j.libreMB < 500;
      } catch {
        st.disponible = false; st.error = "El servidor no tiene respaldo en disco. Ábrelo con python3 scripts/servidor.py.";
      }
      avisar();
      return st.disponible;
    }

    async function enviar(ruta, cuerpo) {
      const r = await fetch(base + ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({ ok: false, error: `respuesta ${r.status}` }));
      if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || `respuesta ${r.status}`), { status: r.status });
      return j;
    }

    async function vaciar() {
      if (enviando || (!cola.length && !eventos.length)) return;
      if (st.disponible === false) return;   // se vuelve a probar en revisarServidor()
      enviando = true;
      try {
        if (eventos.length) {
          const lote = eventos.slice(0, 200);
          await enviar("/eventos", { sesion, eventos: lote });
          eventos.splice(0, lote.length);
        }
        while (cola.length) {
          const lote = cola.slice(0, LOTE);
          const j = await enviar("/botellas", { sesion, botellas: lote.map(x => x.fila) });
          cola.splice(0, lote.length);
          for (const x of lote) if (x.fila.fotos) fotosEnCola--;
          st.enviadas += lote.length; st.ultimo = Date.now(); st.error = ""; st.sinEspacio = !!j.sinEspacio;
          if (j.fotos) alGuardar?.(j.fotos);
        }
        reintentoMs = cadaMs;
      } catch (e) {
        // 400 o 413: el lote tiene algo que el servidor no acepta; se manda sin fotos para no trabar la cola
        if (e.status === 400 || e.status === 413) {
          const lote = cola.slice(0, LOTE);
          if (lote.some(x => x.fila.fotos)) {
            for (const x of lote) if (x.fila.fotos) { delete x.fila.fotos; fotosEnCola--; }
            st.error = "El servidor rechazó un envío (" + e.message + "). Se reintenta sin fotos.";
          } else {
            // sin fotos y aun así rechazado: el lote tiene un dato malo; se descarta para no trabar la cola para siempre
            cola.splice(0, lote.length);
            st.error = `El servidor rechazó ${lote.length} botellas (${e.message}). Quedaron solo en el registro del navegador.`;
          }
        } else {
          st.error = "No se pudo guardar en disco: " + e.message + ". Se reintenta.";
          reintentoMs = Math.min(30000, reintentoMs * 2);
          if (e instanceof TypeError) st.disponible = false;   // fetch falló: el servidor se cayó
        }
      } finally {
        enviando = false;
        avisar();
      }
    }

    function programar() {
      clearTimeout(reloj);
      reloj = setTimeout(async () => {
        if (st.disponible !== true) await revisarServidor();
        await vaciar();
        programar();
      }, st.disponible === true ? reintentoMs : 15000);
    }

    return {
      get estado() { return st; },
      sesion,
      async iniciar() { await revisarServidor(); programar(); },
      /** fila: la botella como queda en el registro. fotos: { A: dataURL, B: dataURL } o null. */
      botella(fila, fotos) {
        const f = { ...fila };
        // las miniaturas ya van en el registro local; al disco va la foto grande (si hay)
        for (const e of ["A", "B"]) if (f[e]) { f[e] = { ...f[e] }; delete f[e].thumb; delete f[e].foto; }
        if (fotos && Object.keys(fotos).length) { f.fotos = fotos; fotosEnCola++; }
        cola.push({ fila: f });
        // sin servidor por mucho rato: primero se botan las fotos más viejas, después las filas más viejas
        while (fotosEnCola > MAX_FOTOS_PENDIENTES) { const x = cola.find(c => c.fila.fotos); if (!x) break; delete x.fila.fotos; fotosEnCola--; }
        if (cola.length > MAX_PENDIENTES) { const [x] = cola.splice(0, 1); if (x.fila.fotos) fotosEnCola--; }
        avisar();
      },
      evento(e) { eventos.push(e); avisar(); if (st.disponible) vaciar(); },
      /** Al cerrar la página: lo pendiente sin fotos, en una sola solicitud que el navegador manda aunque se cierre. */
      despedida() {
        if (!st.disponible || !navigator.sendBeacon) return;
        if (eventos.length) navigator.sendBeacon(base + "/eventos", new Blob([JSON.stringify({ sesion, eventos })], { type: "application/json" }));
        // sendBeacon acepta ~64 KB: solo las 100 primeras, sin fotos
        const filas = cola.slice(0, 100).map(x => { const f = { ...x.fila }; delete f.fotos; return f; });
        if (filas.length) navigator.sendBeacon(base + "/botellas", new Blob([JSON.stringify({ sesion, botellas: filas })], { type: "application/json" }));
      },
    };
  }

  global.Respaldo = { crear };
})(typeof window !== "undefined" ? window : globalThis);
