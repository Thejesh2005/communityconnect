import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [
      { title: "Municipal staff sign-in · CivicLens" },
      {
        name: "description",
        content:
          "Department sign-in for municipal corporation staff: see reports routed to your department and update their status.",
      },
      { property: "og:title", content: "Municipal staff sign-in · CivicLens" },
      {
        property: "og:description",
        content: "Department queue, notifications and status updates for municipal corporation crews.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StaffAuthPage,
});

function StaffAuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [sentConfirmation, setSentConfirmation] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/portal", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        void navigate({ to: "/portal", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/portal` },
        });
        if (error) throw error;
        if (!data.session) {
          setSentConfirmation(true);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-foreground/[0.03] px-6 py-12">
      <Link to="/" className="mb-8 flex items-center gap-2 text-sm font-semibold">
        <Building2 className="size-5 text-primary" aria-hidden />
        CivicLens · Municipal portal
      </Link>

      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 shadow-lift">
        {sentConfirmation ? (
          <div className="space-y-3 text-center">
            <h1 className="text-xl font-semibold">Confirm your work email</h1>
            <p className="text-sm text-muted-foreground">
              We sent a link to {email}. Open it, then request access to your department.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">
              {mode === "signin" ? "Department sign-in" : "Register as staff"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              For municipal corporation employees. Citizens report{" "}
              <Link to="/auth" className="underline underline-offset-4">
                here
              </Link>
              .
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="staff-email">Work email</Label>
                <Input
                  id="staff-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff-password">Password</Label>
                <Input
                  id="staff-password"
                  type="password"
                  minLength={6}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {mode === "signin" ? "Sign in" : "Create staff account"}
              </Button>
            </form>

            <p className="mt-4 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
              New staff accounts need approval from the corporation administrator before any report
              becomes visible.
            </p>

            <button
              type="button"
              className="mt-4 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin"
                ? "New department staff? Register"
                : "Already registered? Sign in"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
