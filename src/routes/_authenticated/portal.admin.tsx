import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { decideStaffRequest, listStaffRequests } from "@/lib/staff.functions";

export const Route = createFileRoute("/_authenticated/portal/admin")({
  head: () => ({
    meta: [
      { title: "Staff access · CivicLens municipal portal" },
      {
        name: "description",
        content:
          "Corporation administrator view: approve or decline department staff access requests for CivicLens.",
      },
      { property: "og:title", content: "Staff access · CivicLens municipal portal" },
      {
        property: "og:description",
        content: "Approve municipal department staff before they can see citizen reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StaffAccessAdmin,
});

function StaffAccessAdmin() {
  const queryClient = useQueryClient();
  const fetchRequests = useServerFn(listStaffRequests);
  const decide = useServerFn(decideStaffRequest);

  const { data, isLoading, error } = useQuery({
    queryKey: ["staff-requests"],
    queryFn: () => fetchRequests(),
  });

  const act = useMutation({
    mutationFn: (vars: { id: string; approve: boolean }) => decide({ data: vars }),
    onSuccess: () => {
      toast.success("Saved");
      void queryClient.invalidateQueries({ queryKey: ["staff-requests"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save that"),
  });

  return (
    <div className="min-h-[100dvh] bg-foreground/[0.03]">
      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <header className="mb-5 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label="Back to the department queue">
            <Link to="/portal">
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Staff access requests</h1>
        </header>

        {isLoading ? (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </div>
        ) : error ? (
          <p className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Could not load requests"}
          </p>
        ) : !data?.length ? (
          <p className="rounded-3xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No staff has requested access yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-lift"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{s.full_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.work_email}
                    {s.job_title && ` · ${s.job_title}`}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {(s.departments as { name?: string } | null)?.name ?? "Unknown department"} ·
                    requested {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                {s.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => act.mutate({ id: s.id, approve: true })}
                      disabled={act.isPending}
                    >
                      <Check className="size-4" aria-hidden />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => act.mutate({ id: s.id, approve: false })}
                      disabled={act.isPending}
                    >
                      <X className="size-4" aria-hidden />
                      Decline
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.status}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => act.mutate({ id: s.id, approve: s.status !== "approved" })}
                      disabled={act.isPending}
                    >
                      {s.status === "approved" ? "Revoke" : "Approve"}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
