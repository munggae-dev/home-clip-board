import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  deleteQueueItem,
  fileUrl,
  getQueueItem,
  type QueueItemMeta,
} from '../api/client'
import { copyImageToClipboard } from '../lib/copy-image'
import { filterImageFiles, readIncomingData } from '../lib/input-files'
import Toast from '../components/Toast'
import { useClipUploads } from '../hooks/useClipUploads'
import { useQueue } from '../hooks/useQueue'
import { useToast } from '../hooks/useToast'

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

export default function Home() {
  const { items, loading, listError, refresh } = useQueue()
  const [text, setText] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState('')
  const { toast, show: showToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const clearSentDraft = useCallback((draft: string) => {
    setText(current => current === draft ? '' : current)
  }, [])
  const { status, uploading, submit, retry, dismiss } = useClipUploads(clearSentDraft, refresh)
  const hasFailures = Boolean(status?.failed.length)
  const uploadBlocked = uploading || hasFailures

  function handleAddText() {
    void submit({ text, fromDraft: true })
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (!uploadBlocked) void submit(readIncomingData(e.dataTransfer))
  }

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return
      const payload = readIncomingData(e.clipboardData)
      if (payload.images.length) {
        e.preventDefault()
        if (!uploadBlocked) void submit({
          images: payload.images,
          text: e.target === textareaRef.current ? undefined : payload.text,
        })
      } else if (payload.text && !isTypingTarget(e.target)) {
        e.preventDefault()
        if (!uploadBlocked) void submit({ text: payload.text })
      }
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [submit, uploadBlocked])

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function onDragLeave(e: React.DragEvent) {
    if (dropRef.current?.contains(e.relatedTarget as Node)) return
    setDragOver(false)
  }

  async function handleExpand(item: QueueItemMeta) {
    if (expandedId === item.id) {
      setExpandedId(null)
      setExpandedContent('')
      return
    }
    if (item.type === 'text') {
      setExpandedId(item.id)
      setExpandedContent('')
      try {
        const full = await getQueueItem(item.id)
        setExpandedContent(full.content ?? item.preview ?? '')
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '내용을 불러오지 못했습니다.')
      }
      return
    }
    setExpandedId(item.id)
    setExpandedContent('')
  }

  async function handleCopyText(item: QueueItemMeta) {
    try {
      const full = await getQueueItem(item.id)
      const content = full.content ?? ''
      try {
        await navigator.clipboard.writeText(content)
        showToast('텍스트가 복사되었습니다.')
      } catch {
        setExpandedId(item.id)
        setExpandedContent(content)
        showToast('복사 권한이 없습니다. 텍스트를 직접 선택하세요.', 'error')
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '복사에 실패했습니다.')
    }
  }

  async function handleCopyImage(item: QueueItemMeta) {
    if (!item.thumb_url) return
    setError(null)
    const result = await copyImageToClipboard(fileUrl(item.id))
    if (result.success) {
      showToast('이미지가 복사되었습니다.')
      return
    }
    setExpandedId(item.id)
    showToast('이미지 복사에 실패했습니다.', 'error')
  }

  async function handleDelete(id: string) {
    if (!confirm('이 항목을 삭제할까요?')) return
    setError(null)
    try {
      await deleteQueueItem(id)
      if (expandedId === id) {
        setExpandedId(null)
        setExpandedContent('')
      }
      await refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '삭제에 실패했습니다.')
    }
  }

  const busy = loading || uploading

  return (
    <div className="page">
      <header className="page-header">
        <div className="board-title">
          <h1>Home Clip Board</h1>
          <small className="board-version" title="실행 중인 웹 앱 버전">v{__APP_VERSION__}</small>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn secondary small"
            onClick={() => {
              setError(null)
              void refresh()
            }}
            disabled={busy}
          >
            {loading ? '…' : '새로고침'}
          </button>
          <Link to="/settings" className="btn secondary small">
            설정
          </Link>
        </div>
      </header>

      {(error || listError) && (
        <p className="banner err" role="alert">
          {error || listError}
        </p>
      )}
      {status && (
        <div className={`banner ${hasFailures ? 'warn' : 'ok'}`}>
          <span role="status">{status.total}개 중 {status.sent}개 전송{uploading ? ' · 전송 중…' : ' 완료'}</span>
          {hasFailures && !uploading && (
            <>
              <ul>
                {status.failed.map(({ item, reason }) => (
                  <li key={item.id}>{typeof item.value === 'string' ? '텍스트' : item.value.name} · {reason}</li>
                ))}
              </ul>
              <div className="btn-row">
                <button type="button" className="btn secondary small" onClick={() => void retry()}>
                  실패한 {status.failed.length}개 다시 보내기
                </button>
                <button type="button" className="btn secondary small" onClick={dismiss}>
                  재시도 취소
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {toast && <Toast message={toast.message} variant={toast.variant} />}

      <section className="card add-section">
        <h2>추가</h2>
        <div
          ref={dropRef}
          className={`dropzone${dragOver ? ' dropzone-active' : ''}${uploading ? ' dropzone-busy' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={handleDrop}
          onClick={(e) => {
            if (uploadBlocked || (e.target as HTMLElement).closest('textarea, button, a, input')) return
            fileRef.current?.click()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              if (uploadBlocked || (e.target as HTMLElement).closest('textarea, button, a, input')) return
              fileRef.current?.click()
            }
          }}
          role="region"
          aria-label="파일 드롭 또는 붙여넣기 영역"
        >
          <p className="dropzone-hint desktop-only">
            이미지·텍스트를 <strong>드래그</strong>하거나{' '}
            <kbd>Ctrl</kbd>+<kbd>V</kbd>로 붙여넣기 · 클릭하여 파일 선택
          </p>
          <p className="dropzone-hint mobile-only">
            탭하여 이미지 선택 · 아래에 텍스트 입력
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            hidden
            disabled={uploadBlocked}
            onChange={(e) => {
              if (e.target.files) void submit({ images: filterImageFiles(e.target.files) })
              e.target.value = ''
            }}
          />

          <textarea
            ref={textareaRef}
            className="textarea dropzone-textarea"
            rows={3}
            placeholder="텍스트 입력 후 추가 (붙여넣은 이미지는 바로 업로드)"
            value={text}
            disabled={uploading}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                void handleAddText()
              }
            }}
            onClick={(e) => e.stopPropagation()}
          />

          <div className="btn-row">
            <button
              type="button"
              className="btn primary"
              onClick={(e) => {
                e.stopPropagation()
                void handleAddText()
              }}
              disabled={!text.trim() || uploadBlocked}
            >
              {uploading ? '업로드 중…' : '텍스트 추가'}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={(e) => {
                e.stopPropagation()
                fileRef.current?.click()
              }}
              disabled={uploadBlocked}
            >
              이미지 선택
            </button>
          </div>
        </div>
      </section>

      <section className="queue-section">
        <h2>큐 ({items.length})</h2>
        {items.length === 0 && !loading && (
          <p className="empty">항목이 없습니다. 텍스트나 이미지를 추가하세요.</p>
        )}
        <ul className="queue-list">
          {items.map((item) => (
            <li key={item.id} className="queue-item">
              <div className="queue-item-main" onClick={() => handleExpand(item)}>
                <span className={`badge ${item.type}`}>
                  {item.type === 'text' ? 'TXT' : 'IMG'}
                </span>
                <div className="queue-item-body">
                  {item.type === 'text' ? (
                    <p className="preview">{item.preview || '(빈 텍스트)'}</p>
                  ) : (
                    item.thumb_url && (
                      <img
                        src={fileUrl(item.id)}
                        alt=""
                        className="thumb"
                        loading="lazy"
                      />
                    )
                  )}
                  <span className="meta">
                    {formatTime(item.created_at)}
                    {item.size ? ` · ${formatSize(item.size)}` : ''}
                  </span>
                </div>
              </div>
              <div className="queue-item-actions">
                {item.type === 'text' && (
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleCopyText(item)
                    }}
                  >
                    복사
                  </button>
                )}
                {item.type === 'image' && item.thumb_url && (
                  <>
                    <button
                      type="button"
                      className="btn secondary small"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleCopyImage(item)
                      }}
                    >
                      이미지 복사
                    </button>
                    <a
                      className="btn secondary small"
                      href={fileUrl(item.id)}
                      download={`clip-${item.id}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      다운로드
                    </a>
                    <a
                      className="btn secondary small"
                      href={fileUrl(item.id)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      새 탭
                    </a>
                  </>
                )}
                <button
                  type="button"
                  className="btn danger small"
                  onClick={() => handleDelete(item.id)}
                >
                  삭제
                </button>
              </div>
              {expandedId === item.id && item.type === 'text' && (
                <textarea
                  className="expanded-text"
                  readOnly
                  value={expandedContent}
                  rows={6}
                />
              )}
              {expandedId === item.id &&
                item.type === 'image' &&
                item.thumb_url && (
                  <div className="expanded-image">
                    <img
                      src={fileUrl(item.id)}
                      alt=""
                      className="expanded-image-img"
                    />
                    <p className="expanded-image-hint">
                      「이미지 복사」가 안 되면 이 그림에서{' '}
                      <strong>우클릭 → 이미지 복사</strong> (Mac: Ctrl+클릭)
                    </p>
                  </div>
                )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
