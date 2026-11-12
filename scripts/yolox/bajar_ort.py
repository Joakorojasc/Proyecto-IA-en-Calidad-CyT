"""Baja ONNX Runtime Web a frontend/vendor/ort/ para que YOLOX funcione sin internet (por ejemplo, en el PC de la línea).

Sin esta copia, la página lo carga desde internet (cdn.jsdelivr.net) cada vez que se abre.

Uso (una vez, con internet):
    python scripts/yolox/bajar_ort.py
"""
import os
import sys
import urllib.request

VERSION = "1.17.3"   # la misma que usa frontend/yolox.js
BASE = f"https://cdn.jsdelivr.net/npm/onnxruntime-web@{VERSION}/dist/"
ARCHIVOS = ["ort.min.js", "ort-wasm-simd.wasm", "ort-wasm.wasm", "ort-wasm-simd-threaded.wasm", "ort-wasm-threaded.wasm"]
DESTINO = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend", "vendor", "ort")

if __name__ == "__main__":
    os.makedirs(DESTINO, exist_ok=True)
    for nombre in ARCHIVOS:
        ruta = os.path.join(DESTINO, nombre)
        try:
            urllib.request.urlretrieve(BASE + nombre, ruta)
        except Exception as e:  # noqa: BLE001
            sys.exit(f"No se pudo bajar {nombre}: {e}")
        print(f"ok  {nombre}  ({os.path.getsize(ruta) / 1e6:.1f} MB)")
    print(f"Listo en {DESTINO}")
