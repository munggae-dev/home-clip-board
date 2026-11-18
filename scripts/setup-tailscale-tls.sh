#!/usr/bin/env bash
# Safari·iOS는 자체 서명 HTTPS를 거부합니다.
# Tailscale이 발급하는 Let's Encrypt 인증서
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/data/certs"
mkdir -p "$CERT_DIR"

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale CLI가 필요합니다." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq가 필요합니다: sudo apt install jq" >&2
  exit 1
fi

DNS="$(tailscale status --json | jq -r '
  if .Self.DNSName | type == "array" then .Self.DNSName[0]
  elif .Self.DNSName then .Self.DNSName
  else empty end
')"

if [ -z "$DNS" ] || [ "$DNS" = "null" ]; then
  echo "MagicDNS 이름을 찾지 못했습니다. Tailscale 관리 콘솔에서 MagicDNS를 켜 주세요." >&2
  exit 1
fi

DNS="${DNS%.}"

echo "Tailscale TLS 인증서 발급: $DNS"
ERR="$(tailscale cert \
  --cert-file "$CERT_DIR/cert.pem" \
  --key-file "$CERT_DIR/key.pem" \
  "$DNS" 2>&1)" || {
  echo "$ERR" >&2
  echo "" >&2
  if echo "$ERR" | grep -qi "does not support"; then
    echo "이 Tailscale 계정/플랜은 tailscale cert(TLS)를 지원하지 않습니다." >&2
    echo "Safari용 대안:" >&2
    echo "  ./scripts/setup-mkcert-tls.sh" >&2
    echo "  또는: ./scripts/setup-tls.sh (자동으로 mkcert 시도)" >&2
  elif echo "$ERR" | grep -qi "access denied"; then
    echo "한 번만 실행: sudo tailscale set --operator=\$USER" >&2
    echo "이후: ./scripts/setup-tailscale-tls.sh (sudo 불필요)" >&2
  fi
  exit 1
}

chmod 600 "$CERT_DIR/key.pem" 2>/dev/null || true

echo ""
echo "완료. Safari·iPhone에서는 아래 주소로 접속하세요 (IP보다 MagicDNS 권장):"
echo "  https://${DNS}:8443"
echo ""
echo "다음: cd $ROOT && ./run.sh"
