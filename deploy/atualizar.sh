#!/bin/bash
# Atualiza a aplicação numa instância já provisionada (rodar com sudo).
set -euo pipefail
BRANCH="${BRANCH:-ex05-rds}"
cd /opt/labirinto
sudo -u labirinto git fetch origin "$BRANCH"
sudo -u labirinto git checkout -B "$BRANCH" "origin/$BRANCH"
sudo -u labirinto .venv/bin/pip install -q -r deploy/requirements-server.txt
systemctl restart labirinto
curl -fsS http://127.0.0.1/health && echo
