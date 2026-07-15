// Page-level VIEW policy. Pure + dependency-free so it is safe to import from
// both client (nav hiding) and server (the secure page guard in lib/auth.ts).
//
// `SECTION_MIN_ROLE` maps a section's base path to the minimum role required to
// VIEW it. Anything not listed is viewable by everyone, including "user" — the
// read-only "explore the app" tier. Restricted sections are the ones that hold
// customer PII (inbox/outreach), the security log (audit), or privileged
// controls (agent/settings). Editing this one map changes who sees what.
//
// This governs READ access only; write/action authorization lives in the server
// actions themselves (requireOperator / requireAdmin). Keep both in sync.
export const SECTION_MIN_ROLE: Record<string, "admin" | "manager"> = {
  "/inbox": "manager", // customer email bodies (PII)
  "/outreach": "manager", // contact + prospect emails, subscribers (PII)
  "/audit": "manager", // who-did-what security log
  "/agent": "admin", // Tess controls: pause/kill switch, autonomy, Telegram
  "/settings": "admin", // secrets vault, team, site & model config
};

// Higher rank = more access. `tess` is the agent identity (never logs into the
// console UI), parked at admin level so policy checks never accidentally gate it.
const RANK: Record<string, number> = { user: 1, manager: 2, tess: 3, admin: 3 };

/** Can this role VIEW the section? `href` is the section base path, e.g. "/inbox". */
export function canViewSection(role: string | null | undefined, href: string): boolean {
  const need = SECTION_MIN_ROLE[href];
  if (!need) return true; // unlisted → open to everyone
  return (RANK[role ?? ""] ?? 0) >= (RANK[need] ?? 99);
}
