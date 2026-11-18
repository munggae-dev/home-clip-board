// Imported by the PWA service worker. The share stays inside this navigation
// response until the user sends it from the review page.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'POST' || request.mode !== 'navigate') return
  const url = new URL(request.url)
  if (url.origin === self.location.origin && url.pathname === '/share') {
    const review = reviewShare(event)
    event.respondWith(review.then(({ response }) => response))
    event.waitUntil(review.then(({ delivered }) => delivered))
  }
})

function shareFilesWithPage(clientId, files) {
  const token = crypto.randomUUID()
  const channel = new BroadcastChannel('board-share:' + token)
  const delivered = new Promise((resolve) => {
    const release = () => {
      clearTimeout(timer)
      channel.close()
      resolve()
    }
    const timer = setTimeout(release, 60_000)
    channel.onmessage = async ({ data }) => {
      if (data !== 'ready') return
      try {
        // Only the window created by this POST may receive its photos.
        // The channel merely signals readiness, even across controller updates.
        const client = await self.clients.get(clientId)
        if (client?.type === 'window' && client.url === new URL('/share', self.location.origin).href) {
          client.postMessage({ type: 'board-share-files', token, files })
        }
      } finally {
        release()
      }
    }
  })
  return { token, delivered }
}

async function reviewShare(event) {
  const form = await event.request.formData()
  const parts = ['title', 'text', 'url'].map((name) => {
    const value = form.get(name)
    return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''
  })
  const [title, text, url] = parts
  const lines = new Set()
  if (title && title !== text && !text.startsWith(title + '\n')) lines.add(title)
  if (text) lines.add(text)
  if (url && !text.split(/\s+/).includes(url)) lines.add(url)

  const shell = await caches.match('/index.html', { ignoreSearch: true })
    ?? await fetch('/index.html')
  // The script is an inert JSON data block. Escape every '<' so even a
  // literal closing script tag in shared text can never become markup.
  const json = JSON.stringify([...lines].join('\n')).replace(/</g, '\\u003c')
  const page = await shell.text()
  const files = form.getAll('images').filter((part) =>
    !(part instanceof File && part.name === '' && part.size === 0))
  const handoff = files.length ? shareFilesWithPage(event.resultingClientId, files) : null
  const fileInfo = handoff ? JSON.stringify({ token: handoff.token, count: files.length }) : ''
  const fileScript = fileInfo ? '<script type="application/json" id="shared-files">' + fileInfo + '</script>' : ''
  const html = page.replace('</head>', () =>
    '<script type="application/json" id="shared-content">' + json + '</script>' + fileScript + '</head>')
  const response = new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': shell.headers.get('Content-Security-Policy') || "frame-ancestors 'none'",
    },
  })
  return { response, delivered: handoff?.delivered }
}
