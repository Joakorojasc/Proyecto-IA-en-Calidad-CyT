"""Servidor local de Quality AI.

Igual que `python -m http.server`, pero le pide al navegador que no guarde copias de la página:
así, al recargar, siempre se ve la última versión del programa.

Uso (desde la carpeta del proyecto):
    python3 scripts/servidor.py          # puerto 8000
    python3 scripts/servidor.py 8080     # otro puerto
Después abrir http://localhost:8000/frontend/producto.html en Chrome.
"""
import functools
import http.server
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    manejador = functools.partial(SinCache, directory=RAIZ)
    with http.server.ThreadingHTTPServer(("", puerto), manejador) as srv:
        print(f"Quality AI en http://localhost:{puerto}/frontend/producto.html  (Ctrl+C para detener)")
        srv.serve_forever()
