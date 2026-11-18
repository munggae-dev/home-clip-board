// Photos arrive directly from the worker that handled this navigation. A worker
// update can change navigator.serviceWorker.controller before React mounts.
export function getSharedFiles(token: string): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel('board-share:' + token)
    const failure = '공유된 사진을 불러오지 못했습니다. 갤러리에서 다시 공유해 주세요.'
    const timeout = window.setTimeout(() => {
      finish()
      reject(new Error(failure))
    }, 10_000)

    function finish() {
      window.clearTimeout(timeout)
      channel.close()
      navigator.serviceWorker.removeEventListener('message', receive)
    }

    function receive(event: MessageEvent) {
      const data = event.data
      if (event.origin !== window.location.origin || data?.type !== 'board-share-files' || data.token !== token) return
      finish()
      if (Array.isArray(data.files) && data.files.every((file: unknown) => file instanceof File)) {
        resolve(data.files)
      } else {
        reject(new Error(failure))
      }
    }
    navigator.serviceWorker.addEventListener('message', receive)
    channel.postMessage('ready')
  })
}
