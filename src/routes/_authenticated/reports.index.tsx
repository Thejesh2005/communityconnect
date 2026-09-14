import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, ScanLine, Users } from "lucide-react";

import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS } from "@/lib/geo";
import { listMyReports } from "@/lib/reports.functions";

export const Route = createFileRoute("/_authenticated/reports/")({
  head: () => ({
    meta: [
      { title: "My reports · CivicLens" },
      {
        name: "description",
        content: "Follow every civic issue you reported, from submission to resolution.",
      },
      { property: "og:title", content: "My reports · CivicLens" },
      {
        property: "og:description",
        content: "Track the status of the potholes, garbage and leaks you reported.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MyReports,
});

function MyReports() {
  const fetchReports = useServerFn(listMyReports);
  const { data, isLoading } = useQuery({
    queryKey: ["my-reports"],
    queryFn: () => fetchReports(),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((r) => r.ai_status !== "done" && r.ai_status !== "failed")
        ? 3000
        : false,
  });

  return (
    <main className="mx-auto w-full max-w-lg px-5 pb-28 pt-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-primary">
            <ScanLine className="size-3.5" aria-hidden /> CivicLens
          </p>
          <h1 className="mt-1 text-2xl font-semibold">My reports</h1>
        </div>
      </header>

      {isLoading ? (
        <div className="grid h-48 place-items-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </div>
      ) : !data?.length ? (
        <div className="rounded-3xl border border-dashed border-border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold">Nothing reported yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Spot a pothole, garbage pile or leaking pipe? It takes about 15 seconds.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id}>
              <Link
                to="/reports/$id"
                params={{ id: r.id }}
                className="flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-lift transition hover:border-primary/40"
              >
                {r.photoUrl ? (
                  <img
                    src={r.photoUrl}
                    alt=""
                    loading="lazy"
                    className="size-20 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <div className="grid size-20 shrink-0 place-items-center rounded-xl bg-muted">
                    <Camera className="size-5 text-muted-foreground" aria-hidden />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.needs_review ? "needs_review" : r.status} />
                    {r.confirmations > 1 && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Users className="size-3" aria-hidden /> {r.confirmations} citizens
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold">
                    {r.ai_status === "done"
                      ? (CATEGORY_LABELS[r.category ?? "other"] ?? "Issue")
                      : r.ai_status === "failed"
                        ? "Analysis needs a retry"
                        : "Analyzing your photo…"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                    {r.severity_score != null && ` · severity ${r.severity_score}/100`}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-lg border-t border-border bg-background/95 p-4 backdrop-blur">
        <Button asChild className="h-12 w-full text-base">
          <Link to="/report">
            <Camera className="size-5" aria-hidden />
            Report an issue
          </Link>
        </Button>
      </div>
    </main>
  );
}
