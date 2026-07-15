"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { SITE_KEYS, SITE_META, type SiteScope } from "@/lib/site-scope";

export function SiteSwitcher({ current }: { current: SiteScope }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(scope: SiteScope) {
    document.cookie = `tess_site=${scope}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  const base =
    "rounded-full px-3 py-1 text-sm font-medium transition-colors hover:text-foreground";

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-full border bg-card p-1",
        pending && "opacity-60"
      )}
      role="tablist"
      aria-label="Site scope"
    >
      <button
        role="tab"
        aria-selected={current === "all"}
        className={cn(
          base,
          current === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
        )}
        onClick={() => select("all")}
      >
        All Sites
      </button>
      {SITE_KEYS.map((key) => (
        <button
          key={key}
          role="tab"
          aria-selected={current === key}
          className={cn(
            base,
            current === key ? SITE_META[key].chip : "text-muted-foreground"
          )}
          onClick={() => select(key)}
        >
          <span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", SITE_META[key].dot)} />
          {SITE_META[key].name}
        </button>
      ))}
    </div>
  );
}
