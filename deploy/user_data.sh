#!/bin/bash
# User data da EC2 (Amazon Linux 2023). Instala o Labirinto com Chaves atrás do Apache:
#   cliente/ALB --:80--> Apache (httpd) --proxy--> gunicorn 127.0.0.1:8000 --> Flask (src.web.app)
# Depois de testada, crie a AMI a partir desta instância: os serviços já sobem sozinhos no boot.
set -euxo pipefail

REPO_URL="${REPO_URL:-https://github.com/Joaopedrobs7/grafos.git}"
BRANCH="${BRANCH:-entrega1-parcial}"
APP_DIR=/opt/labirinto

dnf install -y git httpd python3.11 python3.11-pip

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout -B "$BRANCH" "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

python3.11 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/deploy/requirements-server.txt"

id -u labirinto &>/dev/null || useradd --system --home "$APP_DIR" --shell /sbin/nologin labirinto
chown -R labirinto:labirinto "$APP_DIR"

install -m 644 "$APP_DIR/deploy/labirinto.service" /etc/systemd/system/labirinto.service
install -m 644 "$APP_DIR/deploy/apache-labirinto.conf" /etc/httpd/conf.d/labirinto.conf
rm -f /etc/httpd/conf.d/welcome.conf

systemctl daemon-reload
systemctl enable --now labirinto
systemctl enable --now httpd
systemctl restart httpd
