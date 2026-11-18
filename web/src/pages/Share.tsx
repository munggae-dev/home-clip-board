import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClipUploads } from '../hooks/useClipUploads'
import { sharedImageIssue } from '../lib/input-files'
import { getSharedFiles } from '../lib/shared-files'

type Handoff = { token: string; count: number }

function sharedData<T>(id: string): T | undefined {
  const data = document.getElementById(id)?.textContent
  return data ? JSON.parse(data) : undefined
}

function PhotoPreview({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (!image.current) return
    const objectUrl = URL.createObjectURL(file)
    image.current.src = objectUrl
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])
  return <img ref={image} className="share-thumbnail" alt="" loading="lazy" decoding="async" />
}

export default function Share() {
  const navigate = useNavigate()
  const [text, setText] = useState(() => sharedData<string>('shared-content') ?? '')
  const [handoff] = useState(() => sharedData<Handoff>('shared-files'))
  const [files, setFiles] = useState<File[]>([])
  const [loadingFiles, setLoadingFiles] = useState(Boolean(handoff))
  const [loadError, setLoadError] = useState('')
  const fileRequest = useRef<Promise<File[]> | null>(null)
  const { status, uploading, submit, retry } = useClipUploads()

  useEffect(() => {
    document.getElementById('shared-content')?.remove()
    document.getElementById('shared-files')?.remove()
    if (!handoff) return

    let active = true
    // The worker hands out these files once, including under Strict Mode.
    fileRequest.current ??= getSharedFiles(handoff.token)
    fileRequest.current.then(incoming => {
      if (incoming.length !== handoff.count) throw new Error('공유한 사진을 모두 받지 못했습니다.')
      if (active) setFiles(incoming)
    }).catch(() => {
      if (active) setLoadError('사진을 불러오지 못했습니다. 갤러리에서 다시 공유해 주세요.')
    }).finally(() => {
      if (active) setLoadingFiles(false)
    })
    return () => { active = false }
  }, [handoff])

  const allowedFiles = files.filter(file => !sharedImageIssue(file))
  const failedText = status?.failed.find(({ item }) => typeof item.value === 'string')
  const retrying = Boolean(status?.failed.length)
  const blocked = uploading || loadingFiles || Boolean(loadError)
    || (!text.trim() && (allowedFiles.length === 0 || Boolean(failedText)))

  async function send(event: FormEvent) {
    event.preventDefault()
    if (blocked) return
    const complete = retrying ? await retry(text) : await submit({ text, images: allowedFiles })
    if (complete) navigate('/', { replace: true })
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>보드로 공유</h1>
      </header>
      <form className="card" onSubmit={send}>
        {handoff && (
          <section aria-label="공유한 사진">
            <h2>사진 {handoff.count}장</h2>
            {loadingFiles && <p role="status">사진을 불러오는 중…</p>}
            {loadError && <p className="status err" role="alert">{loadError}</p>}
            <ul className="share-photos">
              {files.map((file, index) => {
                const issue = sharedImageIssue(file)
                const failure = status?.failed.find(({ item }) => item.value === file)
                return (
                  <li key={index}>
                    {!issue && <PhotoPreview file={file} />}
                    <div>
                      <span>{file.name || `사진 ${index + 1}`}</span>
                      {issue && <p className="status err">전송 제외 · {issue}</p>}
                      {failure && <p className="status err">{failure.reason}</p>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <label className="label" htmlFor="shared-text">보낼 내용</label>
        <textarea id="shared-text" className="textarea" rows={handoff ? 3 : 6} value={text}
          disabled={uploading || Boolean(status && !failedText)} onChange={(event) => setText(event.target.value)} />
        {status && <p role="status">{status.total}개 중 {status.sent}개 전송 완료</p>}
        {failedText && <p className="status err" role="alert">{failedText.reason}</p>}
        <div className="btn-row">
          <button className="btn primary" disabled={blocked}>
            {uploading ? '보내는 중…' : retrying ? `실패한 ${status?.failed.length}개 다시 보내기` : '보내기'}
          </button>
          <button type="button" className="btn secondary" disabled={uploading}
            onClick={() => navigate('/', { replace: true })}>{status?.sent ? '닫기' : '취소'}</button>
        </div>
      </form>
    </div>
  )
}
