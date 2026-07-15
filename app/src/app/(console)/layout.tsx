import { requireUser } from "@/lib/auth";
import { getSiteScope, loadSiteRegistry } from "@/lib/site-scope.server";
import { getNotifications, getUnreadCount } from "@/lib/notifications";
import { availableModelIds } from "@/lib/agent/routing";
import { MODELS } from "@/lib/agent/models";
import { relativeTime } from "@/lib/format";
import { Sidebar } from "@/components/shell/sidebar";
import { FilamentNav } from "@/components/shell/filament-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SiteSwitcher } from "@/components/shell/site-switcher";
import { TessPanel } from "@/components/shell/tess-panel";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserMenu } from "@/components/shell/user-menu";
import { NotificationBell } from "@/components/shell/notification-bell";
import { CommandPalette } from "@/components/shell/command-palette";
import { SiteRegistryHydrator } from "@/components/shell/site-registry-hydrator";
import { BrandMark } from "@/components/brand-mark";
import { DesignToggleButton } from "@/components/shell/design-toggle-button";
import { getDesignMode } from "@/lib/design-mode";
import { getPendingApprovals } from "@/lib/agent/thread";

// Every console page lives in this group: requireUser() is the auth wall
// (first run → /setup, no session → /login), with the console layout around it.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Seed the site registry from the DB before scoping/rendering so added sites
  // appear everywhere; the same list hydrates the client registry below.
  const siteRegistry = await loadSiteRegistry();
  const scope = await getSiteScope();
  const design = await getDesignMode();
  const [notes, unread, availIds] = await Promise.all([getNotifications(), getUnreadCount(), availableModelIds()]);

  // Persistent vitals for the Filament rail — health readable from every page.
  const critical = notes.filter((n) => n.severity === "critical" && !n.readAt).length;
  const warning = notes.filter((n) => n.severity === "warning" && !n.readAt).length;
  const approvals = design === "filament" ? (await getPendingApprovals()).length : 0;
  const vitals = { critical, warning, approvals };

  // Tool-capable models with a key present — what the admin can pick as Tess's
  // brain for a given chat (Gemini excluded: no tool-call support).
  const chatModels = MODELS.filter((m) => m.tools && m.kind !== "gemini" && availIds.has(m.id)).map((m) => ({
    id: m.id,
    label: m.label,
    tier: m.tier,
  }));

  const items = notes.map((n) => ({
    id: n.id,
    severity: n.severity,
    title: n.title,
    body: n.body,
    module: n.module,
    read: !!n.readAt,
    time: relativeTime(n.createdAt),
  }));

  return (
    <div className="flex h-screen flex-col">
      <SiteRegistryHydrator sites={siteRegistry} />
      <header className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b bg-sidebar px-4 dark:bg-transparent">
        <div className="flex items-center gap-2">
          <MobileNav role={user.role} />
          <div className="flex items-center gap-1.5">
            <BrandMark className="h-9 w-auto shrink-0" />
            <span className="text-sm font-semibold tracking-tight">Tess Console</span>
          </div>
          <CommandPalette role={user.role} />
        </div>
        <SiteSwitcher current={scope} />
        <div className="flex items-center justify-end gap-1">
          <DesignToggleButton design={design} />
          <NotificationBell items={items} unread={unread} />
          <ThemeToggle />
          <UserMenu name={user.name} email={user.email} role={user.role} design={design} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {design === "filament" ? <FilamentNav vitals={vitals} role={user.role} /> : <Sidebar role={user.role} />}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-sidebar dark:bg-transparent">{children}</main>
        <TessPanel models={chatModels} />
      </div>
    </div>
  );
}
