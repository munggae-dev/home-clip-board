export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export type QueueItemMeta = {
  id: string
  type: 'text' | 'image'
  preview?: string
  mime?: string
  size?: number
  created_at: string
  thumb_url?: string
}

export type QueueItem = {
  id: string
  type: 'text' | 'image'
  content?: string
  mime?: string
  size?: number
  created_at: string
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, mode: 'same-origin' })
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.', 0)
  }

  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      if (body?.message) msg = body.message
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new ApiError(msg || `요청 실패 (${res.status})`, res.status)
  }

  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

export async function checkHealth(): Promise<{ status: string }> {
  return request('/api/health')
}

export async function listQueue(limit = 100, signal?: AbortSignal): Promise<{ items: QueueItemMeta[] }> {
  return request(`/api/queue?limit=${limit}`, { signal })
}

export function openQueueEvents(): EventSource {
  return new EventSource('/api/queue/events')
}

export async function createText(content: string, requestId?: string): Promise<QueueItem> {
  return request('/api/queue/text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(requestId && { 'Idempotency-Key': requestId }),
    },
    body: JSON.stringify({ content }),
  })
}

export async function createImage(file: File, requestId?: string): Promise<QueueItem> {
  const form = new FormData()
  form.append('file', file)
  return request('/api/queue/image', {
    method: 'POST',
    headers: requestId ? { 'Idempotency-Key': requestId } : undefined,
    body: form,
  })
}

export async function getQueueItem(id: string): Promise<QueueItem> {
  return request(`/api/queue/${encodeURIComponent(id)}`)
}

export async function deleteQueueItem(id: string): Promise<void> {
  await request(`/api/queue/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function fileUrl(id: string): string {
  return `/api/queue/${encodeURIComponent(id)}/file`
}
