# [IA] Claude – histórico de consultas no MySQL (RDS), usado pela aplicação web na disciplina de Cloud
"""Histórico de consultas da aplicação web, gravado num MySQL (Amazon RDS).

É um detalhe periférico: os mapas e os algoritmos continuam vindo de data/ e de src/graphs/.
A configuração vem de variáveis de ambiente (na EC2, do arquivo /etc/labirinto/db.env lido pelo
systemd): DB_HOST, DB_USER, DB_PASSWORD e DB_NAME. Sem DB_HOST o histórico fica desligado.
"""
from __future__ import annotations

import os
from contextlib import contextmanager


def habilitado() -> bool:
    return bool(os.environ.get("DB_HOST"))


@contextmanager
def _cursor():
    import pymysql  # só é necessário quando o banco está configurado

    con = pymysql.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", 3306)),
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        database=os.environ.get("DB_NAME", "labirinto"),
        connect_timeout=3, read_timeout=5, write_timeout=5,
        autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with con.cursor() as cur:
            yield cur
    finally:
        con.close()


def registrar(mapa: str, resultados: dict[str, dict], instancia: str) -> None:
    """Uma linha por algoritmo; códigos fora da tabela `algoritmo` são ignorados."""
    sql = """INSERT INTO execucao (mapa, algoritmo, status, passos, custo, instancia)
             SELECT %s, codigo, %s, %s, %s, %s FROM algoritmo WHERE codigo = %s"""
    with _cursor() as cur:
        for alg, r in resultados.items():
            cur.execute(sql, (mapa, r["status"], r["passos"], r["custo"], instancia, alg))


def ultimas(limite: int = 8) -> list[dict]:
    with _cursor() as cur:
        cur.execute("""SELECT e.criado_em, e.mapa, a.nome AS algoritmo, e.status, e.custo, e.instancia
                       FROM execucao e JOIN algoritmo a ON a.codigo = e.algoritmo
                       ORDER BY e.id DESC LIMIT %s""", (limite,))
        linhas = cur.fetchall()
    for l in linhas:
        l["criado_em"] = l["criado_em"].isoformat(sep=" ")
    return linhas
