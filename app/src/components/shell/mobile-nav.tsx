"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV } from "@/lib/nav";
import { canViewSection } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { BrandMark } from "@/components/brand-mark";

// Mobile navigation drawer (mobile polish). The desktop sidebar is
// hidden below md; this hamburger opens the same nav as an off-canvas Sheet.
export function MobileNav({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const visible = NAV.filter((i) => canViewSection(role, i.href));
  const items = visible.filter((i) => i.href !== "/settings");
  const settings = visible.find((i) => i.href === "/settings");

  const link = (href: string, label: string, Icon: (typeof NAV)[number]["icon"]) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm transition-colors",
          active ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-sidebar-accent/60 dark:hover:bg-[#c94e00] dark:hover:text-white",
        )}
      >
        <Icon className="size-4" />
        {label}
      </Link>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation" />}
      >
        <Menu className="size-4" />
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-3">
        <SheetTitle className="flex items-center gap-1.5 px-2.5 py-2 text-sm">
          <BrandMark className="h-7 w-auto shrink-0" />
          Tess Console
        </SheetTitle>
        <nav className="flex flex-col gap-0.5">
          {items.map((i) => link(i.href, i.label, i.icon))}
          {settings && <div className="mt-2 border-t pt-2">{link(settings.href, settings.label, settings.icon)}</div>}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
