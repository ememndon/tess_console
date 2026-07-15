"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, type NavItem } from "@/lib/nav";
import { canViewSection } from "@/lib/access";
import { Button } from "@/components/ui/button";
import { useResizable } from "@/lib/use-resizable";

function NavLink({ href, label, icon: Icon, collapsed }: NavItem & { collapsed: boolean }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md py-2 text-sm transition-colors",
        collapsed ? "justify-center px-0" : "px-2.5",
        active
          ? "bg-sidebar-primary font-medium text-sidebar-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground dark:hover:bg-[#c94e00] dark:hover:text-white"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && label}
    </Link>
  );
}

export function Sidebar({ role }: { role: string }) {
  // Collapsible AND drag-resizable like the right-hand Tess panel; both persist.
  const [open, setOpen] = useState(true);
  const { width, dragging, onMouseDown } = useResizable({ storageKey: "tess_sidebar_w", defaultWidth: 224, min: 180, max: 420, side: "left" });
  useEffect(() => {
    setOpen(localStorage.getItem("tess_sidebar") !== "closed");
  }, []);
  function toggle() {
    const next = !open;
    setOpen(next);
    localStorage.setItem("tess_sidebar", next ? "open" : "closed");
  }

  // Only show modules this role may view (read gating); Settings is pinned to
  // the bottom, separated from the feature modules.
  const visible = NAV.filter((i) => canViewSection(role, i.href));
  const items = visible.filter((i) => i.href !== "/settings");
  const settings = visible.find((i) => i.href === "/settings");

  return (
    <nav
      style={open ? { width } : undefined}
      className={cn(
        "relative hidden shrink-0 flex-col gap-0.5 border-r bg-sidebar p-3 md:flex dark:bg-transparent",
        !open && "w-14",
        !dragging && "transition-[width] duration-200"
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        className={cn("mb-1", open && "self-end")}
      >
        {open ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
      </Button>
      {items.map((item) => (
        <NavLink key={item.href} {...item} collapsed={!open} />
      ))}
      {settings && (
        <div className="mt-auto border-t pt-2">
          <NavLink {...settings} collapsed={!open} />
        </div>
      )}
      {open && (
        <div
          onMouseDown={onMouseDown}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize transition-colors hover:bg-primary/30"
        />
      )}
    </nav>
  );
}
