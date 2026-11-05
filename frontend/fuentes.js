/* Quality AI · fuentes de imagen intercambiables.
 *
 * Cada estación (cámara A, cámara B) tiene una fuente. Todas se usan igual:
 *   fuente.tipo        "camara" | "video" | "simulada"
 *   fuente.iniciar()   Promise
 *   fuente.detener()
 *   fuente.lista()     true cuando ya hay imagen
 *   fuente.imagen      lo que se dibuja (video o canvas)
 * Conectar la 2.ª cámara es elegir otra fuente en el menú: no cambia nada más.
 */
(function (global) {
  /** Cámaras conectadas. Sin permiso previo los nombres vienen vacíos. */
  async function camaras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  }

  /** ¿Ya se dio permiso de cámara? Sirve para encenderla sola al abrir la página. */
  async function hayPermiso() {
    try { return (await navigator.permissions.query({ name: "camera" })).state === "granted"; } catch { return false; }
  }

  function nuevoVideo() {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true;
    return v;
  }

  /** Cámara real. 720p: suficiente para la etiqueta y no satura el USB cuando hay dos cámaras. */
  function camara(deviceId) {
    const video = nuevoVideo();
    let stream = null;
    const f = {
      tipo: "camara", imagen: video, deviceId: deviceId || null, nombre: "Cámara",
      async iniciar() {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error("Abre la página desde http://localhost:8000/frontend/producto.html: con doble clic al archivo el navegador no deja usar la cámara."), { name: "Inseguro" });
        }
        const base = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { ...base, deviceId: { exact: deviceId } } : base });
        } catch (e) {
          // la cámara recordada ya no está (otro puerto USB, otro computador): se usa la que haya
          if (deviceId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: base });
          else throw e;
        }
        video.srcObject = stream; await video.play();
        const pista = stream.getVideoTracks()[0], aj = pista?.getSettings() || {};
        f.deviceId = aj.deviceId || deviceId; f.nombre = pista?.label || "Cámara";
        f.resolucion = aj.width ? `${aj.width}×${aj.height}` : "";
        f.cps = aj.frameRate ? Math.round(aj.frameRate) : null;
      },
      detener() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; },
      lista: () => !!stream && video.readyState >= 2 && video.videoWidth > 0,
      /** Exposición corta para que la botella en movimiento no salga movida. Muchas webcams no lo permiten. */
      async exposicionCorta(activar) {
        const pista = stream?.getVideoTracks()[0];
        const cap = pista?.getCapabilities?.() || {};
        if (!cap.exposureMode || !cap.exposureTime) return { ok: false, motivo: "Esta cámara no deja ajustar la exposición desde el navegador. Usa más luz." };
        try {
          if (activar) {
            const min = cap.exposureTime.min, max = cap.exposureTime.max;
            // exposureTime viene en unidades de 100 µs: se apunta a ~1/1000 s (10), dentro de lo que permite la cámara
            const objetivo = Math.max(min, Math.min(max, 10));
            await pista.applyConstraints({ advanced: [{ exposureMode: "manual", exposureTime: objetivo }] });
            return { ok: true, motivo: `Exposición fijada en ${(objetivo / 10).toFixed(1)} ms.` };
          }
          await pista.applyConstraints({ advanced: [{ exposureMode: "continuous" }] });
          return { ok: true, motivo: "Exposición automática." };
        } catch (e) { return { ok: false, motivo: "La cámara rechazó el ajuste: " + e.message }; }
      },
    };
    return f;
  }

  /** Video grabado, reproducido en bucle: para probar sin estar frente a la línea. */
  function video(archivo) {
    const v = nuevoVideo();
    v.loop = true;
    let url = null;
    return {
      tipo: "video", imagen: v, nombre: archivo.name,
      async iniciar() { url = URL.createObjectURL(archivo); v.src = url; await v.play(); },
      detener() { v.pause(); v.removeAttribute("src"); if (url) URL.revokeObjectURL(url); url = null; },
      lista: () => !!url && v.readyState >= 2 && v.videoWidth > 0,
    };
  }

  /**
   * Cámara simulada. Dibuja en su canvas el cuadro que le toca y además lo entrega en gris (para el disparo y el detector,
   * sin pasar por el canvas, igual que en las pruebas con Node).
   */
  function simulada(cam) {
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    let img = null;
    return {
      tipo: "simulada", imagen: canvas, cam, nombre: "Simulada",
      async iniciar() { },
      detener() { },
      lista: () => true,
      /** Pinta un cuadro en gris (Uint8, w x h). */
      pintar(g, w, h) {
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; img = ctx.createImageData(w, h); }
        const d = img.data;
        // un toque verde en lo oscuro para que se parezca a vidrio de botella de vino
        for (let i = 0; i < g.length; i++) { const v = g[i], k = i * 4, o = v < 120 ? (120 - v) * 0.25 : 0; d[k] = v - o; d[k + 1] = v + o * 0.6; d[k + 2] = v - o * 0.4; d[k + 3] = 255; }
        ctx.putImageData(img, 0, 0);
      },
    };
  }

  global.Fuentes = { camaras, hayPermiso, camara, video, simulada };
})(window);
