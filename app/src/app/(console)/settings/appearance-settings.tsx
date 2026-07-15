"use client";

import { useTransition } from "react";
import { Check, Sparkles, LayoutDashboard } from "lucide-react";
import { setDesignMode } from "@/app/design-actions";
import type { DesignMode } from "@/lib/design-mode";
import { cn } from "@/lib/utils";

const EXPERIENCES: { id: DesignMode; name: string; tag: string; desc: string }[] = [
  { id: "pulse", name: "Pulse", tag: "Classic", desc: "The original console — colorful cards, glass surfaces, a violet glow. Bright and familiar." },
  { id: "filament", name: "Filament", tag: "Next-gen", desc: "A card-less, dark, instrument-grade design. A luminous current flows toward whatever needs you." },
];

// Settings → Appearance. Two complete dashboards over the same data; the choice
// is a cookie, remembered across sessions. Built for the eventual public reveal.
export function AppearanceSettings({ current }: { current: DesignMode }) {
  const [busy, start] = useTransition();
  function activate(id: DesignMode) {
    if (id === current || busy) return;
    start(async () => {
      await setDesignMode(id);
      window.location.reload();
    });
  }
  return (
    <section>
      <h2 className="text-sm font-semibold">Appearance</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Two complete dashboards, one set of data. Switch anytime — your choice is remembered.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {EXPERIENCES.map((e) => {
          const active = current === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => activate(e.id)}
              disabled={busy}
              className={cn("group rounded-xl border p-4 text-left transition-colors disabled:opacity-60", active ? "border-primary ring-1 ring-primary/40" : "hover:bg-accent/40")}
            >
              <div className="flex items-center gap-2">
                {e.id === "filament" ? <Sparkles className="size-4 text-primary" /> : <LayoutDashboard className="size-4 text-muted-foreground" />}
                <span className="text-sm font-semibold">{e.name}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{e.tag}</span>
                {active ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-primary"><Check className="size-3.5" /> Active</span>
                ) : (
                  <span className="ml-auto text-[11px] text-muted-foreground group-hover:text-foreground">Activate</span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{e.desc}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
