import "server-only";
import { db } from "@/lib/db";
import { sites, brandProfiles } from "@/lib/db/schema";
import { SITE_KEYS, SITE_META } from "@/lib/site-scope";

// The per-site knowledge Tess carries into every turn — built from the editable
// brand profiles (Settings → Sites), not hard-coded, so the admin can deepen her
// understanding without a redeploy. Falls back to the static one-liners if the DB
// is unreachable so she always has at least the basics.
const FALLBACK: Record<string, string> = {
  calculatry: "Free online calculators.",
  resumehub: "Resume/CV tools, ~195 country pages.",
  checkinvest: "Nigerian investment & FX rate data; always framed 'not financial advice'.",
};

export async function getSiteKnowledgeBlock(): Promise<string> {
  let blocks: string[];
  try {
    const [siteRows, profiles] = await Promise.all([
      db.select().from(sites),
      db.select().from(brandProfiles),
    ]);
    const profByKey = new Map(profiles.map((p) => [p.site, p]));
    // Iterate the DB site rows (not the static keys) so any site the admin adds in
    // Settings automatically enters Tess's knowledge — falling back to the static
    // registry/one-liners only when the DB has no sites.
    const rows = siteRows.length ? siteRows : SITE_KEYS.map((key) => ({ key, name: SITE_META[key].name, domain: SITE_META[key].domain }));
    blocks = rows.map((s) => {
      const p = profByKey.get(s.key);
      const body =
        p?.brief?.trim() ||
        [p?.audience && `Audience: ${p.audience}`, p?.voice && `Voice: ${p.voice}`].filter(Boolean).join("\n") ||
        FALLBACK[s.key] ||
        "_(brief not set — ask the admin what this site is about)_";
      return `### ${s.name} (${s.domain})\n${body}`;
    });
  } catch {
    blocks = SITE_KEYS.map((key) => `### ${SITE_META[key].name} (${SITE_META[key].domain})\n${FALLBACK[key]}`);
  }
  return [
    "WHAT YOU KNOW ABOUT EACH SITE — the admin maintains these briefs in Settings → Sites. Treat them as ground truth for voice, audience and strategy, but always pull live numbers with your tools (never invent metrics). Items marked _(confirm)_ are gaps to ask the admin about rather than guess:",
    ...blocks,
  ].join("\n\n");
}
