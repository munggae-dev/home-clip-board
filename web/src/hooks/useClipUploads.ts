import { useCallback, useRef, useState } from 'react'
import { ApiError, createImage, createText } from '../api/client'

type Upload = {
  id: string
  value: File | string
  fromDraft?: boolean
}

type FailedUpload = { item: Upload; reason: string }
type UploadStatus = { total: number; sent: number; failed: FailedUpload[] }

export function useClipUploads(onDraftSent?: (draft: string) => void, refresh?: () => Promise<void>) {
  const [status, setStatus] = useState<UploadStatus | null>(null)
  const [uploading, setUploading] = useState(false)
  const sending = useRef(false)

  const send = useCallback(async (items: Upload[], total: number) => {
    if (sending.current || !items.length) return
    sending.current = true
    setUploading(true)
    let sent = total - items.length
    const failed: FailedUpload[] = []
    setStatus({ total, sent, failed: [] })
    try {
      for (const item of items) {
        try {
          if (typeof item.value === 'string') {
            await createText(item.value.trim(), item.id)
            if (item.fromDraft) onDraftSent?.(item.value)
          } else {
            await createImage(item.value, item.id)
          }
          sent++
        } catch (error) {
          failed.push({ item, reason: error instanceof ApiError ? error.message : '전송에 실패했습니다.' })
        }
        setStatus({ total, sent, failed: [...failed] })
      }
      return failed.length === 0
    } finally {
      sending.current = false
      setUploading(false)
      void refresh?.()
    }
  }, [onDraftSent, refresh])

  const submit = useCallback((payload: { images?: File[]; text?: string; fromDraft?: boolean }) => {
    if (sending.current || status?.failed.length) return
    const items: Upload[] = (payload.images ?? []).map(file => ({
      id: crypto.randomUUID(),
      value: file,
    }))
    if (payload.text?.trim()) {
      items.push({ id: crypto.randomUUID(), value: payload.text, fromDraft: payload.fromDraft })
    }
    return send(items, items.length)
  }, [send, status])

  function retry(editedText?: string) {
    if (!status) return
    const items = status.failed.map(({ item }) => {
      if (typeof item.value === 'string' && editedText !== undefined && editedText.trim() !== item.value.trim()) {
        return { ...item, id: crypto.randomUUID(), value: editedText }
      }
      return item
    })
    return send(items, status.total)
  }

  return { status, uploading, submit, retry, dismiss: () => setStatus(null) }
}
