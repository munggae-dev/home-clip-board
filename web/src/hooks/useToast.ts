import { useCallback, useEffect, useRef, useState } from 'react'

export type ToastVariant = 'success' | 'error'

type ToastState = {
  message: string
  variant: ToastVariant
}

const DEFAULT_MS = 2400

export function useToast(durationMs = DEFAULT_MS) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setToast(null)
  }, [])

  const show = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      if (timerRef.current) clearTimeout(timerRef.current)
      setToast({ message, variant })
      timerRef.current = setTimeout(hide, durationMs)
    },
    [durationMs, hide],
  )

  useEffect(() => () => hide(), [hide])

  return { toast, show, hide }
}
