"""Servidor local de Quality AI.

Sirve la carpeta del proyecto (como `python -m http.server`, pero pidiéndole al navegador que no
guarde copias: al recargar siempre se ve la última versión) y además guarda en disco el registro
de botellas y la foto de cada rechazo, como evidencia.

Uso (desde la carpeta del proyecto):
    python3 scripts/servidor.py          # puerto 8000
    python3 scripts/servidor.py 8080     # otro puerto
Después abrir http://localhost:8000/frontend/producto.html en Chrome.

Dónde quedan los datos:
    <proyecto>/datos/                    (o la carpeta que diga la variable de entorno QA_DATOS)
    datos/registro.sqlite                base SQLite con las tablas `botellas` y `eventos`
    datos/fotos/AAAA-MM-DD/<sesion>_B00012_A.jpg   fotos (fecha local de la botella)
Las fotos se ven en el navegador en http://localhost:8000/datos/fotos/...

API (todo responde JSON, salvo los CSV):
    POST /api/botellas      {"sesion": "...", "botellas": [{n, t, producto, final, faltan, sinVer,
                             motivo, sombra, modo, A, B, verdad, simFalla, fotos: {A, B}}]}
                            Fotos como "data:image/jpeg;base64,...". No duplica: (sesion, n) es único
                            y si la botella ya estaba no se reescribe su foto.
                            → {"ok", "guardadas", "repetidas", "fotos": {"12": {"A": "datos/fotos/..."}},
                               "sinEspacio"}
    POST /api/eventos       {"sesion": "...", "eventos": [{t, tipo, estacion, causa, texto, duracionMs}]}
                            No duplica por (sesion, t, tipo, estacion). → {"ok", "guardados"}
    GET  /api/estado        → {"ok", "version", "carpeta", "botellasHoy", "rechazosHoy", "fotosHoy",
                               "eventosHoy", "libreMB"}
    GET  /api/registro.csv?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   botellas para Excel (por defecto hoy)
    GET  /api/eventos.csv?desde=...&hasta=...                  eventos para Excel (por defecto hoy)
Si quedan menos de 500 MB libres (o QA_MIN_LIBRE_MB) se guardan las filas pero no las fotos,
y la respuesta trae "sinEspacio": true.
"""
import base64
import binascii
import csv
import datetime
import functools
import http.server
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import threading
import urllib.parse
import uuid

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION = 1
TOPE_CUERPO = 25 * 1024 * 1024
PREFIJO_JPEG = "data:image/jpeg;base64,"
RE_SESION = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
RE_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}$")

ESQUEMA = """
CREATE TABLE IF NOT EXISTS botellas (
    sesion     TEXT    NOT NULL,
    n          INTEGER NOT NULL,
    t          INTEGER,            -- ms desde 1970 (hora del navegador)
    fecha      TEXT    NOT NULL,   -- AAAA-MM-DD local
    hora       TEXT    NOT NULL,   -- HH:MM:SS local
    producto   TEXT,
    final      TEXT,               -- OK | RECHAZO | NO_REVISADA
    faltan     TEXT,               -- JSON
    sin_ver    TEXT,               -- JSON
    motivo     TEXT,
    sombra     INTEGER,
    modo       TEXT,
    a_ve TEXT, a_cf REAL, a_ct REAL, a_dudosa INTEGER, a_fuente TEXT, a_movida INTEGER, a_nitidez REAL,
    b_ve TEXT, b_cf REAL, b_ct REAL, b_dudosa INTEGER, b_fuente TEXT, b_movida INTEGER, b_nitidez REAL,
    verdad     TEXT,               -- JSON
    sim_falla  TEXT,               -- JSON
    foto_a     TEXT,               -- ruta relativa a la raíz del proyecto
    foto_b     TEXT,
    recibida   TEXT    NOT NULL,   -- cuándo llegó al servidor
    PRIMARY KEY (sesion, n)
);
CREATE INDEX IF NOT EXISTS botellas_fecha ON botellas (fecha);
CREATE TABLE IF NOT EXISTS eventos (
    sesion      TEXT    NOT NULL,
    t           INTEGER NOT NULL,
    tipo        TEXT    NOT NULL,
    estacion    TEXT    NOT NULL DEFAULT '',   -- 'A', 'B' o '' (sin cámara)
    fecha       TEXT    NOT NULL,
    hora        TEXT    NOT NULL,
    causa       TEXT,
    texto       TEXT,
    duracion_ms INTEGER,
    recibido    TEXT    NOT NULL,
    PRIMARY KEY (sesion, t, tipo, estacion)
);
CREATE INDEX IF NOT EXISTS eventos_fecha ON eventos (fecha);
"""

