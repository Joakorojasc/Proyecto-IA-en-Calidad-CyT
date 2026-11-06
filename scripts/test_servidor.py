"""Pruebas del servidor local (registro de botellas, fotos, eventos y CSV).

Uso (desde la carpeta del proyecto):
    python3 scripts/test_servidor.py
Levanta el servidor en un puerto libre con los datos en una carpeta temporal (no toca datos/).
Sale con código distinto de 0 si alguna prueba falla.
"""
import base64
import datetime
import http.client
import json
import os
import shutil
import socket
import struct
import sys
import tempfile
import threading
import traceback
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import servidor  # noqa: E402

servidor.Manejador.log_message = lambda *a, **k: None  # consola limpia durante las pruebas


def jpeg_minimo():
    """JPEG válido de 1x1 gris, armado a mano (sin PIL)."""
    def seg(marca, datos):
        return b"\xff" + bytes([marca]) + struct.pack(">H", len(datos) + 2) + datos
    tabla_huff = bytes([1] + [0] * 15) + b"\x00"  # un solo código de largo 1, símbolo 0
    return (b"\xff\xd8"
            + seg(0xDB, b"\x00" + bytes([1] * 64))                       # cuantización
            + seg(0xC0, b"\x08" + struct.pack(">HH", 1, 1) + b"\x01\x01\x11\x00")  # 1x1, 1 canal
            + seg(0xC4, b"\x00" + tabla_huff)                            # Huffman DC
            + seg(0xC4, b"\x10" + tabla_huff)                            # Huffman AC
            + seg(0xDA, b"\x01\x01\x00\x00\x3f\x00")                     # inicio de datos
            + b"\x3f"                                                    # DC=0, fin de bloque
            + b"\xff\xd9")


JPEG = jpeg_minimo()
FOTO = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()


def puerto_libre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def levantar(carpeta, **kw):
    puerto = puerto_libre()
    srv = servidor.crear_servidor(puerto, carpeta, **kw)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{puerto}"


def pedir(base, ruta, cuerpo=None, crudo=None):
    datos = crudo if crudo is not None else (None if cuerpo is None else json.dumps(cuerpo).encode())
    req = urllib.request.Request(base + ruta, data=datos,
                                 headers={"Content-Type": "application/json"} if datos else {})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def pedir_json(base, ruta, cuerpo=None, crudo=None):
    st, _, b = pedir(base, ruta, cuerpo, crudo)
    return st, json.loads(b)


def ms(año, mes, dia, h=10, m=0, s=0):
    return int(datetime.datetime(año, mes, dia, h, m, s).timestamp() * 1000)


AHORA = int(datetime.datetime.now().timestamp() * 1000)
HOY = datetime.date.today().isoformat()


def botella(n, t=None, final="OK", fotos=None, **extra):
    b = {"n": n, "t": AHORA if t is None else t, "producto": "Frontera Chardonnay", "final": final,
         "faltan": [], "sinVer": [], "motivo": "", "sombra": False, "modo": "dos",
         "A": {"ve": "ambas", "cf": 0.8, "ct": 0.75, "dudosa": False, "fuente": "camara",
               "movida": False, "nitidez": 1.9},
         "B": None, "verdad": None, "simFalla": None}
    if fotos:
        b["fotos"] = fotos
    b.update(extra)
    return b


# ---------------------------------------------------------------- pruebas

def p_estado(base, carpeta):
    st, r = pedir_json(base, "/api/estado")
    assert st == 200 and r["ok"] and r["version"] == 1, r
    assert r["carpeta"] == os.path.abspath(carpeta), r
    for k in ("botellasHoy", "rechazosHoy", "fotosHoy", "eventosHoy", "libreMB"):
        assert isinstance(r[k], int), (k, r)
    assert r["botellasHoy"] == 0


def p_botellas(base, carpeta):
    rech = botella(12, final="RECHAZO", faltan=["trasera"], motivo="no se ve la trasera",
                   fotos={"A": FOTO, "B": FOTO}, B={"ve": "frontal", "cf": 0.9, "ct": 0.05})
    st, r = pedir_json(base, "/api/botellas", {"sesion": "20261106-1530-ab12",
                                              "botellas": [botella(11), rech], "extra": 1})
    assert st == 200 and r["ok"], r
    assert r["guardadas"] == 2 and r["repetidas"] == 0 and r["sinEspacio"] is False, r
    fecha = datetime.date.today().isoformat()
    esperada = f"datos/fotos/{fecha}/20261106-1530-ab12_B00012_A.jpg"
    assert r["fotos"] == {"12": {"A": esperada, "B": esperada[:-5] + "B.jpg"}}, r
    archivo = os.path.join(carpeta, "fotos", fecha, "20261106-1530-ab12_B00012_A.jpg")
    with open(archivo, "rb") as f:
        assert f.read() == JPEG
    assert not [x for x in os.listdir(os.path.dirname(archivo)) if x.endswith(".tmp")]
    # la página la abre como /datos/fotos/...
    st, h, cuerpo = pedir(base, "/" + esperada)
    assert st == 200 and cuerpo == JPEG, st


