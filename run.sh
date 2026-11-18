#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Older Docker engines can expose localhost-published ports on the same L2 network.
version=$(docker version --format '{{.Server.Version}}')
if [[ ! ${version%%.*} =~ ^[0-9]+$ ]] || (( ${version%%.*} < 28 )); then
  echo "루프백 포트 격리에 Docker Engine 28 이상이 필요합니다." >&2
  exit 1
fi

dns=$(tailscale status --json | jq -er 'select(.BackendState == "Running") | .Self.DNSName | strings | rtrimstr(".") | select(length > 0)')
target=127.0.0.1:18443

check_serve() {
  tailscale serve status --json | jq -se --arg target "$target" --arg phase "${1:-preflight}" '
    # A foreground Serve session may also own this port.
    def configs: ., ((.Foreground // {})[] | configs);
    # Tailscale may serialize an unconfigured node as null.
    select(length == 1) | .[0] | if . == null then {} else . end |
    type == "object" and
    ($phase != "active" or .TCP["8443"] == {"TCPForward": $target}) and
    (del(.TCP["8443"]) | all(.. | objects | (.Proxy, .TCPForward) | strings;
      test("(^|://)(localhost|127[.]0[.]0[.]1|\\[::1\\]):18443(/|$)"; "i") | not)) and
    all(configs;
      all((.AllowFunnel // {} | to_entries[]); (.key | endswith(":8443") | not) or (.value != true)) and
      all((.Web // {} | keys[]); endswith(":8443") | not) and
      (.TCP["8443"] == null or .TCP["8443"] == {"TCPForward": $target})
    )
  ' >/dev/null || {
    echo "Serve/Funnel의 8443 설정을 확인하세요. 기존 경로를 덮어쓸 수 없습니다." >&2
    return 1
  }
}

check_serve
if [[ ! -s data/certs/cert.pem || ! -s data/certs/key.pem || ${REFRESH_TLS:-0} == 1 ]]; then
  bash ./scripts/setup-tls.sh
fi

docker compose up -d --build --wait home-clip-board

# Check TLS using the public hostname even when connecting to the local backend.
ca=()
if [[ -s data/certs/rootCA.pem ]] && openssl verify -CAfile data/certs/rootCA.pem data/certs/cert.pem >/dev/null 2>&1; then
  ca=(--cacert data/certs/rootCA.pem)
fi
url="https://$dns:8443"
curl -fsS --noproxy '*' --connect-timeout 5 --max-time 10 "${ca[@]}" \
  --connect-to "$dns:8443:$target" "$url/api/health" >/dev/null

check_serve
tailscale serve --bg --tcp=8443 "tcp://$target"
check_serve active
curl -fsS --noproxy '*' --connect-timeout 5 --max-time 10 "${ca[@]}" "$url/api/health" >/dev/null
version=$(jq -er '.version' web/package.json)
curl -fsS --noproxy '*' --connect-timeout 5 --max-time 10 "${ca[@]}" "$url/version.json" |
  jq -e --arg expected "$version" '.version == $expected' >/dev/null
echo "보드 v$version · $url"