COLS_BOTELLA = ["sesion", "n", "t", "fecha", "hora", "producto", "final", "faltan", "sin_ver",
                "motivo", "sombra", "modo",
                "a_ve", "a_cf", "a_ct", "a_dudosa", "a_fuente", "a_movida", "a_nitidez",
                "b_ve", "b_cf", "b_ct", "b_dudosa", "b_fuente", "b_movida", "b_nitidez",
                "verdad", "sim_falla", "recibida"]


class ErrorCliente(Exception):
    """Dato malo mandado por la página: se responde 400 con el mensaje."""


# ---------------------------------------------------------------- almacén (SQLite + fotos)

class Almacen:
    def __init__(self, carpeta, min_libre_mb=500):
        self.carpeta = os.path.abspath(carpeta)
        self.fotos = os.path.join(self.carpeta, "fotos")
        self.min_libre_mb = min_libre_mb
        os.makedirs(self.fotos, exist_ok=True)
        self.lock = threading.Lock()
        self.db = sqlite3.connect(os.path.join(self.carpeta, "registro.sqlite"),
                                  check_same_thread=False, timeout=30)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(ESQUEMA)
        self.db.commit()

    def libre_mb(self):
        return shutil.disk_usage(self.carpeta).free // (1024 * 1024)

    def _guardar_foto(self, fecha, sesion, n, est, datos):
        # sesion ya está validada ([A-Za-z0-9_-]), fecha la arma el servidor y est es A/B.
        carpeta = os.path.join(self.fotos, fecha)
        os.makedirs(carpeta, exist_ok=True)
        nombre = f"{sesion}_B{n:05d}_{est}.jpg"
        final = os.path.join(carpeta, nombre)
        tmp = final + f".{uuid.uuid4().hex}.tmp"
        with open(tmp, "wb") as f:
            f.write(datos)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, final)
        return f"datos/fotos/{fecha}/{nombre}"

    def guardar_botellas(self, sesion, botellas):
        sin_espacio = self.libre_mb() < self.min_libre_mb
        guardadas = repetidas = 0
        rutas = {}
        recibida = ahora_txt()
        with self.lock:
            for b in botellas:
                fila = [b.get(c) for c in COLS_BOTELLA]
                fila[0], fila[-1] = sesion, recibida
                cur = self.db.execute(
                    f"INSERT OR IGNORE INTO botellas ({','.join(COLS_BOTELLA)}) "
                    f"VALUES ({','.join('?' * len(COLS_BOTELLA))})", fila)
                if cur.rowcount == 1:
                    guardadas += 1
                    if b["_fotos"] and not sin_espacio:
                        hechas = {}
                        for est, datos in b["_fotos"].items():
                            hechas[est] = self._guardar_foto(b["fecha"], sesion, b["n"], est, datos)
                        self.db.execute("UPDATE botellas SET foto_a=?, foto_b=? WHERE sesion=? AND n=?",
                                        (hechas.get("A"), hechas.get("B"), sesion, b["n"]))
                        rutas[str(b["n"])] = hechas
                else:
                    repetidas += 1
                    ya = self.db.execute("SELECT foto_a, foto_b FROM botellas WHERE sesion=? AND n=?",
                                         (sesion, b["n"])).fetchone()
                    hechas = {k: v for k, v in zip("AB", ya) if v}
                    if hechas:
                        rutas[str(b["n"])] = hechas
            self.db.commit()
        return {"ok": True, "guardadas": guardadas, "repetidas": repetidas, "fotos": rutas,
                "sinEspacio": bool(sin_espacio)}

    def guardar_eventos(self, sesion, eventos):
        recibido = ahora_txt()
        guardados = 0
        with self.lock:
            for e in eventos:
                cur = self.db.execute(
                    "INSERT OR IGNORE INTO eventos (sesion, t, tipo, estacion, fecha, hora, causa, texto,"
                    " duracion_ms, recibido) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (sesion, e["t"], e["tipo"], e["estacion"], e["fecha"], e["hora"], e["causa"],
                     e["texto"], e["duracion_ms"], recibido))
                guardados += cur.rowcount
            self.db.commit()
        return {"ok": True, "guardados": guardados}

    def consultar(self, sql, args=()):
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def estado(self):
        hoy = datetime.date.today().isoformat()
        b, r, f = self.consultar(
            "SELECT COUNT(*), COALESCE(SUM(final='RECHAZO'),0),"
            " COALESCE(SUM((foto_a IS NOT NULL) + (foto_b IS NOT NULL)),0)"
            " FROM botellas WHERE fecha=?", (hoy,))[0]
        ev = self.consultar("SELECT COUNT(*) FROM eventos WHERE fecha=?", (hoy,))[0][0]
        return {"ok": True, "version": VERSION, "carpeta": self.carpeta, "botellasHoy": b,
                "rechazosHoy": r, "fotosHoy": f, "eventosHoy": ev, "libreMB": self.libre_mb()}


