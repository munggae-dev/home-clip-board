# Home Clip Board

PC와 휴대폰 사이에서 텍스트와 이미지를 주고받는 개인용 클립보드입니다. 서버는 직접 운영하고, 각 기기에서는 Tailscale을 켠 뒤 브라우저나 홈 화면에 설치한 웹 앱(PWA)으로 접속합니다.

PC에서 텍스트를 붙여넣으면 휴대폰에서 바로 복사할 수 있습니다. Android 갤러리에서는 사진을 골라 보드로 공유할 수 있습니다. 열려 있는 보드는 SSE로 추가·삭제를 반영하고, 화면으로 돌아오거나 연결이 복구되면 최신 목록을 불러옵니다.

## 빠른 시작

1. 서버와 접속할 기기를 같은 Tailscale 네트워크(tailnet)에 연결합니다. 보드는 별도 앱 로그인이 없으므로 서버의 TCP 8443에 접근할 기기나 사용자를 tailnet 접근 정책에서 지정하세요. 허용된 기기는 모든 클립을 읽고 추가하거나 삭제할 수 있습니다.
2. 서버에 Git, Bash, Docker Engine 28 이상, Docker Compose, Tailscale CLI, jq, curl, OpenSSL을 준비합니다. 실행 계정에는 Docker와 Tailscale Serve를 설정할 권한이 필요합니다. Tailscale HTTPS 인증서를 발급할 수 없는 환경에서는 서버에 `mkcert`도 설치하세요.
3. 서버에서 다음 명령을 실행합니다.

```bash
git clone https://github.com/munggae-dev/home-clip-board.git
cd home-clip-board
./run.sh
```

스크립트가 이미지 빌드와 컨테이너 실행, HTTPS 응답과 배포 버전 확인을 마치면 `https://<서버의 MagicDNS 이름>:8443` 형태의 보드 주소를 출력합니다. 접속할 기기에서 Tailscale을 켜고 이 주소를 여세요. `mkcert`를 사용한 경우에는 아래 인증서 설정을 먼저 진행합니다.

### 인증서와 PWA 설치

첫 설치에서 `run.sh`는 Tailscale 인증서 발급을 시도하고, 실패하면 `mkcert`로 로컬 인증서를 발급합니다. 기존 `data/certs/cert.pem`과 `key.pem`이 있으면 컨테이너에 읽기 전용으로 마운트해 사용합니다.

`mkcert`를 사용했다면 서버의 **공개 CA 파일 `data/certs/rootCA.pem`만** AirDrop 등 신뢰할 수 있는 경로로 각 기기에 전달해 신뢰 설정을 완료하세요. 브라우저에서 보드의 HTTPS 주소가 경고 없이 열리는지 확인한 뒤 설치합니다.

- **Android** — Chrome 메뉴에서 **앱 설치**를 선택합니다.
- **iPhone** — Safari 공유 메뉴에서 **홈 화면에 추가**를 선택합니다.

## 클립 보내기

- **텍스트와 이미지** — 보드 입력칸에서 텍스트를 보내거나 이미지를 선택·드롭·붙여넣기하세요. 다른 기기에서 보드를 열어 항목을 복사하거나 이미지를 내려받을 수 있습니다. 이미지는 JPEG·PNG·WebP·GIF를 장당 최대 10 MiB까지 지원합니다.
- **갤러리와 공유 메뉴** — Android에서 링크·텍스트 또는 갤러리 사진 한 장이나 여러 장을 선택한 뒤 **공유 → Home Clip Board**를 누르세요. 앱에서 미리 확인하고 **보내기**를 누르면 전송합니다.
- **작성 중인 글과 재시도** — 이미지를 올려도 작성 중인 텍스트는 유지됩니다. 직접 보낸 텍스트는 성공한 뒤 지워집니다. 여러 항목 중 일부가 실패하면 같은 화면에서 실패한 항목만 다시 보낼 수 있습니다.

## 운영과 업데이트

Docker는 호스트의 IPv4 루프백 `127.0.0.1:18443`에만 HTTPS를 게시합니다. Tailscale Serve가 tailnet의 TCP 8443을 그 포트로 전달하고 보드에서 TLS 연결을 처리합니다. 호스트 로컬 프로세스도 백엔드에 접근할 수 있습니다. 다른 서비스가 Serve/Funnel의 8443을 사용 중이면 스크립트는 컨테이너 교체 전에 중단합니다. Funnel, 공개 역방향 프록시, 공유기 포트 포워딩으로 보드를 노출하면 접근 범위가 달라집니다.

배포 후 다음 명령으로 포트와 경로를 확인합니다.

```bash
docker port home-clip-board
tailscale serve status
tailscale funnel status
```

Docker의 포트 매핑은 `8443/tcp -> 127.0.0.1:18443` 한 줄입니다. Serve에는 tailnet의 8443에서 이 루프백 포트로 향하는 TCP 경로가 표시됩니다. 같은 Wi-Fi에서 Tailscale을 끈 기기로 서버 LAN IP의 8080·8443·18443에 직접 접속할 수 없는지도 확인할 수 있습니다.

업데이트할 때는 처음 클론한 디렉터리에서 새 버전의 소스를 받은 뒤 `./run.sh`를 다시 실행합니다. SQLite DB와 업로드 파일은 Compose의 `clip-board-data` 볼륨에 저장되어 컨테이너를 교체해도 유지됩니다.

홈 제목 옆은 현재 실행 중인 웹 앱 버전입니다. **설정 → 웹 앱 버전**에서 서버 버전과 비교할 수 있습니다. Android 공유 목록은 Chrome의 설치 패키지(WebAPK)가 갱신된 뒤 바뀝니다. 공유 목록에 보드가 없다면 설치에 사용한 Android Chrome에서 `chrome://webapks`를 열어 업데이트 상태를 확인하세요.

## 로컬 개발

아래 개발 절차는 Go 1.26.11과 Node.js 24·npm에서 검증합니다. 두 터미널에서 저장소 루트를 기준으로 각각 실행하세요.

```bash
# 터미널 1 · Go API
cd server
go run ./cmd/server
```

```bash
# 터미널 2 · React PWA
cd web
npm ci
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. Vite는 같은 출처의 `/api` 요청을 `127.0.0.1:8080`의 Go 서버에 전달합니다.

아래 명령은 저장소 루트에서 서버 테스트, 정적 검사, 프론트엔드 린트와 프로덕션 빌드를 실행합니다.

```bash
(cd server && go test ./... && go vet ./...)
(cd web && npm ci && npm run lint && npm run build)
```

릴리스 번호는 `web/package.json`의 `version`입니다. `web`에서 `npm version patch --no-git-tag-version`으로 패치 번호를 올리거나 변경 범위에 따라 `minor`, `major`를 사용합니다. 빌드 시 이 값이 화면 표시, `/version.json`, PWA 홈 실행 주소에 함께 반영됩니다.

## API

| 메서드 | 경로 | 용도 |
|---|---|---|
| GET | `/api/health` | 상태 확인 |
| GET | `/api/queue?limit=100` | 목록 |
| GET | `/api/queue/events` | SSE 변경 알림 |
| POST | `/api/queue/text` | JSON의 `content`에 텍스트 전송 |
| POST | `/api/queue/image` | multipart의 `file`에 이미지 전송 |
| GET | `/api/queue/:id` | 항목 상세 |
| GET | `/api/queue/:id/file` | 이미지 파일 |
| DELETE | `/api/queue/:id` | 항목 삭제 |

## 라이선스

Home Clip Board는 [MIT 라이선스](LICENSE)로 배포합니다.
