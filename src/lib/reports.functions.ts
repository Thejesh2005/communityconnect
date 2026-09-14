import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { geoCell, neighbourCells } from "@/lib/geo";

const CreateInput = z.object({
  imagePath: z.string().min(1),
  imageHash: z.string().min(8),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  capturedAt: z.string().nullable().optional(),
});

export const createReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    // Idempotency: the same photo from the same citizen within an hour is the
    // same submission (double tap, retried upload, offline queue replay).
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: existing } = await context.supabase
      .from("reports")
      .select("id")
      .eq("user_id", context.userId)
      .eq("image_hash", data.imageHash)
      .gte("created_at", since)
      .maybeSingle();

    if (existing) return { id: existing.id as string, deduplicated: true };

    const { data: inserted, error } = await context.supabase
      .from("reports")
      .insert({
        user_id: context.userId,
        image_path: data.imagePath,
        image_hash: data.imageHash,
        lat: data.lat,
        lng: data.lng,
        accuracy_m: data.accuracy ?? null,
        geo_cell: geoCell(data.lat, data.lng),
        citizen_note: data.note?.trim() || null,
        captured_at: data.capturedAt ?? new Date().toISOString(),
        ai_status: "pending",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    await context.supabase.from("report_events").insert({
      report_id: inserted.id,
      status: "reported",
      note: "Report received from citizen",
      created_by: context.userId,
    });

    return { id: inserted.id as string, deduplicated: false };
  });

export const analyzeReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: report, error } = await context.supabase
      .from("reports")
      .select("id, image_path, lat, lng, citizen_note, ai_status, geo_cell")
      .eq("id", data.id)
      .single();
    if (error || !report) throw new Error("Report not found");
    if (report.ai_status === "done") return { ok: true, alreadyDone: true };

    await context.supabase.from("reports").update({ ai_status: "analyzing" }).eq("id", report.id);

    const { detectIssue, computeSeverity, CONFIDENCE_THRESHOLD } = await import("@/lib/ai.server");

    try {
      const { data: signed, error: signErr } = await context.supabase.storage
        .from("report-photos")
        .createSignedUrl(report.image_path, 600);
      if (signErr || !signed?.signedUrl) throw new Error("Could not read the uploaded photo");

      const imageRes = await fetch(signed.signedUrl);
      if (!imageRes.ok) throw new Error("Could not read the uploaded photo");
      const mimeType = imageRes.headers.get("content-type") ?? "image/jpeg";
      const bytes = new Uint8Array(await imageRes.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const imageBase64 = btoa(binary);

      const detection = await detectIssue({
        imageBase64,
        mimeType,
        note: report.citizen_note,
        lat: report.lat,
        lng: report.lng,
      });

      const { score, priority } = computeSeverity(detection);
      const needsReview = !detection.detected || detection.confidence < CONFIDENCE_THRESHOLD;

      const slug =
        detection.category === "pothole"
          ? "roads"
          : detection.category === "garbage"
            ? "sanitation"
            : detection.category === "water_leak"
              ? "water"
              : "general";

      const { data: dept } = await context.supabase
        .from("departments")
        .select("id, name")
        .eq("slug", needsReview ? "general" : slug)
        .maybeSingle();

      await context.supabase
        .from("reports")
        .update({
          category: detection.category,
          confidence: Math.round(detection.confidence * 1000) / 1000,
          severity_score: score,
          priority,
          department_id: dept?.id ?? null,
          ai_description: detection.description,
          recommended_action: detection.recommended_action,
          needs_review: needsReview,
          ai_status: "done",
          ai_error: null,
        })
        .eq("id", report.id);

      await context.supabase.from("report_events").insert({
        report_id: report.id,
        status: needsReview ? "needs_review" : "routed",
        note: needsReview
          ? `Low detection confidence (${Math.round(detection.confidence * 100)}%) — queued for human review`
          : `Routed to ${dept?.name ?? "the relevant department"} · severity ${score}/100 · ${priority} priority`,
        created_by: context.userId,
      });

      // Duplicate merging: count reports about the same issue in the same
      // ~33m cell and keep an escalating "confirmed by N citizens" figure.
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cells = neighbourCells(report.lat, report.lng);
        const { data: group } = await supabaseAdmin
          .from("reports")
          .select("id")
          .in("geo_cell", cells)
          .eq("category", detection.category)
          .neq("status", "resolved");
        const count = group?.length ?? 1;
        if (count > 1) {
          await supabaseAdmin
            .from("reports")
            .update({ confirmations: count })
            .in(
              "id",
              group!.map((r) => r.id),
            );
        }
      } catch (mergeError) {
        console.error("duplicate merge skipped", mergeError);
      }

      return { ok: true, alreadyDone: false };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Analysis failed";
      await context.supabase
        .from("reports")
        .update({ ai_status: "failed", ai_error: message, needs_review: true })
        .eq("id", report.id);
      throw new Error(message);
    }
  });

export const getReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: report, error } = await context.supabase
      .from("reports")
      .select("*, departments(name, contact_email)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!report) throw new Error("Report not found");

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

export const listMyReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reports")
      .select(
        "id, lat, lng, category, status, ai_status, severity_score, priority, confirmations, needs_review, created_at, image_path",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const withPhotos = await Promise.all(
      (data ?? []).map(async (r) => {
        const { data: signed } = await context.supabase.storage
          .from("report-photos")
          .createSignedUrl(r.image_path, 3600);
        return { ...r, photoUrl: signed?.signedUrl ?? null };
      }),
    );
    return withPhotos;
  });
