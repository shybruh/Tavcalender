/**
 * Turns any photo the browser can read into a small square JPEG for an avatar:
 * centre-cropped and scaled to `size`px. Keeps uploads tiny (phone photos are often 5MB+).
 */
export async function toAvatarBlob(file: File, size = 400): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file")

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("Couldn't read that image. Try a JPG or PNG.")
  }

  const side = Math.min(bitmap.width, bitmap.height)
  const out = Math.min(size, side)
  const canvas = document.createElement("canvas")
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext("2d")!
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out)
  bitmap.close()

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that image"))), "image/jpeg", 0.88),
  )
}
