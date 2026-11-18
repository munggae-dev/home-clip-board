import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, listQueue, openQueueEvents, type QueueItemMeta } from '../api/client'

export function useQueue() {
  const [items, setItems] = useState<QueueItemMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const foregroundRefresh = useRef<(() => Promise<void>) | null>(null)
  const refresh = useCallback(async () => { await foregroundRefresh.current?.() }, [])

  useEffect(() => {
    let source: EventSource | undefined
    let lifetime: AbortController | undefined
    let initialFallback: number | undefined

    function disconnect() {
      window.clearTimeout(initialFallback)
      source?.close()
      source = undefined
      lifetime?.abort()
      lifetime = undefined
      foregroundRefresh.current = null
    }

    function connect() {
      if (document.visibilityState !== 'visible' || lifetime) return
      lifetime = new AbortController()
      const { signal } = lifetime
      let pending: Promise<void> | undefined
      let dirty = false

      // A change during a list request needs a fresh snapshot after that request.
      async function load() {
        setLoading(true)
        do {
          dirty = false
          try {
            const result = await listQueue(100, signal)
            if (signal.aborted) return
            setItems(result.items ?? [])
            setListError(null)
          } catch (error) {
            if (signal.aborted) return
            setListError(error instanceof ApiError ? error.message : '목록을 불러오지 못했습니다.')
          }
        } while (dirty)
        pending = undefined
        setLoading(false)
      }

      function update() {
        if (signal.aborted) return Promise.resolve()
        if (pending) dirty = true
        else pending = load()
        return pending
      }

      foregroundRefresh.current = update
      try {
        source = openQueueEvents()
      } catch {
        void update()
        return
      }

      // An unavailable or buffered stream must not delay the first list indefinitely.
      let needsInitialList = true
      const loadInitial = () => {
        if (!needsInitialList || signal.aborted) return
        needsInitialList = false
        window.clearTimeout(initialFallback)
        void update()
      }
      initialFallback = window.setTimeout(loadInitial, 3000)
      source.onerror = loadInitial
      source.onopen = () => {
        if (signal.aborted) return
        needsInitialList = false
        window.clearTimeout(initialFallback)
        void update()
      }
      source.addEventListener('queue-changed', update)
    }

    function visibilityChanged() {
      if (document.visibilityState === 'visible') connect()
      else disconnect()
    }

    connect()
    document.addEventListener('visibilitychange', visibilityChanged)
    window.addEventListener('pagehide', disconnect)
    window.addEventListener('pageshow', connect)
    return () => {
      disconnect()
      document.removeEventListener('visibilitychange', visibilityChanged)
      window.removeEventListener('pagehide', disconnect)
      window.removeEventListener('pageshow', connect)
    }
  }, [])

  return { items, loading, listError, refresh }
}