# ---------------------------------------------------------------- validación

def ahora_txt():
    return datetime.datetime.now().isoformat(timespec="seconds")


def fecha_hora(t_ms):
    d = datetime.datetime.fromtimestamp(t_ms / 1000)
    return d.strftime("%Y-%m-%d"), d.strftime("%H:%M:%S")


def es_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def num(x):
    return x if es_num(x) else None


def booleano(x):
    return None if x is None else (1 if x else 0)


def texto(x, largo=2000):
    if x is None:
        return None
    if not isinstance(x, str):
        x = json.dumps(x, ensure_ascii=False)
    return x[:largo]


def como_json(x):
    return None if x is None else json.dumps(x, ensure_ascii=False)


def validar_sesion(s):
    if not isinstance(s, str) or not RE_SESION.match(s):
        raise ErrorCliente("sesion inválida (solo letras, números, _ y -, hasta 40)")
    return s


def validar_tiempo(t, obligatorio=False):
    if t is None and not obligatorio:
        return int(datetime.datetime.now().timestamp() * 1000)
    if not es_num(t) or t < 0 or t > 4e12:
        raise ErrorCliente("t inválido (milisegundos)")
    return int(t)


def decodificar_foto(f):
    if not isinstance(f, str) or not f.startswith(PREFIJO_JPEG):
        raise ErrorCliente("foto debe ser data:image/jpeg;base64,...")
    try:
        datos = base64.b64decode(f[len(PREFIJO_JPEG):], validate=True)
    except (binascii.Error, ValueError):
        raise ErrorCliente("foto con base64 malo")
    if not datos.startswith(b"\xff\xd8"):
        raise ErrorCliente("foto no es JPEG")
    return datos


def preparar_botella(b):
    if not isinstance(b, dict):
        raise ErrorCliente("cada botella debe ser un objeto")
    n = b.get("n")
    if not isinstance(n, int) or isinstance(n, bool) or n < 0:
        raise ErrorCliente("n debe ser entero >= 0")
    t = validar_tiempo(b.get("t"))
    fecha, hora = fecha_hora(t)
    fila = {"n": n, "t": t, "fecha": fecha, "hora": hora,
            "producto": texto(b.get("producto"), 200), "final": texto(b.get("final"), 40),
            "faltan": como_json(b.get("faltan")), "sin_ver": como_json(b.get("sinVer")),
            "motivo": texto(b.get("motivo")), "sombra": booleano(b.get("sombra")),
            "modo": texto(b.get("modo"), 40),
            "verdad": como_json(b.get("verdad")), "sim_falla": como_json(b.get("simFalla"))}
    for est in "AB":
        v = b.get(est)
        v = v if isinstance(v, dict) else {}
        p = est.lower() + "_"
        fila.update({p + "ve": texto(v.get("ve"), 40), p + "cf": num(v.get("cf")),
                     p + "ct": num(v.get("ct")), p + "dudosa": booleano(v.get("dudosa")),
                     p + "fuente": texto(v.get("fuente"), 40), p + "movida": booleano(v.get("movida")),
                     p + "nitidez": num(v.get("nitidez"))})
    fotos = b.get("fotos") or {}
    if not isinstance(fotos, dict):
        raise ErrorCliente("fotos debe ser un objeto {A, B}")
    fila["_fotos"] = {}
    for est, f in fotos.items():
        if est not in ("A", "B"):
            raise ErrorCliente("estación de foto debe ser A o B")
        if f is not None:
            fila["_fotos"][est] = decodificar_foto(f)
    return fila


def preparar_evento(e):
    if not isinstance(e, dict):
        raise ErrorCliente("cada evento debe ser un objeto")
    t = validar_tiempo(e.get("t"), obligatorio=True)
    tipo = e.get("tipo")
    if not isinstance(tipo, str) or not 0 < len(tipo) <= 40:
        raise ErrorCliente("tipo inválido")
    est = e.get("estacion")
    if est not in (None, "", "A", "B"):
        raise ErrorCliente("estacion debe ser A, B o null")
    fecha, hora = fecha_hora(t)
    dur = e.get("duracionMs")
    return {"t": t, "tipo": tipo, "estacion": est or "", "fecha": fecha, "hora": hora,
            "causa": texto(e.get("causa"), 100), "texto": texto(e.get("texto")),
            "duracion_ms": int(dur) if es_num(dur) else None}


