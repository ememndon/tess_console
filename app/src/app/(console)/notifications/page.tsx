import { getNotificationCenter, notificationFacets, type NotifFilters } from "@/lib/notifications";
import { NotificationCenter, type NotifItem } from "./notifications-client";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters: NotifFilters = { severity: str("severity"), module: str("module"), unreadOnly: str("unread") === "1" };

  const [rows, facets] = await Promise.all([getNotificationCenter(filters), notificationFacets()]);
  const items: NotifItem[] = rows.map((r) => ({
    id: r.id,
    severity: r.severity,
    title: r.title,
    body: r.body,
    module: r.module,
    read: !!r.readAt,
    at: r.createdAt.toISOString(),
  }));

  return (
    <div data-section="notifications" className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Every alert across the console. Filter by severity or module, mark read, and clear what you&rsquo;ve
          handled. Configure where each severity is delivered in Settings → Notifications.
        </p>
      </div>
      <NotificationCenter
        items={items}
        facets={facets}
        filters={{ severity: filters.severity, module: filters.module, unreadOnly: filters.unreadOnly }}
      />
    </div>
  );
}
