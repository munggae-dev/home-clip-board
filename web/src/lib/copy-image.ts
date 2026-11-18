/** 클립보드에 넣기 좋은 PNG Blob으로 변환 */
async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob

  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image load failed'))
      el.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unsupported')
    ctx.drawImage(img, 0, 0)

    const png = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png')
    })
    if (!png) throw new Error('png conversion failed')
    return png
  } finally {
    URL.revokeObjectURL(url)
  }
}

export type CopyImageResult = {
  success: boolean
  message: string
}

/**
 * 이미지 URL을 시스템 클립보드에 복사 (PC에서 다른 앱에 Ctrl+V).
 */
export async function copyImageToClipboard(
  imageUrl: string,
): Promise<CopyImageResult> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === 'undefined'
  ) {
    return {
      success: false,
      message:
        '이 브라우저는 프로그램 복사를 지원하지 않습니다. 이미지를 펼친 뒤 우클릭 → 「이미지 복사」를 사용하세요.',
    }
  }

  let blob: Blob
  try {
    const res = await fetch(imageUrl, { mode: 'same-origin' })
    if (!res.ok) throw new Error('fetch failed')
    blob = await res.blob()
  } catch {
    return {
      success: false,
      message: '이미지를 불러오지 못했습니다.',
    }
  }

  try {
    const png = await blobToPng(blob)
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': png }),
    ])
    return {
      success: true,
      message: '이미지를 클립보드에 복사했습니다. 다른 앱에서 Ctrl+V 하세요.',
    }
  } catch {
    return {
      success: false,
      message:
        '자동 복사에 실패했습니다. 펼친 이미지에서 우클릭 → 「이미지 복사」를 사용하세요.',
    }
  }
}
