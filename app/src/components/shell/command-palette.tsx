"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, Moon, Sun, Globe } from "lucide-react";
import { NAV } from "@/lib/nav";
import { canViewSection } from "@/lib/access";
import { SITE_KEYS, SITE_META } from "@/lib/site-scope";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export function CommandPalette({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  // Cmd/Ctrl-K toggles the palette from anywhere (command palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function run(fn: () => void) {
    setOpen(false);
    fn();
  }

  function setScope(scope: string) {
    document.cookie = `tess_site=${scope}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1 font-mono text-[10px] leading-4 sm:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to a module, switch site, change theme…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          <CommandGroup heading="Navigate">
            {NAV.filter(({ href }) => canViewSection(role, href)).map(({ href, label, icon: Icon }) => (
              <CommandItem key={href} value={`go ${label}`} onSelect={() => run(() => router.push(href))}>
                <Icon />
                {label}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Switch site">
            <CommandItem value="site all sites" onSelect={() => run(() => setScope("all"))}>
              <Globe />
              All Sites
            </CommandItem>
            {SITE_KEYS.map((k) => (
              <CommandItem
                key={k}
                value={`site ${SITE_META[k].name}`}
                onSelect={() => run(() => setScope(k))}
              >
                <span className={cn("size-2 rounded-full", SITE_META[k].dot)} />
                {SITE_META[k].name}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Theme">
            <CommandItem value="theme dark" onSelect={() => run(() => setTheme("dark"))}>
              <Moon />
              Dark
            </CommandItem>
            <CommandItem value="theme light" onSelect={() => run(() => setTheme("light"))}>
              <Sun />
              Light
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
