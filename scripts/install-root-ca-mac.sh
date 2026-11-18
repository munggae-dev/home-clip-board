#!/usr/bin/env bash
# Mac에서 서버 mkcert rootCA.pem 신뢰 (Safari용)
# 사용: ./scripts/install-root-ca-mac.sh ~/Downloads/rootCA.pem
if [ -z "${BASH_VERSION:-}" ]; then
  exec /usr/bin/env bash "$0" "$@"
fi
set -euo pipefail

PEM="${1:-}"

if [ -z "$PEM" ] || [ ! -f "$PEM" ]; then
  echo "사용법: $0 <rootCA.pem 경로>" >&2
  echo "예: $0 ~/Downloads/rootCA.pem" >&2
  exit 1
fi

echo "기존 mkcert CA가 있으면 키체인 접근에서 'mkcert' 검색 후 삭제한 뒤 다시 시도하세요."
echo "로그인 키체인에 신뢰 루트로 추가합니다..."

# 더블클릭(import) 대신 security 명령 사용 (-25294 회피)
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  "$PEM"

echo ""
echo "완료. Safari에서 접속:"
echo "  https://<서버-MagicDNS>:8443"
echo "설정 앱 URL도 동일하게 https 로 맞추세요."
