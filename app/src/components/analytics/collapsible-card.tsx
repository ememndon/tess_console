"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

// Collapsible install card — a header row with a chevron toggle at the top-right
// so each snippet section can be opened or closed independently.
export function CollapsibleCard({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-(--card-spacing) text-left"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{title}</span>
          {hint && !open && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <CardContent className="flex flex-col gap-4 text-sm">{children}</CardContent>}
    </Card>
  );
}