def p_reintento(base, carpeta):
    fecha = datetime.date.today().isoformat()
    archivo = os.path.join(carpeta, "fotos", fecha, "20261106-1530-ab12_B00012_A.jpg")
    antes = os.stat(archivo).st_mtime_ns
    otra = "data:image/jpeg;base64," + base64.b64encode(JPEG[:-2] + b"\x00\xff\xd9").decode()
    st, r = pedir_json(base, "/api/botellas", {"sesion": "20261106-1530-ab12", "botellas": [
        botella(11), botella(12, final="RECHAZO", fotos={"A": otra}), botella(13)]})
    assert st == 200 and r["guardadas"] == 1 and r["repetidas"] == 2, r
    assert os.stat(archivo).st_mtime_ns == antes
    with open(archivo, "rb") as f:
        assert f.read() == JPEG, "no debía reescribir la foto"
    st, r = pedir_json(base, "/api/estado")
    assert r["botellasHoy"] == 3 and r["rechazosHoy"] == 1 and r["fotosHoy"] == 2, r


def p_campos_faltantes(base, carpeta):
    st, r = pedir_json(base, "/api/botellas", {"sesion": "minima", "botellas": [{"n": 0}]})
    assert st == 200 and r["guardadas"] == 1, r


def p_eventos(base, carpeta):
    ev = [{"t": AHORA, "tipo": "ciega", "estacion": "A", "causa": "oscura", "texto": "tapada"},
          {"t": AHORA + 5000, "tipo": "recuperada", "estacion": "A", "duracionMs": 5000},
          {"t": AHORA, "tipo": "aviso", "estacion": None, "texto": "revisar luz"}]
    st, r = pedir_json(base, "/api/eventos", {"sesion": "20261106-1530-ab12", "eventos": ev})
    assert st == 200 and r == {"ok": True, "guardados": 3}, r
    st, r = pedir_json(base, "/api/eventos", {"sesion": "20261106-1530-ab12", "eventos": ev})
    assert st == 200 and r["guardados"] == 0, r
    st, r = pedir_json(base, "/api/estado")
    assert r["eventosHoy"] == 3, r


def p_csv(base, carpeta):
    pedir_json(base, "/api/botellas", {"sesion": "vieja", "botellas": [
        botella(1, t=ms(2026, 1, 15), final="RECHAZO", faltan=["frontal", "trasera"])]})
    st, h, b = pedir(base, "/api/registro.csv")
    assert st == 200 and b.startswith(b"\xef\xbb\xbf"), b[:10]
    assert "attachment" in h["Content-Disposition"], h
    texto = b.decode("utf-8-sig")
    lineas = texto.strip().split("\r\n")
    enc = lineas[0].split(";")
    assert enc[:6] == ["fecha", "hora", "sesión", "botella", "producto", "resultado"], enc
    assert len(lineas) == 1 + 4, lineas  # 11, 12, 13 y la mínima; la de enero no
    fila12 = next(l.split(";") for l in lineas if ";B00012;" in l)
    d = dict(zip(enc, fila12))
    assert d["confianza frontal A"] == "0,8" and d["confianza trasera B"] == "0,05", d
    assert d["faltan"] == "trasera" and d["modo sombra"] == "no" and d["dudosa A"] == "no", d
    assert d["foto A"].endswith("_B00012_A.jpg"), d
    assert "vieja" not in texto
    st, h, b = pedir(base, "/api/registro.csv?desde=2026-01-15&hasta=2026-01-15")
    lineas = b.decode("utf-8-sig").strip().split("\r\n")
    assert len(lineas) == 2 and ";B00001;" in lineas[1] and "frontal, trasera" in lineas[1], lineas
    st, h, b = pedir(base, "/api/registro.csv?desde=2026-01-01")
    assert len(b.decode("utf-8-sig").strip().split("\r\n")) == 6
    st, _, _ = pedir(base, "/api/registro.csv?desde=ayer")
    assert st == 400
    st, h, b = pedir(base, "/api/eventos.csv")
    assert st == 200 and b.startswith(b"\xef\xbb\xbf") and "attachment" in h["Content-Disposition"]
    lineas = b.decode("utf-8-sig").strip().split("\r\n")
    assert len(lineas) == 4, lineas
    assert any(l.split(";")[-1] == "5" and ";A;recuperada;" in l for l in lineas), lineas
    st, h, b = pedir(base, "/api/eventos.csv?desde=2026-01-01&hasta=2026-01-02")
    assert len(b.decode("utf-8-sig").strip().split("\r\n")) == 1


