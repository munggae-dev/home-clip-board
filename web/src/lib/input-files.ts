const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif)$/i

export function sharedImageIssue(file: File): string | undefined {
  if (!IMAGE_TYPES.test(file.type)) return 'JPEG, PNG, WebP, GIF 파일만 보낼 수 있습니다.'
  if (file.size > 10 * 1024 * 1024) return '파일 크기가 10 MiB를 넘습니다.'
}

export function filterImageFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter(file => IMAGE_TYPES.test(file.type))
}

export function readIncomingData(dt: DataTransfer) {
  const images = filterImageFiles(dt.files)
  if (!images.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file && IMAGE_TYPES.test(file.type)) images.push(file)
    }
  }
  return { images, text: dt.getData('text/plain').trim() }
}
