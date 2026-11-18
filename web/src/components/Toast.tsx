import type { ToastVariant } from '../hooks/useToast'

type Props = {
  message: string
  variant: ToastVariant
}

export default function Toast({ message, variant }: Props) {
  return (
    <div
      className={`toast toast-${variant}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  )
}