def p_validaciones(base, carpeta):
    malos = [
        {"sesion": "../../etc", "botellas": [botella(1)]},
        {"sesion": "a" * 41, "botellas": [botella(1)]},
        {"sesion": "ok", "botellas": [botella(-1)]},
        {"sesion": "ok", "botellas": [botella(1.5)]},
        {"sesion": "ok", "botellas": [botella(1, fotos={"A": "data:image/png;base64,AAAA"})]},
        {"sesion": "ok", "botellas": [botella(1, fotos={"A": "data:image/jpeg;base64,%%%"})]},
        {"sesion": "ok", "botellas": [botella(1, fotos={"A": "data:image/jpeg;base64,"
                                                             + base64.b64encode(b"hola").decode()})]},
        {"sesion": "ok", "botellas": [botella(1, fotos={"../x": FOTO})]},
        {"sesion": "ok"},
    ]
    for m in malos:
        st, r = pedir_json(base, "/api/botellas", m)
        assert st == 400 and r["ok"] is False and r["error"], (m.get("sesion"), st, r)
    st, r = pedir_json(base, "/api/eventos", {"sesion": "ok", "eventos": [{"t": 1, "tipo": "x",
                                                                          "estacion": "C"}]})
    assert st == 400 and not r["ok"], r
    st, r = pedir_json(base, "/api/botellas", crudo=b'{"sesion": "ok", "botellas": [')
    assert st == 400 and r == {"ok": False, "error": "JSON malo"}, r
    st, r = pedir_json(base, "/api/estado")
    assert r["botellasHoy"] == 4, "las validaciones no debían guardar nada"
    assert not os.path.exists(os.path.join(carpeta, "..", "etc"))
    # cuerpo enorme: se corta por Content-Length sin leerlo
    host, puerto = base.rsplit("/", 1)[1].split(":")
    c = http.client.HTTPConnection(host, int(puerto), timeout=10)
    c.putrequest("POST", "/api/botellas")
    c.putheader("Content-Type", "application/json")
    c.putheader("Content-Length", str(26 * 1024 * 1024))
    c.endheaders()
    resp = c.getresponse()
    assert resp.status == 413 and json.loads(resp.read())["ok"] is False
    c.close()
    # la base no se expone por la web
    st, _, _ = pedir(base, "/datos/registro.sqlite")
    assert st == 404, st
    st, _, _ = pedir(base, "/datos/fotos/../registro.sqlite")
    assert st == 404, st


def p_concurrencia(base, carpeta):
    errores = []

    def mandar(sesion):
        try:
            for i in range(0, 200, 10):
                lote = [botella(n, final="RECHAZO" if n % 50 == 0 else "OK",
                                fotos={"A": FOTO} if n % 50 == 0 else None) for n in range(i, i + 10)]
                st, r = pedir_json(base, "/api/botellas", {"sesion": sesion, "botellas": lote})
                if st != 200 or r["guardadas"] != 10:
                    errores.append((sesion, st, r))
        except Exception as e:  # noqa: BLE001
            errores.append((sesion, repr(e)))

    hilos = [threading.Thread(target=mandar, args=(s,)) for s in ("pestana1", "pestana2")]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert not errores, errores[:3]
    n = servidor.sqlite3.connect(os.path.join(carpeta, "registro.sqlite")).execute(
        "SELECT COUNT(*) FROM botellas WHERE sesion IN ('pestana1','pestana2')").fetchone()[0]
    assert n == 400, n
    ok = servidor.sqlite3.connect(os.path.join(carpeta, "registro.sqlite")).execute(
        "PRAGMA integrity_check").fetchone()[0]
    assert ok == "ok", ok


def p_estaticos(base, carpeta):
    st, h, b = pedir(base, "/frontend/producto.html")
    assert st == 200 and b"<html" in b.lower(), st
    assert "no-store" in h.get("Cache-Control", ""), h
    st, _, _ = pedir(base, "/api/nada")
    assert st == 404


def p_sin_espacio(base, carpeta):
    otra = tempfile.mkdtemp(prefix="qa_lleno_")
    srv, base2 = levantar(otra, min_libre_mb=10 ** 12)  # "disco lleno"
    try:
        st, r = pedir_json(base2, "/api/botellas", {"sesion": "llena", "botellas": [
            botella(1, final="RECHAZO", fotos={"A": FOTO})]})
        assert st == 200 and r["guardadas"] == 1 and r["sinEspacio"] is True and r["fotos"] == {}, r
        assert not any(fs for _, _, fs in os.walk(os.path.join(otra, "fotos")))
    finally:
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(otra, ignore_errors=True)


PRUEBAS = [p_estado, p_botellas, p_reintento, p_campos_faltantes, p_eventos, p_csv,
           p_validaciones, p_concurrencia, p_estaticos, p_sin_espacio]


def main():
    carpeta = tempfile.mkdtemp(prefix="qa_datos_")
    os.environ["QA_DATOS"] = carpeta
    srv, base = levantar(None)  # toma QA_DATOS
    fallas = 0
    try:
        for p in PRUEBAS:
            try:
                p(base, carpeta)
                print(f"  ok     {p.__name__[2:]}")
            except Exception:  # noqa: BLE001
                fallas += 1
                print(f"  FALLA  {p.__name__[2:]}")
                traceback.print_exc()
    finally:
        srv.shutdown()
        srv.server_close()
        shutil.rmtree(carpeta, ignore_errors=True)
    print(f"\n{len(PRUEBAS) - fallas}/{len(PRUEBAS)} pruebas pasaron")
    sys.exit(1 if fallas else 0)


if __name__ == "__main__":
    main()
