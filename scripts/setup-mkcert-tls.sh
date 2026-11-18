#!/usr/bin/env bash
# Tailscale cert 미지원 플랜·Safari용: mkcert 로컬 CA 인증서
# iPhone/Mac에는 rootCA.pem 을 한 번 설치해야 Safari가 신뢰합니다.
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CERT_DIR="$ROOT/data/certs"
mkdir -p "$CERT_DIR"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert가 필요합니다." >&2
  echo "  sudo apt install mkcert" >&2
  echo "  또는: https://github.com/FiloSottile/mkcert#installation" >&2
  exit 1
fi

HOSTS=(localhost 127.0.0.1)

if command -v tailscale >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  DNS="$(tailscale status --json | jq -r '
    if .Self.DNSName | type == "array" then .Self.DNSName[0]
    elif .Self.DNSName then .Self.DNSName
    else empty end
  ')"
  DNS="${DNS%.}"
  if [ -n "$DNS" ] && [ "$DNS" != "null" ]; then
    HOSTS+=("$DNS")
  fi
  TS_IP="$(tailscale ip -4 2>/dev/null || true)"
  if [ -n "$TS_IP" ]; then
    HOSTS+=("$TS_IP")
  fi
fi

echo "mkcert 인증서 발급 (호스트: ${HOSTS[*]})"
mkcert -install
mkcert -cert-file "$CERT_DIR/cert.pem" -key-file "$CERT_DIR/key.pem" "${HOSTS[@]}"
chmod 600 "$CERT_DIR/key.pem" 2>/dev/null || true

CAROOT="$(mkcert -CAROOT)"
cp "$CAROOT/rootCA.pem" "$ROOT/data/rootCA.pem"
cp "$CAROOT/rootCA.pem" "$CERT_DIR/rootCA.pem"
chmod 644 "$ROOT/data/rootCA.pem" "$CERT_DIR/rootCA.pem" 2>/dev/null || true
echo ""
echo "=== 서버 PC 완료 ==="
echo "  ./run.sh"
echo ""
echo "=== Mac Safari / Chrome (기기마다 1회) ==="
echo "  1) 서버에서 rootCA.pem 을 Mac으로 복사 (scp, AirDrop 등)"
echo "     $CAROOT/rootCA.pem"
echo "  2) Mac: rootCA.pem 더블클릭 → 키체인 접근 → 'mkcert' → 신뢰 → '항상 신뢰'"
echo "     또는 터미널:"
echo "     sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $CAROOT/rootCA.pem"
echo ""
echo "=== iPhone (기기마다 1회) ==="
echo "  1) rootCA.pem 을 iPhone으로 전송 (AirDrop 등)"
echo "  2) iPhone: 설정 → 프로파일 설치 → 일반 → 정보 → 인증서 신뢰"
echo ""
echo "Android에서는 rootCA.pem을 신뢰할 수 있는 경로로 전송하고 CA 인증서로 설치하세요."
