import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bell,
  Building2,
  Gauge,
  Loader2,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORY_LABELS } from "@/lib/geo";
import {
  claimFirstAdmin,
  getStaffContext,
  listDepartmentReports,
  listDepartments,
  listNotifications,
  markNotificationsRead,
  requestStaffAccess,
} from "@/lib/staff.functions";

export const Route = createFileRoute("/_authenticated/portal/")({
  head: () => ({
    meta: [
      { title: "Department queue · CivicLens municipal portal" },
      {
        name: "description",
        content:
          "Municipal department queue: notifications for newly routed citizen reports, severity ranking and status updates.",
      },
      { property: "og:title", content: "Department queue · CivicLens municipal portal" },
      {
        property: "og:description",
        content: "Every citizen report routed to your department, ranked by computed severity.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PortalHome,
});

function PortalHome() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchContext = useServerFn(getStaffContext);

  const { data: ctx, isLoading } = useQuery({
    queryKey: ["staff-context"],
    queryFn: () => fetchContext(),
  });

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/staff", replace: true });
  }

  if (isLoading || !ctx) {
    return (
      <div className="grid h-[70dvh] place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    );
  }

  const approved = ctx.isAdmin || ctx.profile?.status === "approved";

  return (
    <div className="min-h-[100dvh] bg-foreground/[0.03]">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-display text-sm font-semibold">
              <Building2 className="size-4 text-primary" aria-hidden />
              Municipal portal
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {ctx.department?.name ?? (ctx.isAdmin ? "Corporation administrator" : "No department yet")}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {ctx.isAdmin && (
              <Button asChild variant="ghost" size="sm">
                <Link to="/portal/admin">
                  <ShieldCheck className="size-4" aria-hidden />
                  Staff access
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        {!approved ? (
          <AccessGate
            profileStatus={ctx.profile?.status ?? null}
            canClaimAdmin={!ctx.adminExists}
          />
        ) : (
          <>
            <Notifications unread={ctx.unread} />
            <DepartmentQueue />
          </>
        )}
      </main>
    </div>
  );
}

function AccessGate({
  profileStatus,
  canClaimAdmin,
}: {
  profileStatus: string | null;
  canClaimAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const fetchDepartments = useServerFn(listDepartments);
  const submitRequest = useServerFn(requestStaffAccess);
  const claimAdmin = useServerFn(claimFirstAdmin);

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: () => fetchDepartments(),
  });

  const [departmentId, setDepartmentId] = useState("");
  const [fullName, setFullName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");

  const request = useMutation({
    mutationFn: () =>
      submitRequest({
        data: { departmentId, fullName, workEmail, jobTitle: jobTitle || null },
      }),
    onSuccess: () => {
      toast.success("Request sent to the corporation administrator");
      void queryClient.invalidateQueries({ queryKey: ["staff-context"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send the request"),
  });

  const claim = useMutation({
    mutationFn: () => claimAdmin(),
    onSuccess: () => {
      toast.success("You are now the corporation administrator");
      void queryClient.invalidateQueries({ queryKey: ["staff-context"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not do that"),
  });

  if (profileStatus === "pending") {
    return (
      <div className="rounded-3xl border border-border bg-card p-7 text-center shadow-lift">
        <h1 className="text-xl font-semibold">Waiting for approval</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Your department access request is with the corporation administrator. As soon as it's
          approved, every report routed to your department shows up here.
        </p>
      </div>
    );
  }

  if (profileStatus === "rejected") {
    return (
      <div className="rounded-3xl border border-border bg-card p-7 text-center shadow-lift">
        <h1 className="text-xl font-semibold">Access was declined</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The corporation administrator declined this request. Contact them if you believe that's a
          mistake.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-lift">
        <h1 className="text-xl font-semibold">Request department access</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Tell us who you are and which department you work for. An administrator approves it before
          citizen reports become visible.
        </p>

        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="work-email">Work email</Label>
            <Input
              id="work-email"
              type="email"
              required
              value={workEmail}
              onChange={(e) => setWorkEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="department">Department</Label>
            <select
              id="department"
              required
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Select a department</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="job-title">Designation (optional)</Label>
            <Input id="job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={request.isPending} className="w-full sm:w-auto">
              {request.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Send request
            </Button>
          </div>
        </form>
      </div>

      {canClaimAdmin && (
        <div className="rounded-3xl border border-dashed border-border bg-card p-6">
          <h2 className="text-base font-semibold">No administrator yet</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This city has no corporation administrator. Claim that role once to start approving
            department staff.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => claim.mutate()}
            disabled={claim.isPending}
          >
            {claim.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Become the administrator
          </Button>
        </div>
      )}
    </div>
  );
}

function Notifications({ unread }: { unread: number }) {
  const queryClient = useQueryClient();
  const fetchNotifications = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const [open, setOpen] = useState(unread > 0);

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchNotifications(),
    refetchInterval: 15000,
  });

  const clear = useMutation({
    mutationFn: () => markRead({ data: { id: null } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["staff-context"] });
    },
  });

  const list = data ?? [];
  const unreadNow = list.filter((n) => !n.read_at).length;

  return (
    <section className="mb-6 rounded-3xl border border-border bg-card p-5 shadow-lift">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold"
          onClick={() => setOpen(!open)}
        >
          <span className="relative">
            <Bell className="size-4 text-primary" aria-hidden />
            {unreadNow > 0 && (
              <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                {unreadNow}
              </span>
            )}
          </span>
          Notifications
        </button>
        {unreadNow > 0 && (
          <Button variant="ghost" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
            Mark all read
          </Button>
        )}
      </div>

      {open && (
        <ul className="mt-4 space-y-2">
          {list.length === 0 && (
            <li className="text-sm text-muted-foreground">
              Nothing yet. New citizen reports routed to your department land here.
            </li>
          )}
          {list.slice(0, 10).map((n) => (
            <li key={n.id}>
              <Link
                to="/portal/reports/$id"
                params={{ id: n.report_id }}
                className={`block rounded-2xl border p-3 transition hover:border-primary/40 ${
                  n.read_at ? "border-border" : "border-primary/40 bg-primary/5"
                }`}
              >
                <p className="text-sm font-semibold">{n.title}</p>
                {n.body && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.body}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(n.created_at).toLocaleString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DepartmentQueue() {
  const fetchReports = useServerFn(listDepartmentReports);
  const { data, isLoading } = useQuery({
    queryKey: ["department-reports"],
    queryFn: () => fetchReports(),
    refetchInterval: 20000,
  });

  if (isLoading) {
    return (
      <div className="grid h-40 place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!data?.length) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Queue is clear</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          No citizen reports are currently routed to your department.
        </p>
      </div>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Department queue · {data.length} reports</h2>
      <ul className="space-y-3">
        {data.map((r) => (
          <li key={r.id}>
            <Link
              to="/portal/reports/$id"
              params={{ id: r.id }}
              className="flex gap-3 rounded-2xl border border-border bg-card p-3 shadow-lift transition hover:border-primary/40"
            >
              {r.photoUrl && (
                <img
                  src={r.photoUrl}
                  alt=""
                  loading="lazy"
                  className="size-20 shrink-0 rounded-xl object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={r.needs_review ? "needs_review" : r.status} />
                  {r.priority && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {r.priority} priority
                    </span>
                  )}
                  {r.confirmations > 1 && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Users className="size-3" aria-hidden /> {r.confirmations} citizens
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-semibold">
                  {CATEGORY_LABELS[r.category ?? "other"] ?? "Issue"}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Gauge className="size-3.5" aria-hidden />
                  Severity {r.severity_score ?? "—"}/100 ·{" "}
                  {new Date(r.created_at).toLocaleString()}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

