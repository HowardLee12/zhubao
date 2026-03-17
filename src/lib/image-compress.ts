/**
 * Client-side image compression using Canvas API.
 * Outputs WebP when supported, falls back to JPEG.
 */

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function supportsWebP(): boolean {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    return false;
  }
}

async function compressImage(
  file: File,
  maxWidth: number,
  quality: number
): Promise<{ blob: Blob; mimeType: string }> {
  const img = await loadImage(file);

  // Calculate scaled dimensions
  let width = img.naturalWidth;
  let height = img.naturalHeight;

  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context not available");

  ctx.drawImage(img, 0, 0, width, height);

  // Clean up object URL
  URL.revokeObjectURL(img.src);

  const useWebP = supportsWebP();
  const mimeType = useWebP ? "image/webp" : "image/jpeg";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Compression failed"));
          return;
        }
        resolve({ blob, mimeType });
      },
      mimeType,
      quality
    );
  });
}

/**
 * Compress a photo to ~200-300KB for storage.
 * maxWidth: 1200px, quality: 0.7
 */
export async function compressPhoto(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  return compressImage(file, 1200, 0.7);
}

/**
 * Generate a small thumbnail ~30KB for grid display.
 * maxWidth: 300px, quality: 0.5
 */
export async function generateThumbnail(
  file: File
): Promise<{ blob: Blob; mimeType: string }> {
  return compressImage(file, 300, 0.5);
}

/**
 * Get file extension based on mime type.
 */
export function getExtension(mimeType: string): string {
  return mimeType === "image/webp" ? "webp" : "jpg";
}
