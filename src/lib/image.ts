/**
 * Ephemeral image payload attached to an outgoing LLM request.
 * Not persisted — lives only for a single turn.
 */
export interface EphemeralImage {
  /** MIME type, e.g. "image/jpeg" */
  mimeType: string;
  /** Raw base64 (no `data:` prefix) */
  base64: string;
}

const DEFAULT_MAX_EDGE = 1024;
const DEFAULT_JPEG_QUALITY = 0.8;

/** Load a Blob/File into an HTMLImageElement via object URL. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function canvasToJpegBase64(canvas: HTMLCanvasElement, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('toBlob returned null'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const idx = result.indexOf(',');
          resolve(idx === -1 ? result : result.slice(idx + 1));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

function drawToCanvas(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxEdge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(srcWidth, srcHeight));
  const w = Math.max(1, Math.round(srcWidth * scale));
  const h = Math.max(1, Math.round(srcHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** Resize a file/blob and encode as JPEG base64. */
export async function fileToEphemeralImage(
  file: Blob,
  maxEdge: number = DEFAULT_MAX_EDGE,
  quality: number = DEFAULT_JPEG_QUALITY,
): Promise<EphemeralImage> {
  const img = await loadImage(file);
  const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight, maxEdge);
  const base64 = await canvasToJpegBase64(canvas, quality);
  return { mimeType: 'image/jpeg', base64 };
}

/** Capture a frame from a <video> element and encode as JPEG base64. */
export async function videoFrameToEphemeralImage(
  video: HTMLVideoElement,
  maxEdge: number = DEFAULT_MAX_EDGE,
  quality: number = DEFAULT_JPEG_QUALITY,
): Promise<EphemeralImage> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('Video frame unavailable');
  const canvas = drawToCanvas(video, w, h, maxEdge);
  const base64 = await canvasToJpegBase64(canvas, quality);
  return { mimeType: 'image/jpeg', base64 };
}

export function ephemeralImageToDataUrl(img: EphemeralImage): string {
  return `data:${img.mimeType};base64,${img.base64}`;
}
