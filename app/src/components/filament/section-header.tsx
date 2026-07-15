import type { ReactNode } from "react";
import { getDesignMode } from "@/lib/design-mode";
import { FIL } from "@/components/filament/ui";

// One page header for both designs: a register-tagged Filament header, or the
// original Pulse header. Async server component (reads the design cookie), so
// pages just render <SectionHeader title=… register=…>description</SectionHeader>.
export async function SectionHeader({ title, register, children }: { title: string; register?: string; children?: ReactNode }) {
  if ((await getDesignMode()) === "filament") {
    return (
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-white">{title}</h1>
          {children != null && <p className="mt-1 text-[12.5px]" style={{ color: FIL.mut }}>{children}</p>}
        </div>
        {register && (
          <span className="mt-0.5 shrink-0 rounded-full border px-2.5 py-1 text-[9.5px] font-medium uppercase tracking-[0.16em]" style={{ borderColor: "rgba(39,240,212,0.3)", color: FIL.cur }}>
            {register}
          </span>
        )}
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children != null && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}
