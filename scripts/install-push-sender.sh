#!/usr/bin/env bash
# Installs /etc/donam-bauxa/push-sender.env and /etc/systemd/system/push-sender.service,
# then starts the service. Run with sudo.
#
# Secrets are NEVER committed. Supply them in one of three ways:
#
#   A. Environment variables (good for one-off provisioning):
#        sudo VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
#             VAPID_SUBJECT=mailto:you@example.com \
#             PUSH_SHARED_SECRET=... \
#             bash scripts/install-push-sender.sh
#
#   B. An env file path as the first argument (good for re-installs):
#        echo 'VAPID_PUBLIC_KEY=...' > /root/dnb-push.env
#        echo 'VAPID_PRIVATE_KEY=...' >> /root/dnb-push.env
#        echo 'VAPID_SUBJECT=mailto:you@example.com' >> /root/dnb-push.env
#        echo 'PUSH_SHARED_SECRET=...' >> /root/dnb-push.env
#        sudo bash scripts/install-push-sender.sh /root/dnb-push.env
#
#   C. Re-using values already pinned in /etc/donam-bauxa/push-sender.env (just
#      restarts the unit). Useful after `git pull` of the .mjs only:
#        sudo bash scripts/install-push-sender.sh --reuse
#
# Values must match api/config.php on the Dondominio side. If you rotate, the
# only correct thing to do is rotate *both* sides in lockstep.

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

MODE="${1:-}"

if [ "$MODE" = "--reuse" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "[install-push-sender] --reuse requested but $ENV_FILE does not exist yet." >&2
    exit 1
  fi
  echo "[install-push-sender] keeping existing $ENV_FILE"
elif [ -n "$MODE" ] && [ -f "$MODE" ]; then
  # Source the file in a subshell so we don't leak its vars into our env.
  # shellcheck disable=SC1090
  set -a; source "$MODE"; set +a
fi

if [ "$MODE" != "--reuse" ]; then
  : "${VAPID_PUBLIC_KEY:?Missing VAPID_PUBLIC_KEY (env var or env file)}"
  : "${VAPID_PRIVATE_KEY:?Missing VAPID_PRIVATE_KEY (env var or env file)}"
  : "${VAPID_SUBJECT:?Missing VAPID_SUBJECT (env var or env file)}"
  : "${PUSH_SHARED_SECRET:?Missing PUSH_SHARED_SECRET (env var or env file)}"
  PUSH_PORT="${PUSH_PORT:-11600}"
  PUSH_MAX_CONCURRENT="${PUSH_MAX_CONCURRENT:-20}"
  PUSH_TTL_SECONDS="${PUSH_TTL_SECONDS:-86400}"

  umask 077
  cat > "$ENV_FILE" <<EOF
PUSH_SHARED_SECRET=$PUSH_SHARED_SECRET
VAPID_PUBLIC_KEY=$VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY
VAPID_SUBJECT=$VAPID_SUBJECT
PUSH_PORT=$PUSH_PORT
PUSH_MAX_CONCURRENT=$PUSH_MAX_CONCURRENT
PUSH_TTL_SECONDS=$PUSH_TTL_SECONDS
EOF
  chmod 600 "$ENV_FILE"
  umask 022
  echo "[install-push-sender] wrote $ENV_FILE (mode 600)"
fi

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
systemctl restart push-sender.service

echo "[install-push-sender] active. Probing 127.0.0.1:${PUSH_PORT:-11600}/healthz..."
sleep 1
curl -sS --max-time 3 "http://127.0.0.1:${PUSH_PORT:-11600}/healthz" || echo "(probe failed — check journalctl -u push-sender)"
echo
