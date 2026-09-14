import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Building2,
  CircleAlert,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { MapPicker } from "@/components/MapPicker";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { CATEGORY_LABELS } from "@/lib/geo";
import { analyzeReport, getReport } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/reports/$id")({
  head: () => ({
    meta: [
      { title: "Report status · CivicLens" },
      {
        name: "description",
        content:
          "Live status of your civic report: detected issue, computed severity, routed department and full audit trail.",
      },
      { property: "og:title", content: "Report status · CivicLens" },
      {
        property: "og:description",
        content: "Watch your civic report get classified, scored and routed in real time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReportDetail,
});

function ReportDetail() {
  const { id } = Route.useParams();
  const fetchReport = useServerFn(getReport);
  const retryAnalysis = useServerFn(analyzeReport);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["report", id],
    queryFn: () => fetchReport({ data: { id } }),
    refetchInterval: (query) => {
      const status = query.state.data?.report.ai_status;
      return status === "pending" || status === "analyzing" ? 2000 : false;
    },
  });

  const retry = useMutation({
    mutationFn: () => retryAnalysis({ data: { id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["report", id] }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Analysis failed again"),
  });

  if (isLoading || !data) {
    return (
      <div className="grid h-[70dvh] place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    );
  }

  const r = data.report;
  const analyzing = r.ai_status === "pending" || r.ai_status === "analyzing";
  const department = (r.departments as { name?: string } | null)?.name;

  return (
    <main className="mx-auto w-full max-w-lg px-5 pb-16 pt-6">
      <header className="mb-5 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to my reports">
          <Link to="/reports">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
        </Button>
        <div className="flex flex-1 items-center gap-2">
          <StatusPill status={r.needs_review ? "needs_review" : r.status} />
          {r.confirmations > 1 && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Users className="size-3.5" aria-hidden /> Confirmed by {r.confirmations} citizens
            </span>
          )}
        </div>
      </header>

      {data.photoUrl && (
        <img
          src={data.photoUrl}
          alt="The issue you reported"
          className="h-60 w-full rounded-2xl object-cover shadow-lift"
        />
      )}

      <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-lift">
        {analyzing ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 animate-pulse text-primary" aria-hidden />
              Report submitted — analyzing your photo
            </p>
            <Progress value={r.ai_status === "analyzing" ? 70 : 30} />
            <p className="text-xs text-muted-foreground">
              Detecting the issue, computing a severity score and routing it to the right
              department.
            </p>
          </div>
        ) : r.ai_status === "failed" ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CircleAlert className="size-4 text-destructive" aria-hidden />
              Analysis didn't finish
            </p>
            <p className="text-xs text-muted-foreground">{r.ai_error}</p>
            <Button size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">
                  {CATEGORY_LABELS[r.category ?? "other"] ?? "Issue"}
                </h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Detection confidence {Math.round(Number(r.confidence ?? 0) * 100)}%
                  {r.priority && ` · ${r.priority} priority`}
                </p>
              </div>
              <div className="text-right">
                <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  <Gauge className="size-3.5" aria-hidden /> Severity
                </p>
                <p className="font-display text-2xl font-semibold">{r.severity_score}/100</p>
              </div>
            </div>

            {r.needs_review && (
              <p className="rounded-xl bg-review/10 px-3 py-2 text-xs text-foreground">
                Confidence was below the routing threshold, so a human reviewer will confirm the
                category before crews are dispatched.
              </p>
            )}

            {department && (
              <p className="flex items-center gap-2 text-sm">
                <Building2 className="size-4 text-primary" aria-hidden />
                Routed to <span className="font-semibold">{department}</span>
              </p>
            )}

            {r.ai_description && (
              <p className="text-sm leading-relaxed text-muted-foreground">{r.ai_description}</p>
            )}

            {r.recommended_action && (
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Recommended action
                </p>
                <p className="mt-1 text-sm">{r.recommended_action}</p>
              </div>
            )}
          </div>
        )}
      </section>

      {r.citizen_note && (
        <p className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
          <span className="font-semibold">Your note: </span>
          {r.citizen_note}
        </p>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold">Location</h2>
        <MapPicker
          lat={r.lat}
          lng={r.lng}
          className="h-48 w-full overflow-hidden rounded-2xl border border-border"
        />
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">Audit trail</h2>
        <ol className="space-y-3 border-l border-border pl-4">
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
                  alt="Photo of the completed work"
                  loading="lazy"
                  className="mt-2 h-40 w-full max-w-xs rounded-xl object-cover"
                />
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
