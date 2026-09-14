import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Crosshair, Loader2, MapPin, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { CameraCapture } from "@/components/CameraCapture";
import { MapPicker } from "@/components/MapPicker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { sha256Hex, type QualityVerdict } from "@/lib/image-quality";
import { analyzeReport, createReport } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({
    meta: [
      { title: "Report an issue · CivicLens" },
      {
        name: "description",
        content:
          "Point your camera at a pothole, garbage pile or water leak and file a routed civic report in seconds.",
      },
      { property: "og:title", content: "Report an issue · CivicLens" },
      {
        property: "og:description",
        content: "Camera-first civic reporting with instant on-device photo checks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportPage,
});

type Photo = { blob: Blob; url: string; verdict: QualityVerdict };

function ReportPage() {
  const navigate = useNavigate();
  const create = useServerFn(createReport);
  const analyze = useServerFn(analyzeReport);

  const [photo, setPhoto] = useState<Photo | null>(null);
  const [note, setNote] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(
    null,
  );
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setLocationError("This device can't share its location. Drop the pin on the map instead.");
      setCoords((c) => c ?? { lat: 12.9716, lng: 77.5946, accuracy: null });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        });
        setLocationError(null);
        setLocating(false);
      },
      () => {
        setLocationError("We couldn't get your location. Drag the pin to the right spot.");
        setCoords((c) => c ?? { lat: 12.9716, lng: 77.5946, accuracy: null });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 },
    );
  }, []);

  useEffect(() => {
    if (photo && !coords) locate();
  }, [photo, coords, locate]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  const submit = useMutation({
    mutationFn: async () => {
      if (!photo || !coords) throw new Error("Take a photo first");
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Please sign in again");

      const hash = await sha256Hex(photo.blob);
      const path = `${userId}/${hash.slice(0, 24)}-${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("report-photos")
        .upload(path, photo.blob, { contentType: "image/jpeg", upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      const { id } = await create({
        data: {
          imagePath: path,
          imageHash: hash,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
          note: note || null,
          capturedAt: new Date().toISOString(),
        },
      });

      // Fire-and-forget: the detail screen streams the result in as it lands.
      void analyze({ data: { id } }).catch(() => undefined);
      return id;
    },
    onSuccess: (id) => {
      toast.success("Report submitted — analyzing your photo");
      void navigate({ to: "/reports/$id", params: { id } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not submit"),
  });

  if (!photo) {
    return (
      <div className="relative">
        <Link
          to="/reports"
          className="absolute left-4 top-4 z-10 inline-flex size-10 items-center justify-center rounded-full bg-ink/60 text-ink-foreground backdrop-blur"
          aria-label="Back to my reports"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <CameraCapture
          onCapture={(blob, verdict) =>
            setPhoto({ blob, url: URL.createObjectURL(blob), verdict })
          }
        />
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col gap-5 px-5 pb-28 pt-6">
      <header className="flex items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setPhoto(null)}
          aria-label="Retake photo"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Confirm the spot</h1>
          <p className="text-xs text-muted-foreground">
            Photo passed the on-device quality check
          </p>
        </div>
      </header>

      <img
        src={photo.url}
        alt="The issue you photographed"
        className="h-56 w-full rounded-2xl object-cover shadow-lift"
      />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="size-4 text-primary" aria-hidden />
            {coords
              ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
              : "Finding your location…"}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={locate} disabled={locating}>
            {locating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Crosshair className="size-4" aria-hidden />
            )}
            Re-locate
          </Button>
        </div>

        {coords ? (
          <MapPicker
            lat={coords.lat}
            lng={coords.lng}
            draggable
            onChange={(lat, lng) => setCoords((c) => ({ lat, lng, accuracy: c?.accuracy ?? null }))}
            className="h-56 w-full overflow-hidden rounded-2xl border border-border"
          />
        ) : (
          <div className="grid h-56 place-items-center rounded-2xl border border-border bg-muted text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {locationError ?? "Tap or drag the pin if GPS put it slightly off."}
        </p>
      </section>

      <section className="space-y-2">
        <label htmlFor="note" className="text-sm font-medium">
          Anything to add? <span className="text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="note"
          rows={3}
          maxLength={500}
          placeholder="e.g. Two-wheelers keep skidding here after rain"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-lg border-t border-border bg-background/95 p-4 backdrop-blur">
        <Button
          className="h-12 w-full text-base"
          disabled={!coords || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? (
            <Loader2 className="size-5 animate-spin" aria-hidden />
          ) : (
            <Send className="size-5" aria-hidden />
          )}
          Submit report
        </Button>
      </div>
    </main>
  );
}
