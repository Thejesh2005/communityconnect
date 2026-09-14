import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, Gauge, MapPin, ScanLine, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-capture.jpg";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CivicLens — report a street issue in 15 seconds" },
      {
        name: "description",
        content:
          "Photograph a pothole, garbage pile or water leak. CivicLens checks the photo on your phone, scores severity and routes it to the right city department.",
      },
      { property: "og:title", content: "CivicLens — report a street issue in 15 seconds" },
      {
        property: "og:description",
        content:
          "Camera-first civic reporting with on-device photo checks, computed severity and a full audit trail.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setSignedIn(!!session),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <div className="civic-grain min-h-[100dvh]">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-5">
        <p className="flex items-center gap-2 font-display text-base font-semibold">
          <ScanLine className="size-5 text-primary" aria-hidden />
          CivicLens
        </p>
        {signedIn ? (
          <Button asChild variant="ghost" size="sm">
            <Link to="/reports">My reports</Link>
          </Button>
        ) : (
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth">Sign in</Link>
          </Button>
        )}
      </header>

      <main className="mx-auto w-full max-w-5xl px-5 pb-20">
        <section className="grid items-center gap-10 pt-6 md:grid-cols-2 md:pt-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Civic accountability, camera first
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-[1.05] md:text-5xl">
              See it. Shoot it.
              <br />
              It's already routed.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
              Open the camera, frame the pothole, tap once. Your phone checks the photo before it
              leaves, the issue gets a computed severity score, and the right department gets a
              work-ready ticket.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild className="h-12 px-6 text-base">
                <Link to={signedIn ? "/report" : "/auth"}>
                  <Camera className="size-5" aria-hidden />
                  Report an issue
                </Link>
              </Button>
              {signedIn && (
                <Button asChild variant="outline" className="h-12 px-6 text-base">
                  <Link to="/reports">Track my reports</Link>
                </Button>
              )}
            </div>
          </div>

          <img
            src={heroImage}
            alt="A citizen photographing a water-filled pothole on a city street"
            width={1600}
            height={1200}
            className="aspect-[4/3] w-full rounded-3xl object-cover shadow-lift"
          />
        </section>

        <section className="mt-20 grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: ShieldCheck,
              title: "Checked on your phone",
              body: "Blurry, dark or empty frames are rejected before upload, with an instant hint on how to fix the shot.",
            },
            {
              icon: Gauge,
              title: "Severity is computed",
              body: "Affected area, depth or spread, traffic exposure and health risk combine into a 0-100 score — not a guess.",
            },
            {
              icon: MapPin,
              title: "Every step recorded",
              body: "GPS pin you can nudge, duplicate reports merged into one ticket, and a timestamped audit trail.",
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-3xl border border-border bg-card p-6 shadow-lift">
              <Icon className="size-5 text-primary" aria-hidden />
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-14 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-border bg-card p-6">
          <div>
            <h2 className="text-base font-semibold">Municipal corporation staff</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Department sign-in for city employees: your queue, notifications and status updates.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/staff">Open the municipal portal</Link>
          </Button>
        </section>
      </main>
    </div>
  );
}
