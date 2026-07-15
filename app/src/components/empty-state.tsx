import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Designed empty states are a Phase 1 deliverable: every module
// explains what will appear and when, instead of showing a blank page.
export function EmptyState({
  icon: Icon,
  title,
  description,
  phase,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  phase?: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-full border bg-card">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>
      {phase !== undefined && (
        <Badge variant="outline" className="mt-1 text-muted-foreground">
          Arrives in Phase {phase}
        </Badge>
      )}
    </div>
  );
}
