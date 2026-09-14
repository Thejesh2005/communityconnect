import { cn } from "@/lib/utils";

const styles: Record<string, string> = {
  reported: "bg-reported text-reported-foreground",
  acknowledged: "bg-progress/70 text-progress-foreground",
  routed: "bg-reported text-reported-foreground",
  in_progress: "bg-progress text-progress-foreground",
  resolved: "bg-resolved text-resolved-foreground",
  needs_review: "bg-review text-review-foreground",
};

const labels: Record<string, string> = {
  reported: "Reported",
  acknowledged: "Acknowledged",
  routed: "Routed",
  in_progress: "In progress",
  resolved: "Resolved",
  needs_review: "Needs review",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide",
        styles[status] ?? "bg-muted text-muted-foreground",
        className,
      )}
    >
      {labels[status] ?? status}
    </span>
  );
}
