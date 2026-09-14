import { Camera, ImageUp, RefreshCw, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  checkImageBlob,
  checkVideoFrame,
  compressImage,
  type QualityVerdict,
} from "@/lib/image-quality";

type Props = {
  onCapture: (photo: Blob, verdict: QualityVerdict) => void;
};

export function CameraCapture({ onCapture }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState<QualityVerdict | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraError("We couldn't open your camera. Take the photo with your camera app instead.");
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!videoRef.current || cameraError) return;
      setLive(checkVideoFrame(videoRef.current));
    }, 600);
    return () => window.clearInterval(timer);
  }, [cameraError]);

  const accept = useCallback(
    async (blob: Blob) => {
      setBusy(true);
      setRejected(null);
      try {
        const compressed = await compressImage(blob);
        const verdict = await checkImageBlob(compressed);
        if (!verdict.ok) {
          setRejected(verdict.hint);
          return;
        }
        stop();
        onCapture(compressed, verdict);
      } catch (e) {
        setRejected(e instanceof Error ? e.message : "That photo could not be used");
      } finally {
        setBusy(false);
      }
    },
    [onCapture, stop],
  );

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
    );
    if (blob) await accept(blob);
  }, [accept]);

  return (
    <div className="relative flex h-[100dvh] w-full flex-col bg-ink text-ink-foreground">
      <div className="relative flex-1 overflow-hidden">
        {!cameraError && (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
          />
        )}

        {cameraError && (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <Camera className="size-10 opacity-60" aria-hidden />
            <p className="text-sm opacity-80">{cameraError}</p>
          </div>
        )}

        {/* framing guide */}
        {!cameraError && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[46%] w-[76%] rounded-2xl border-2 border-ink-foreground/40" />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 p-4">
          <p className="mx-auto w-fit rounded-full bg-ink/70 px-4 py-2 text-center text-xs font-medium backdrop-blur">
            {rejected
              ? rejected
              : live && !live.ok
                ? live.hint
                : "Frame the pothole, garbage or leak and tap the shutter"}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 px-8 pb-10 pt-6">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-12 rounded-full text-ink-foreground hover:bg-ink-foreground/10"
          onClick={() => fileRef.current?.click()}
          aria-label="Use a photo from your camera app"
        >
          <ImageUp className="size-5" aria-hidden />
        </Button>

        <button
          type="button"
          onClick={shoot}
          disabled={busy || !!cameraError}
          aria-label="Take photo"
          className="grid size-20 place-items-center rounded-full border-4 border-ink-foreground/80 bg-primary text-primary-foreground shadow-lift transition active:scale-95 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="size-7 animate-spin" aria-hidden />
          ) : (
            <Camera className="size-7" aria-hidden />
          )}
        </button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-12 rounded-full text-ink-foreground hover:bg-ink-foreground/10"
          onClick={() => {
            stop();
            void start();
          }}
          aria-label="Restart camera"
        >
          <RefreshCw className="size-5" aria-hidden />
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void accept(file);
        }}
      />
    </div>
  );
}
