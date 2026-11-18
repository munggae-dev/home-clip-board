import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, checkHealth } from '../api/client'
import { launcherVersionAtStart } from '../lib/launcher-version'

type VersionCheck =
  | { state: 'checking' }
  | { state: 'unavailable' }
  | { state: 'ready'; version: string }

function VersionInfo() {
  const [attempt, setAttempt] = useState(0)
  const [check, setCheck] = useState<VersionCheck>({ state: 'checking' })

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 6000)
    async function readVersion() {
      try {
        const response = await fetch('/version.json', {
          mode: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Version unavailable')
        const data = await response.json()
        if (typeof data?.version !== 'string' || !data.version.trim()) throw new Error('Invalid version')
        if (active) setCheck({ state: 'ready', version: data.version })
      } catch {
        if (active) setCheck({ state: 'unavailable' })
      } finally {
        window.clearTimeout(timeout)
      }
    }
    void readVersion()
    return () => {
      active = false
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [attempt])

  const matches = check.state === 'ready' && check.version === __APP_VERSION__
  const android = /Android/i.test(navigator.userAgent)
  const standalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
  return (
    <section className="card">
      <h2>웹 앱 버전</h2>
      <dl className="version-details">
        <div><dt>실행 중</dt><dd>v{__APP_VERSION__}</dd></div>
        <div>
          <dt>서버 배포</dt>
          <dd>{check.state === 'ready' ? `v${check.version}` : '—'}</dd>
        </div>
      </dl>
      <p role="status" className={`status ${matches ? 'ok' : ''}`}>
        {check.state === 'checking' && '서버 버전을 확인하고 있습니다.'}
        {check.state === 'unavailable' && '서버 버전을 확인할 수 없습니다. 연결을 확인한 뒤 다시 시도하세요.'}
        {check.state === 'ready' && (matches
          ? '서버에 배포된 버전과 같습니다.'
          : '서버 버전이 다릅니다. 보드를 닫았다가 다시 열어 확인하세요.')}
      </p>
      <button type="button" className="btn secondary" disabled={check.state === 'checking'} onClick={() => {
        setCheck({ state: 'checking' })
        setAttempt(current => current + 1)
      }}>
        버전 다시 확인
      </button>
      {android && (
        <div className="android-version">
          <h3>Android 홈 화면 앱</h3>
          {standalone && launcherVersionAtStart ? (
            <p>실행 주소 버전 <strong>v{launcherVersionAtStart}</strong></p>
          ) : (
            <p>홈 화면 아이콘으로 앱을 열어 실행 주소 버전을 확인하세요. 버전 표기 이전 설치본은 값이 표시되지 않을 수 있습니다.</p>
          )}
          <p>실행 주소 버전은 앱을 연 주소에서 읽은 값입니다. 갤러리 공유 메뉴를 등록하는 설치 패키지(WebAPK)의 업데이트 상태는 Chrome 주소창에 <code>chrome://webapks</code>를 입력해 확인하세요.</p>
        </div>
      )}
    </section>
  )
}

export default function Settings() {
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function handleTest() {
    setTesting(true)
    setMessage(null)
    try {
      const { status } = await checkHealth()
      if (status === 'ok') setMessage({ type: 'ok', text: '서버에 연결되었습니다.' })
      else setMessage({ type: 'err', text: '서버 상태를 확인할 수 없습니다.' })
    } catch (e) {
      setMessage({ type: 'err', text: e instanceof ApiError ? e.message : '연결에 실패했습니다.' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <Link to="/" className="back-link">← 큐</Link>
        <h1>접속 설정</h1>
      </header>

      <VersionInfo />

      <section className="card">
        <h2>현재 서버</h2>
        <p><code>{window.location.origin}</code></p>
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={handleTest} disabled={testing}>
            {testing ? '확인 중…' : '연결 테스트'}
          </button>
        </div>
        {message && <p className={`status ${message.type}`} role="status">{message.text}</p>}
      </section>

      <aside className="card info-card">
        <h2>다른 기기에서 접속하기</h2>
        <ol className="info-steps">
          <li>기기를 서버와 같은 Tailscale 네트워크에 연결합니다.</li>
          <li>
            서버 관리자로부터 신뢰할 수 있는 경로로 <code>rootCA.pem</code>을 받아
            기기에 CA 인증서로 설치합니다. iPhone에서는 설치 후 설정의
            인증서 신뢰 설정에서 완전 신뢰를 켭니다.
          </li>
          <li>서버 관리자가 알려 준 Tailscale HTTPS 주소(포트 8443)를 엽니다.</li>
        </ol>
      </aside>
    </div>
  )
}
