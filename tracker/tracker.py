"""Sigue objetos entre cuadros emparejando cada uno con el centro más cercano del cuadro anterior."""
import math
from dataclasses import dataclass, field


@dataclass
class Pista:
    id: int
    caja: tuple
    centro: tuple
    historia: list = field(default_factory=list)  # [(t, x)] para estimar velocidad
    x_anterior: float | None = None
    perdidos: int = 0
    cruzo: bool = False

    def velocidad(self) -> float:
        """Velocidad horizontal en píxeles por segundo (positiva = hacia la derecha)."""
        (t0, x0), (t1, x1) = self.historia[0], self.historia[-1]
        return (x1 - x0) / (t1 - t0) if t1 > t0 else 0.0


class Rastreador:
    def __init__(self, max_distancia: float, cuadros_perdida: int):
        self.max_distancia = max_distancia  # en píxeles
        self.cuadros_perdida = cuadros_perdida
        self.pistas: dict[int, Pista] = {}
        self.siguiente_id = 1

    def actualizar(self, cajas, t: float) -> list[Pista]:
        """Asigna las cajas del cuadro actual a las pistas y devuelve las pistas visibles."""
        centros = [(x + w / 2, y + h / 2) for x, y, w, h in cajas]
        pares = sorted(
            (math.dist(p.centro, c), pid, i)
            for pid, p in self.pistas.items()
            for i, c in enumerate(centros)
        )
        usadas_p, usadas_c = set(), set()
        for d, pid, i in pares:
            if d > self.max_distancia or pid in usadas_p or i in usadas_c:
                continue
            p = self.pistas[pid]
            p.x_anterior, p.centro, p.caja, p.perdidos = p.centro[0], centros[i], cajas[i], 0
            p.historia = (p.historia + [(t, centros[i][0])])[-15:]
            usadas_p.add(pid)
            usadas_c.add(i)

        for pid in list(self.pistas):
            if pid not in usadas_p:
                self.pistas[pid].perdidos += 1
                self.pistas[pid].x_anterior = None
                if self.pistas[pid].perdidos > self.cuadros_perdida:
                    del self.pistas[pid]

        for i, c in enumerate(centros):
            if i not in usadas_c:
                self.pistas[self.siguiente_id] = Pista(self.siguiente_id, cajas[i], c, [(t, c[0])])
                self.siguiente_id += 1

        return [p for p in self.pistas.values() if p.perdidos == 0]

    def cruces(self, linea_x: float, direccion: str) -> list[Pista]:
        """Pistas que cruzaron la línea en este cuadro. Cada pista cuenta una sola vez."""
        nuevas = []
        for p in self.pistas.values():
            if p.cruzo or p.x_anterior is None:
                continue
            a, b = p.x_anterior, p.centro[0]
            hacia_der = a < linea_x <= b
            hacia_izq = a > linea_x >= b
            if (direccion == "derecha" and hacia_der) or (direccion == "izquierda" and hacia_izq) \
                    or (direccion == "ambas" and (hacia_der or hacia_izq)):
                p.cruzo = True
                nuevas.append(p)
        return nuevas