def rango_fechas(consulta):
    hoy = datetime.date.today().isoformat()
    q = urllib.parse.parse_qs(consulta)
    hasta = q.get("hasta", [hoy])[0] or hoy
    desde = q.get("desde", [min(hoy, hasta)])[0] or min(hoy, hasta)
    for f in (desde, hasta):
        try:
            if not RE_FECHA.match(f):
                raise ValueError
            datetime.date.fromisoformat(f)
        except ValueError:
            raise ErrorCliente("fecha inválida (AAAA-MM-DD)")
    return desde, hasta


# ---------------------------------------------------------------- CSV para Excel

def dec(x):
    if x is None:
        return ""
    return ("%.4f" % x).rstrip("0").rstrip(".").replace(".", ",")


def si_no(x):
    return "" if x is None else ("sí" if x else "no")


def lista(x):
    if x is None:
        return ""
    try:
        v = json.loads(x)
    except ValueError:
        return x
    return ", ".join(map(str, v)) if isinstance(v, list) else (v if isinstance(v, str) else x)


def a_csv(encabezado, filas):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    w.writerow(encabezado)
    w.writerows(filas)
    return ("﻿" + buf.getvalue()).encode("utf-8")


def csv_botellas(almacen, desde, hasta):
    filas = almacen.consultar(
        "SELECT fecha, hora, sesion, n, producto, final, faltan, motivo, sombra,"
        " a_ve, a_cf, a_ct, a_dudosa, a_fuente, a_movida,"
        " b_ve, b_cf, b_ct, b_dudosa, b_fuente, b_movida, verdad, foto_a, foto_b"
        " FROM botellas WHERE fecha BETWEEN ? AND ? ORDER BY t, sesion, n", (desde, hasta))
    enc = ["fecha", "hora", "sesión", "botella", "producto", "resultado", "faltan", "motivo",
           "modo sombra",
           "cámara A ve", "confianza frontal A", "confianza trasera A", "dudosa A", "fuente A",
           "foto movida A",
           "cámara B ve", "confianza frontal B", "confianza trasera B", "dudosa B", "fuente B",
           "foto movida B",
           "verdad simulación", "foto A", "foto B"]
    salida = []
    for (fecha, hora, sesion, n, producto, final, faltan, motivo, sombra,
         ave, acf, act, adu, afu, amo, bve, bcf, bct, bdu, bfu, bmo, verdad, fa, fb) in filas:
        salida.append([fecha, hora, sesion, f"B{n:05d}", producto or "", final or "", lista(faltan),
                       motivo or "", si_no(sombra),
                       ave or "", dec(acf), dec(act), si_no(adu), afu or "", si_no(amo),
                       bve or "", dec(bcf), dec(bct), si_no(bdu), bfu or "", si_no(bmo),
                       lista(verdad), fa or "", fb or ""])
    return a_csv(enc, salida)


def csv_eventos(almacen, desde, hasta):
    filas = almacen.consultar(
        "SELECT fecha, hora, sesion, estacion, tipo, causa, texto, duracion_ms FROM eventos"
        " WHERE fecha BETWEEN ? AND ? ORDER BY t, sesion", (desde, hasta))
    enc = ["fecha", "hora", "sesión", "cámara", "tipo", "causa", "texto", "duración (s)"]
    salida = [[f, h, s, est, tipo, causa or "", txt or "", "" if d is None else dec(d / 1000)]
              for f, h, s, est, tipo, causa, txt, d in filas]
    return a_csv(enc, salida)


# ---------------------------------------------------------------- servidor HTTP

