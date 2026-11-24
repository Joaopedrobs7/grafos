# [IA] Claude – download do dataset da Parte 2 (Kaggle) para data/dataset_parte2/raw, com manifesto de hashes
"""Baixa os arquivos do dataset "Historical NBA Data and Player Box Scores" (Kaggle, licença CC0).

Uso:
    python -m src.parte2.baixar                 # jogos, times, jogadores e o jogada a jogada (~990 MB)
    python -m src.parte2.baixar --tudo          # inclui também as estatísticas por jogador (+390 MB)

O Kaggle atualiza o dataset todo dia; quem fixa a versão usada pelo grupo é o DVC (dvc.lock +
remoto). O manifesto `raw/MANIFESTO.json` registra tamanho e SHA-256 de cada arquivo baixado.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DATASET = "eoinamoore/historical-nba-data-and-player-box-scores"
RAIZ = Path(__file__).resolve().parents[2]
DESTINO = RAIZ / "data" / "dataset_parte2" / "raw"
LEVES = ["Games.csv", "TeamStatistics.csv", "TeamHistories.csv", "Players.csv"]
# [IA] Claude – o grafo de rotação (substituições) sai do jogada a jogada
JOGADA_A_JOGADA = ["PlayByPlay.parquet"]
PESADOS = ["PlayerStatistics.csv"]


def _kaggle() -> str:
    """CLI do Kaggle do mesmo ambiente do Python em uso (ou a do PATH)."""
    local = Path(sys.executable).with_name("kaggle")
    return str(local) if local.exists() else (shutil.which("kaggle") or "kaggle")


def _sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def baixar(arquivos: list[str], destino: Path = DESTINO) -> dict:
    destino.mkdir(parents=True, exist_ok=True)
    for nome in arquivos:
        print(f"baixando {nome}…", flush=True)
        cmd = [_kaggle(), "datasets", "download", DATASET, "-f", nome, "-p", str(destino), "--unzip", "-o", "-q"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0 or not (destino / nome).exists():
            raise SystemExit(f"falha ao baixar {nome}: {r.stderr.strip() or r.stdout.strip()}\n"
                             "Confira o token do Kaggle (KAGGLE_API_TOKEN ou ~/.kaggle/access_token).")
    manifesto = {
        "dataset": DATASET,
        "url": f"https://www.kaggle.com/datasets/{DATASET}",
        "licenca": "CC0-1.0",
        "baixado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "arquivos": {n: {"bytes": (destino / n).stat().st_size, "sha256": _sha256(destino / n)}
                     for n in sorted(arquivos)},
    }
    (destino / "MANIFESTO.json").write_text(json.dumps(manifesto, indent=2, ensure_ascii=False), encoding="utf-8")
    return manifesto


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tudo", action="store_true", help="inclui PlayerStatistics.csv (~390 MB)")
    ap.add_argument("--destino", type=Path, default=DESTINO)
    args = ap.parse_args(argv)
    m = baixar(LEVES + JOGADA_A_JOGADA + (PESADOS if args.tudo else []), args.destino)
    for nome, info in m["arquivos"].items():
        print(f"  {nome:22s} {info['bytes'] / 1e6:8.1f} MB  {info['sha256'][:12]}")


if __name__ == "__main__":
    main()
