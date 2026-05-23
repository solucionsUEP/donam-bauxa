#!/usr/bin/env bash
# Installs /etc/donam-bauxa/push-sender.env and /etc/systemd/system/push-sender.service,
# then starts the service. Run with sudo.
#
# Required: this script is run from the repo root (or any directory that lets
# this path resolve, since the .env values are static).

set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "[install-push-sender] must be run as root (sudo)." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$REPO_ROOT/scripts/push-sender.mjs" ]; then
  echo "[install-push-sender] expected $REPO_ROOT/scripts/push-sender.mjs to exist." >&2
  exit 1
fi

ENV_DIR=/etc/donam-bauxa
ENV_FILE=$ENV_DIR/push-sender.env
UNIT_FILE=/etc/systemd/system/push-sender.service

mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

# Values must match api/config.php on Dondominio. If you rotate the secret,
# update both sides.
cat > "$ENV_FILE" <<'EOF'
# Shared bearer — must match PUSH_SENDER_SECRET in api/config.php.
PUSH_SHARED_SECRET=1609437c516a6a13a8cf4eba878ea8163d5537aba17ecf197ea8c84dcbe41fbf

# VAPID identity. Public key matches the one served by /api/push/vapid; private
# key never leaves this file.
VAPID_PUBLIC_KEY=BH-QFosPQKnEoE-xgBLHI82o6Q7678ppHxcJaC_ifzMku1HwV_-hV4z9euKKumMqsqmTiF799_ZBq5rkVH83xiE
VAPID_PRIVATE_KEY=cMkDPOSNC2NUEpfdvuGFgYwMWwuvJtQLx38ENtXapwQ
VAPID_SUBJECT=mailto:dylanluigicg@gmail.com

# Tuning.
PUSH_PORT=11600
PUSH_MAX_CONCURRENT=20
PUSH_TTL_SECONDS=86400
EOF
chmod 600 "$ENV_FILE"
echo "[install-push-sender] wrote $ENV_FILE"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Dona'm Bauxa — Web Push fan-out
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
ExecStart=/usr/bin/node $REPO_ROOT/scripts/push-sender.mjs
Restart=on-failure
RestartSec=3
EnvironmentFile=$ENV_FILE
StandardOutput=journal
StandardError=journal
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
EOF
echo "[install-push-sender] wrote $UNIT_FILE"

systemctl daemon-reload
systemctl enable --now push-sender.service

echo "[install-push-sender] active. Probing 127.0.0.1:11600/healthz..."
sleep 1
curl -sS --max-time 3 http://127.0.0.1:11600/healthz || echo "(probe failed — check journalctl -u push-sender)"
echo