class Manejador(http.server.SimpleHTTPRequestHandler):
    almacen = None  # se asigna en crear_servidor

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()

    # No ensuciar la consola con cada POST de la API: solo errores.
    def log_request(self, code="-", size="-"):
        try:
            c = int(code)
        except (TypeError, ValueError):
            c = 0
        if self.path.startswith("/api/") and c < 400:
            return
        super().log_request(code, size)

    def translate_path(self, path):
        # /datos/fotos/... se sirve desde la carpeta de datos (aunque QA_DATOS esté fuera del proyecto).
        limpio = urllib.parse.unquote(path.split("?", 1)[0].split("#", 1)[0])
        if limpio.startswith("/datos/fotos/"):
            partes = [p for p in limpio[len("/datos/fotos/"):].split("/") if p not in ("", ".", "..")]
            return os.path.join(self.almacen.fotos, *partes)
        return super().translate_path(path)

    def _responder(self, codigo, cuerpo, tipo="application/json; charset=utf-8", extra=None):
        if isinstance(cuerpo, dict):
            cuerpo = json.dumps(cuerpo, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(cuerpo)

    def _error(self, codigo, mensaje):
        self._responder(codigo, {"ok": False, "error": mensaje})

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path.startswith("/datos/") and not url.path.startswith("/datos/fotos/"):
            return self._error(404, "no disponible")  # no exponer la base por la web
        if not url.path.startswith("/api/"):
            return super().do_GET()
        try:
            if url.path == "/api/estado":
                return self._responder(200, self.almacen.estado())
            if url.path in ("/api/registro.csv", "/api/eventos.csv"):
                desde, hasta = rango_fechas(url.query)
                if url.path == "/api/registro.csv":
                    datos, nombre = csv_botellas(self.almacen, desde, hasta), "registro"
                else:
                    datos, nombre = csv_eventos(self.almacen, desde, hasta), "eventos"
                archivo = f"{nombre}_{desde}" + ("" if desde == hasta else f"_a_{hasta}") + ".csv"
                return self._responder(200, datos, "text/csv; charset=utf-8",
                                       {"Content-Disposition": f'attachment; filename="{archivo}"'})
            return self._error(404, "no existe")
        except ErrorCliente as e:
            return self._error(400, str(e))
        except Exception as e:  # noqa: BLE001
            self.log_error("error en %s: %r", url.path, e)
            return self._error(500, "error interno")

    def do_POST(self):
        ruta = urllib.parse.urlsplit(self.path).path
        if ruta not in ("/api/botellas", "/api/eventos"):
            return self._error(404, "no existe")
        try:
            largo = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.close_connection = True
            return self._error(411, "falta Content-Length")
        if largo < 0 or largo > TOPE_CUERPO:
            self.close_connection = True
            return self._error(413, "cuerpo muy grande (máximo 25 MB)")
        try:
            try:
                cuerpo = json.loads(self.rfile.read(largo).decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                raise ErrorCliente("JSON malo")
            if not isinstance(cuerpo, dict):
                raise ErrorCliente("se esperaba un objeto JSON")
            sesion = validar_sesion(cuerpo.get("sesion"))
            if ruta == "/api/botellas":
                botellas = cuerpo.get("botellas")
                if not isinstance(botellas, list):
                    raise ErrorCliente("falta la lista botellas")
                listas = [preparar_botella(b) for b in botellas]
                return self._responder(200, self.almacen.guardar_botellas(sesion, listas))
            eventos = cuerpo.get("eventos")
            if not isinstance(eventos, list):
                raise ErrorCliente("falta la lista eventos")
            listos = [preparar_evento(e) for e in eventos]
            return self._responder(200, self.almacen.guardar_eventos(sesion, listos))
        except ErrorCliente as e:
            return self._error(400, str(e))
        except Exception as e:  # noqa: BLE001
            self.log_error("error en %s: %r", ruta, e)
            return self._error(500, "error interno")


def crear_servidor(puerto, carpeta_datos=None, min_libre_mb=None, host="127.0.0.1"):
    """Por defecto solo acepta conexiones desde este mismo computador (127.0.0.1)."""
    carpeta = carpeta_datos or os.environ.get("QA_DATOS") or os.path.join(RAIZ, "datos")
    if min_libre_mb is None:
        min_libre_mb = int(os.environ.get("QA_MIN_LIBRE_MB", "500"))
    almacen = Almacen(carpeta, min_libre_mb)
    clase = type("ManejadorQA", (Manejador,), {"almacen": almacen})
    return http.server.ThreadingHTTPServer((host, puerto), functools.partial(clase, directory=RAIZ))


if __name__ == "__main__":
    args = sys.argv[1:]
    red = "--red" in args   # abrirlo a la red local (otros equipos), solo si de verdad hace falta
    numeros = [a for a in args if a.isdigit()]
    puerto = int(numeros[0]) if numeros else 8000
    with crear_servidor(puerto, host="0.0.0.0" if red else "127.0.0.1") as srv:
        if red:
            print("OJO: abierto a la red local; otros equipos de la misma red pueden entrar.")
        print(f"Quality AI en http://localhost:{puerto}/frontend/producto.html  (Ctrl+C para detener)")
        print(f"Datos en {srv.RequestHandlerClass.func.almacen.carpeta}")
        srv.serve_forever()
