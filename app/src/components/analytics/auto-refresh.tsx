"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

// Keeps the real-time strip fresh by re-rendering the server page on an interval
// (real-time view). Pauses while the tab is hidden to avoid waste.
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [on, seconds, router]);

  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      title={on ? "Live — click to pause auto-refresh" : "Paused — click to resume"}
    >
      <RefreshCw className={`size-3 ${on ? "animate-spin [animation-duration:3s]" : ""}`} />
      {on ? "Live" : "Paused"}
    </button>
  );
}
