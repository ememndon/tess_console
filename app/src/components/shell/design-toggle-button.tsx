"use client";

import { useTransition } from "react";
import { setDesignMode } from "@/app/design-actions";
import type { DesignMode } from "@/lib/design-mode";
import { cn } from "@/lib/utils";

// A compact segmented switch in the top bar so the owner (and a showcase audience)
// can flip Pulse ↔ Filament in one click. Both experiences stay fully live.
export function DesignToggleButton({ design }: { design: DesignMode }) {
  const [busy, start] = useTransition();
  function pick(mode: DesignMode) {
    if (mode === design || busy) return;
    start(async () => {
      await setDesignMode(mode);
      window.location.reload();
    });
  }
  const seg = (mode: DesignMode, label: string) => {
    const active = design === mode;
    return (
      <button
        type="button"
        onClick={() => pick(mode)}
        aria-pressed={active}
        className={cn(
          "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        style={active ? { background: design === "filament" ? "rgba(39,240,212,0.15)" : "var(--accent)", color: design === "filament" ? "#8bffec" : undefined } : undefined}
      >
        {label}
      </button>
    );
  };
  return (
    <div className="hidden items-center rounded-full border p-0.5 sm:flex" title="Switch dashboard design" aria-label="Dashboard design">
      {seg("pulse", "Pulse")}
      {seg("filament", "Filament")}
    </div>
  );
}
