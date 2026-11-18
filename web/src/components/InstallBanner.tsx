import { Link } from 'react-router-dom'
import { usePwaInstall } from '../hooks/usePwaInstall'

export default function InstallBanner() {
  const { standalone, canInstall, install, ios, needsHttpsHint } =
    usePwaInstall()

  if (standalone) return null

  return (
    <aside className="install-banner" role="region" aria-label="앱 설치 안내">
      <div className="install-banner-inner">
        <strong>앱으로 설치</strong>
        <p className="install-banner-text">
          브라우저 탭이 아닌 <strong>독립 앱</strong>처럼 쓰려면 설치하세요.
          주소창·탭 없이 전체 화면으로 열립니다.
        </p>

        {needsHttpsHint && (
          <p className="install-banner-warn">
            Tailscale에 연결하고 서버의 HTTPS 주소로 열어 주세요. 인증서 설정은{' '}
            <Link to="/settings">접속 안내</Link>에서 확인할 수 있습니다.
          </p>
        )}

        {canInstall && (
          <button
            type="button"
            className="btn primary install-btn"
            onClick={() => void install()}
          >
            앱 설치
          </button>
        )}

        {!canInstall && ios && (
          <p className="install-banner-steps">
            iPhone/iPad: Safari 공유 버튼 → <strong>홈 화면에 추가</strong>
          </p>
        )}

        {!canInstall && !ios && !needsHttpsHint && (
          <p className="install-banner-steps">
            Chrome/Edge: 주소창 오른쪽 <strong>설치</strong> (⊕) 또는 메뉴 →
            앱 설치
          </p>
        )}

        {!canInstall && !ios && needsHttpsHint && (
          <p className="install-banner-steps">
            HTTPS 접속 후 새로고침하면 「앱 설치」 버튼이 나타날 수 있습니다.
          </p>
        )}
      </div>
    </aside>
  )
}
