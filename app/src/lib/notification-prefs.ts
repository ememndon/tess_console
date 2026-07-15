// In-app notification preferences (client-safe — no server imports). Controls
// WHICH notifications land in the bell + Notifications list, so it isn't a feed
// of every single activity. External delivery (Telegram/email) stays governed by
// notification_routing; this is purely the in-app list.

export type NotifSeverity = "info" | "warning" | "critical";

export type NotificationPrefs = {
  minSeverity: NotifSeverity; // floor: notifications below this are not listed in-app
  modules: Record<string, boolean>; // per-source on/off
};

// The notification sources Tess/the console emit. `key` matches notify()'s module.
export const NOTIF_MODULES: { key: string; label: string; help: string }[] = [
  { key: "health", label: "Site health", help: "Uptime, TLS, VPS, rate pipeline" },
  { key: "agent", label: "Tess (agent)", help: "Agent actions & errors" },
  { key: "inbox", label: "Inbox", help: "New support mail / replies needed" },
  { key: "social", label: "Social", help: "Posting & scheduling" },
  { key: "outreach", label: "Outreach", help: "Outreach CRM activity" },
  { key: "demo", label: "Demo Studio", help: "Video renders" },
  { key: "recommendation", label: "Recommendations", help: "Tess's suggestions" },
  { key: "vps", label: "Server ops", help: "VPS maintenance results" },
  { key: "system", label: "System", help: "General system messages" },
];

const SEV_ORDER: Record<NotifSeverity, number> = { info: 0, warning: 1, critical: 2 };

export const DEFAULT_PREFS: NotificationPrefs = {
  minSeverity: "info",
  modules: Object.fromEntries(NOTIF_MODULES.map((m) => [m.key, true])),
};

// Should a notification of this severity+module be recorded in the in-app list?
export function shouldRecordInApp(severity: NotifSeverity, module: string, prefs: NotificationPrefs): boolean {
  if (SEV_ORDER[severity] < SEV_ORDER[prefs.minSeverity]) return false;
  const enabled = prefs.modules[module];
  return enabled === undefined ? true : enabled; // unknown sources default on
}
