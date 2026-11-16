#!/bin/bash
# [IA] Claude – user data do launch template: atualiza a aplicação a cada instância nova do ASG.
# Deploy = push na main + "Iniciar atualização da instância" no ASG; não precisa gerar AMI nova.
# Se o GitHub falhar, a instância sobe com a versão que já está na AMI (o boot nunca é bloqueado).
BRANCH=main
APP=/opt/labirinto
exec > /var/log/labirinto-boot.log 2>&1
set -x
cd "$APP" || exit 0
if sudo -u labirinto git fetch origin "$BRANCH" && sudo -u labirinto git checkout -f -B "$BRANCH" "origin/$BRANCH"; then
  sudo -u labirinto .venv/bin/pip install -q -r deploy/requirements-server.txt
  install -m 644 deploy/labirinto.service /etc/systemd/system/labirinto.service
  install -m 644 deploy/apache-labirinto.conf /etc/httpd/conf.d/labirinto.conf
fi
mkdir -p /etc/labirinto
echo "APP_VERSAO=$BRANCH@$(sudo -u labirinto git rev-parse --short HEAD)" > /etc/labirinto/versao.env
systemctl daemon-reload
systemctl restart labirinto httpd
