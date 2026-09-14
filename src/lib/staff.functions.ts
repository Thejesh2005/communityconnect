import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STAFF_STATUSES = ["acknowledged", "in_progress", "resolved"] as const;

async function loadStaff(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id, department_id, full_name, work_email, job_title, status, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  return { profile, isAdmin };
}

/** Who is this signed-in person on the municipal side? */
export const getStaffContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { profile, isAdmin } = await loadStaff(context.supabase, context.userId);

    let department: { id: string; name: string; contact_email: string | null } | null = null;
    if (profile?.department_id) {
      const { data } = await context.supabase
        .from("departments")
        .select("id, name, contact_email")
        .eq("id", profile.department_id)
        .maybeSingle();
      department = data ?? null;
    }

    let unread = 0;
    if (profile?.status === "approved" || isAdmin) {
      const { count } = await context.supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      unread = count ?? 0;
    }

    // Only used to offer the one-time "become the first admin" action.
    let adminExists = true;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      adminExists = (count ?? 0) > 0;
    } catch {
      adminExists = true;
    }

    return { profile: profile ?? null, isAdmin, department, unread, adminExists };
  });

export const listDepartments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("departments")
      .select("id, name")
      .order("name", { ascending: true });
    return data ?? [];
  });

export const requestStaffAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        departmentId: z.string().uuid(),
        fullName: z.string().min(2).max(120),
        workEmail: z.string().email(),
        jobTitle: z.string().max(120).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("staff_profiles").insert({
      user_id: context.userId,
      department_id: data.departmentId,
      full_name: data.fullName.trim(),
      work_email: data.workEmail.trim(),
      job_title: data.jobTitle?.trim() || null,
      status: "pending",
    });
    if (error) {
      throw new Error(
        error.code === "23505" || error.message.includes("duplicate")
          ? "You already have an access request on file."
          : error.message,
      );
    }
    return { ok: true };
  });

export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("claim_first_admin");
    if (error) throw new Error(error.message);
    if (!data) throw new Error("An administrator already exists for this city.");
    return { ok: true };
  });

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Only an administrator can do that.");
}

export const listStaffRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("staff_profiles")
      .select("id, full_name, work_email, job_title, status, created_at, departments(name)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const decideStaffRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid(), approve: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { data: row, error: readErr } = await context.supabase
      .from("staff_profiles")
      .select("id, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr || !row) throw new Error("That request no longer exists.");

    const { error } = await context.supabase
      .from("staff_profiles")
      .update({
        status: data.approve ? "approved" : "rejected",
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    if (data.approve) {
      await context.supabase
        .from("user_roles")
        .upsert({ user_id: row.user_id, role: "staff" }, { onConflict: "user_id,role" });
    } else {
      await context.supabase
        .from("user_roles")
        .delete()
        .eq("user_id", row.user_id)
        .eq("role", "staff");
    }
    return { ok: true };
  });

/** The department queue: everything routed to the signed-in staffer's department. */
export const listDepartmentReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reports")
      .select(
        "id, lat, lng, category, status, severity_score, priority, confirmations, needs_review, citizen_note, ai_description, created_at, image_path, departments(name)",
      )
      .not("department_id", "is", null)
      .order("severity_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    return Promise.all(
      (data ?? []).map(async (r) => {
        const { data: signed } = await context.supabase.storage
          .from("report-photos")
          .createSignedUrl(r.image_path, 3600);
        return { ...r, photoUrl: signed?.signedUrl ?? null };
      }),
    );
  });

export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("notifications")
      .select("id, report_id, title, body, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid().nullable().optional() }).parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    let query = context.supabase.from("notifications").update({ read_at: now }).is("read_at", null);
    if (data.id) query = query.eq("id", data.id);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getDepartmentReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: report, error } = await context.supabase
      .from("reports")
      .select("*, departments(name, contact_email)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!report) throw new Error("This report isn't in your department's queue.");

    const { data: events } = await context.supabase
      .from("report_events")
      .select("id, status, note, photo_path, created_at")
      .eq("report_id", data.id)
      .order("created_at", { ascending: true });

    const { data: signed } = await context.supabase.storage
      .from("report-photos")
      .createSignedUrl(report.image_path, 3600);

    const trail = await Promise.all(
      (events ?? []).map(async (e) => {
        if (!e.photo_path) return { ...e, photoUrl: null as string | null };
        const { data: s } = await context.supabase.storage
          .from("report-photos")
          .createSignedUrl(e.photo_path, 3600);
        return { ...e, photoUrl: s?.signedUrl ?? null };
      }),
    );

    return { report, events: trail, photoUrl: signed?.signedUrl ?? null };
  });

/** Crew update: moves the report forward and writes the audit trail entry. */
export const updateReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(STAFF_STATUSES),
        note: z.string().max(600).nullable().optional(),
        photoPath: z.string().max(300).nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { profile, isAdmin } = await loadStaff(context.supabase, context.userId);
    if (!isAdmin && profile?.status !== "approved") {
      throw new Error("Your department access hasn't been approved yet.");
    }

    const dbStatus = data.status === "acknowledged" ? "reported" : data.status;

    const { error } = await context.supabase
      .from("reports")
      .update({ status: dbStatus })
      .eq("id", data.id);
    if (error) throw new Error(error.message);

    const who = profile?.full_name ?? "Municipal administrator";
    const { error: eventErr } = await context.supabase.from("report_events").insert({
      report_id: data.id,
      status: data.status,
      note: data.note?.trim() ? `${who}: ${data.note.trim()}` : `${who} marked this ${data.status}`,
      photo_path: data.photoPath ?? null,
      created_by: context.userId,
    });
    if (eventErr) throw new Error(eventErr.message);

    return { ok: true };
  });
