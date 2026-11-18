# Home Clip Board

Tailscale로 연결한 기기 사이에서 텍스트와 이미지를 공유하는 개인용 보드입니다. 홈 화면을 열면 SSE로 추가·삭제가 반영됩니다. 화면으로 돌아오거나 연결이 복구되면 최신 목록을 다시 받습니다.

## 배포와 업데이트

첫 표시 버전은 **v1.0.0**이며 갤러리 사진 공유를 포함합니다. 홈 제목 옆은 지금 열린 웹 앱 버전입니다. **설정 → 웹 앱 버전**에서 서버에 배포된 버전과 비교할 수 있습니다. Android에서 홈 아이콘으로 앱을 열면 설정에 실행 주소의 버전도 표시됩니다. 번호를 넣기 전 설치본이나 다른 경로로 열었을 때는 이 값이 없을 수 있습니다.

릴리스 번호는 `web/package.json`의 `version`을 사용합니다. 새 릴리스 전에 `cd web && npm version patch --no-git-tag-version`으로 패치 번호를 올립니다. 기능 추가에는 `minor`, 호환성이 바뀌는 릴리스에는 `major`를 사용할 수 있습니다. 빌드는 이 번호로 화면 표시, `/version.json`, PWA 홈 실행 주소를 함께 생성합니다.

서버에서 Tailscale에 로그인하고 Docker Engine 28 이상, Docker Compose, jq, curl, OpenSSL을 준비합니다. 서버 계정에는 이 보드의 Docker 배포와 Tailscale Serve 설정 권한이 필요합니다.

```bash
./run.sh
```

기존 설치와 같은 프로젝트 디렉터리에서 실행하세요. 같은 Compose 볼륨의 SQLite DB와 업로드 파일, 기존 TLS 인증서를 사용합니다. 포트 매핑 변경에는 컨테이너 재생성이 필요하며 위 명령이 이를 처리합니다.

기기에서 Tailscale을 켜고 `https://<서버의 MagicDNS 이름>:8443`을 엽니다. Android는 브라우저 메뉴에서 **앱 설치**, iPhone은 Safari 공유 메뉴에서 **홈 화면에 추가**를 선택합니다.

## 클립 보내기

- Android Chrome에서 설치한 PWA는 공유 메뉴에서 링크·텍스트와 갤러리의 사진 한 장 또는 여러 장을 받을 수 있습니다. **공유 → Home Clip Board**에서 내용을 확인한 뒤 **보내기**를 누르세요. 사진은 JPEG·PNG·WebP·GIF를 장당 10MB까지 지원합니다.
- 기존 설치본은 Android Chrome의 WebAPK 업데이트 후 사진 공유 목록에 표시됩니다. 갱신 상태는 같은 Chrome 프로필의 `chrome://webapks`에서 확인할 수 있습니다.
- 이미지를 선택하거나 붙여넣어도 홈 화면 입력칸에 작성 중인 텍스트는 유지됩니다. 입력칸에서 직접 보낸 텍스트는 전송에 성공하면 지워집니다.
- 여러 이미지를 보내다가 일부 전송이 실패하면 같은 화면에서 남은 항목을 재시도할 수 있습니다. 서버가 이미 받은 항목은 중복으로 추가되지 않습니다.

## 접근 범위

- Tailscale Serve가 tailnet의 TCP 8443을 호스트의 `127.0.0.1:18443`으로 전달합니다. TLS는 보드에서 종료되므로 기존 PWA 주소와 인증서 신뢰 설정을 계속 사용할 수 있습니다.
- Docker는 HTTPS 백엔드를 IPv4 루프백에만 게시합니다. LAN용 포트와 HTTP 인증서 다운로드 경로는 닫혀 있습니다. 호스트에서는 로컬 프로세스가 백엔드에 접속할 수 있습니다.
- 브라우저의 목록 조회, 업로드, 삭제, SSE는 보드를 연 주소에서 수행합니다.
- 보드에 접근하는 기기는 큐 전체를 읽고 쓸 수 있습니다. Tailscale 관리 콘솔에서 서버의 TCP 8443에 접근할 사용자·기기를 지정하세요. 전체 허용 규칙을 함께 두면 그 규칙도 적용됩니다. 보드를 공개하는 Funnel, 별도의 공개 역방향 프록시, 포트 포워딩을 구성하면 접근 범위가 달라집니다.
- 다른 앱이 Serve/Funnel의 8443을 점유하고 있으면 배포 스크립트가 교체 전에 중단합니다. 기존 배포의 공개 포트는 새 컨테이너로 교체한 시점에 닫힙니다.

### 인증서

`data/certs/cert.pem`과 `key.pem`을 컨테이너에 읽기 전용으로 마운트합니다. 첫 설치에서는 `run.sh`가 Tailscale 인증서 발급을 시도하고, 필요하면 mkcert를 사용합니다. mkcert를 사용한 경우 새 기기에는 공개 CA 파일 `data/certs/rootCA.pem`만 AirDrop 등 신뢰할 수 있는 경로로 전송해 신뢰 설정을 완료하세요.

### 확인

```bash
docker port home-clip-board
tailscale serve status
tailscale funnel status
```

Docker 출력은 `8443/tcp -> 127.0.0.1:18443` 한 줄입니다. Serve에는 tailnet의 8443에서 이 루프백 포트로 향하는 TCP 경로가 표시됩니다. 연결된 기기에서 보드를 열어 확인하고, 같은 Wi-Fi에서 Tailscale을 끈 기기로 서버 LAN IP의 8080·8443·18443에 직접 접속할 수 없는지 확인하세요.

## 로컬 개발

서버는 기본적으로 `127.0.0.1:8080`에서 실행됩니다. Vite 개발 서버는 루프백에서 같은 출처의 `/api` 요청을 Go 서버로 전달합니다.

```bash
(cd server && go run ./cmd/server)
# 별도 터미널
(cd web && npm ci && npm run dev)
```

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

이미지는 JPEG, PNG, WebP, GIF를 최대 10MB까지 지원합니다.
