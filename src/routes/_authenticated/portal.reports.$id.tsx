import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Camera, Gauge, Loader2, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MapPicker } from "@/components/MapPicker";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORY_LABELS } from "@/lib/geo";
import { getDepartmentReport, updateReportStatus } from "@/lib/staff.functions";

const STATUS_OPTIONS = [
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_progress", label: "Work in progress" },
  { value: "resolved", label: "Resolved" },
] as const;

export const Route = createFileRoute("/_authenticated/portal/reports/$id")({
  head: () => ({
    meta: [
      { title: "Work order · CivicLens municipal portal" },
      {
        name: "description",
        content:
          "Municipal work order: citizen photo, computed severity, recommended action and status updates written into the audit trail.",
      },
      { property: "og:title", content: "Work order · CivicLens municipal portal" },
      {
        property: "og:description",
        content: "Update the status of a citizen report and attach proof of the fix.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkOrder,
});

function WorkOrder() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const fetchReport = useServerFn(getDepartmentReport);
  const saveStatus = useServerFn(updateReportStatus);

  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("acknowledged");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["portal-report", id],
    queryFn: () => fetchReport({ data: { id } }),
  });

  const update = useMutation({
    mutationFn: async () => {
      let photoPath: string | null = null;
      if (file) {
        setUploading(true);
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `resolutions/${id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("report-photos")
          .upload(path, file, { contentType: file.type || "image/jpeg" });
        setUploading(false);
        if (upErr) throw new Error(upErr.message);
        photoPath = path;
      }
      return saveStatus({ data: { id, status, note: note || null, photoPath } });
    },
    onSuccess: () => {
      toast.success("Status updated and logged in the audit trail");
      setNote("");
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ["portal-report", id] });
      void queryClient.invalidateQueries({ queryKey: ["department-reports"] });
    },
    onError: (e) => {
      setUploading(false);
      toast.error(e instanceof Error ? e.message : "Could not update the report");
    },
  });

  if (isLoading) {
    return (
      <div className="grid h-[70dvh] place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 pt-10">
        <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "This report isn't available to you."}
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/portal">Back to the queue</Link>
        </Button>
      </main>
    );
  }

  const r = data.report;
  const department = (r.departments as { name?: string } | null)?.name;

  return (
    <div className="min-h-[100dvh] bg-foreground/[0.03]">
      <main className="mx-auto w-full max-w-2xl px-5 pb-16 pt-6">
        <header className="mb-5 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to the department queue">
            <Link to="/portal">
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          </Button>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <StatusPill status={r.needs_review ? "needs_review" : r.status} />
            {r.confirmations > 1 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="size-3.5" aria-hidden /> Confirmed by {r.confirmations} citizens
              </span>
            )}
          </div>
        </header>

        {data.photoUrl && (
          <img
            src={data.photoUrl}
            alt="Photo submitted by the citizen"
            className="h-64 w-full rounded-2xl object-cover shadow-lift"
          />
        )}

        <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-lift">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">
                {CATEGORY_LABELS[r.category ?? "other"] ?? "Issue"}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {department && `${department} · `}
                {r.priority && `${r.priority} priority · `}
                reported {new Date(r.created_at).toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                <Gauge className="size-3.5" aria-hidden /> Severity
              </p>
              <p className="font-display text-2xl font-semibold">{r.severity_score ?? "—"}/100</p>
            </div>
          </div>

          {r.ai_description && (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{r.ai_description}</p>
          )}
          {r.recommended_action && (
            <div className="mt-4 rounded-xl bg-secondary p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recommended action
              </p>
              <p className="mt-1 text-sm">{r.recommended_action}</p>
            </div>
          )}
          {r.citizen_note && (
            <p className="mt-4 text-sm">
              <span className="font-semibold">Citizen note: </span>
              {r.citizen_note}
            </p>
          )}
        </section>

        <section className="mt-5">
          <h2 className="mb-2 text-sm font-semibold">Location</h2>
          <MapPicker
            lat={r.lat}
            lng={r.lng}
            className="h-48 w-full overflow-hidden rounded-2xl border border-border"
          />
        </section>

        <section className="mt-6 rounded-3xl border border-border bg-card p-5 shadow-lift">
          <h2 className="text-sm font-semibold">Update status</h2>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
          >
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setStatus(o.value)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    status === o.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:border-primary/40"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="crew-note">Note for the audit trail</Label>
              <Textarea
                id="crew-note"
                rows={3}
                placeholder="Crew dispatched, patching scheduled for tomorrow morning…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="resolution-photo">Resolution photo (optional)</Label>
              <label
                htmlFor="resolution-photo"
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground"
              >
                <Camera className="size-4" aria-hidden />
                {file ? file.name : "Attach a photo of the completed work"}
              </label>
              <input
                id="resolution-photo"
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <Button type="submit" disabled={update.isPending || uploading} className="w-full">
              {(update.isPending || uploading) && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Save update
            </Button>
          </form>
        </section>

        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold">Audit trail</h2>
          <ol className="space-y-4 border-l border-border pl-4">
            {data.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" />
                <p className="text-sm font-medium">{e.note ?? e.status}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(e.created_at).toLocaleString()}
                </p>
                {e.photoUrl && (
                  <img
                    src={e.photoUrl}
                    alt="Photo attached to this status update"
                    loading="lazy"
                    className="mt-2 h-40 w-full max-w-xs rounded-xl object-cover"
                  />
                )}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
