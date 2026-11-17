#!/usr/bin/env bash
# Preparación inicial del VPS Ubuntu (correr una sola vez, como root):
#   curl -fsSL https://raw.githubusercontent.com/odaimx/OdaiTime/main/scripts/setup-server.sh | sudo bash
# Es idempotente: si algo ya está instalado, lo omite.
set -euo pipefail

APP_DIR=/opt/odaitime
DEPLOY_USER=${DEPLOY_USER:-deploy}
REPO=https://github.com/odaimx/OdaiTime.git

echo "==> Paquetes base"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Usuario de despliegue: $DEPLOY_USER"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"

echo "==> Firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Código en $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

cat <<EOF

Listo. Pasos siguientes:
  1. Agrega la llave pública de GitHub Actions a /home/$DEPLOY_USER/.ssh/authorized_keys
  2. cp $APP_DIR/.env.example $APP_DIR/.env  y edita los valores
  3. sudo -u $DEPLOY_USER $APP_DIR/scripts/deploy.sh
EOF
