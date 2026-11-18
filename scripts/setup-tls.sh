#!/usr/bin/env bash
# TLS 설정: Tailscale cert → 실패 시 mkcert
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "① Tailscale 공인 인증서 시도..."
if "$ROOT/scripts/setup-tailscale-tls.sh"; then
  exit 0
fi

echo ""
echo "② mkcert 로컬 CA 인증서 시도 (Tailscale 미지원 플랜·Safari)..."
exec "$ROOT/scripts/setup-mkcert-tls.sh"
