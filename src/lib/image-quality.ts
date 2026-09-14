/**
 * On-device photo pre-check. Runs entirely in the browser before upload so
 * unusable photos never reach the backend.
 *
 * Signals:
 *  - mean luminance      -> too dark / too bright
 *  - Laplacian variance  -> blur / out of focus
 *  - edge density in the centre third -> "move closer", nothing of interest
 */

export type QualityVerdict = {
  ok: boolean;
  hint: string;
  sharpness: number;
  brightness: number;
  subjectFocus: number;
};

const SAMPLE = 224;

export function analyzeImageData(data: ImageData): QualityVerdict {
  const { width: w, height: h, data: px } = data;
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const v = (px[i]! * 0.299 + px[i + 1]! * 0.587 + px[i + 2]! * 0.114) / 255;
    gray[p] = v;
    sum += v;
  }
  const brightness = sum / gray.length;

  // Laplacian response
  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;
  let centreEdge = 0;
  let centreCount = 0;
  const x0 = Math.floor(w / 3);
  const x1 = Math.floor((w * 2) / 3);
  const y0 = Math.floor(h / 3);
  const y1 = Math.floor((h * 2) / 3);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        centreEdge += Math.abs(lap);
        centreCount++;
      }
    }
  }
  const mean = lapSum / count;
  const variance = lapSqSum / count - mean * mean;
  const sharpness = variance * 1000;
  const subjectFocus = centreCount ? (centreEdge / centreCount) * 100 : 0;

  if (brightness < 0.16) {
    return fail("Too dark — turn on more light or move to a brighter spot", sharpness, brightness, subjectFocus);
  }
  if (brightness > 0.94) {
    return fail("Too bright — avoid pointing straight at the sun", sharpness, brightness, subjectFocus);
  }
  if (sharpness < 1.2) {
    return fail("Photo looks blurry — hold still and tap again", sharpness, brightness, subjectFocus);
  }
  if (subjectFocus < 0.35) {
    return fail("Move closer so the issue fills the frame", sharpness, brightness, subjectFocus);
  }
  return { ok: true, hint: "Looks good", sharpness, brightness, subjectFocus };
}

function fail(
  hint: string,
  sharpness: number,
  brightness: number,
  subjectFocus: number,
): QualityVerdict {
  return { ok: false, hint, sharpness, brightness, subjectFocus };
}

function sampleFrom(
  source: HTMLVideoElement | HTMLImageElement,
  sw: number,
  sh: number,
): ImageData | null {
  const canvas = document.createElement("canvas");
  const scale = SAMPLE / Math.max(sw, sh);
  canvas.width = Math.max(2, Math.round(sw * scale));
  canvas.height = Math.max(2, Math.round(sh * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function checkVideoFrame(video: HTMLVideoElement): QualityVerdict | null {
  if (!video.videoWidth) return null;
  const data = sampleFrom(video, video.videoWidth, video.videoHeight);
  return data ? analyzeImageData(data) : null;
}

export async function checkImageBlob(blob: Blob): Promise<QualityVerdict> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that photo"));
      el.src = url;
    });
    const data = sampleFrom(img, img.naturalWidth, img.naturalHeight);
    if (!data) return { ok: true, hint: "Looks good", sharpness: 0, brightness: 0, subjectFocus: 0 };
    return analyzeImageData(data);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Downscale + re-encode so uploads stay small on poor connections. */
export async function compressImage(blob: Blob, maxEdge = 1440): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not read that photo"));
      el.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
    );
    return out ?? blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
