// The site registry. Historically the three founding sites were hard-coded here;
// it is now a MUTABLE registry seeded from the DB `sites` table — on the server by
// the console layout's loader, and on the client by <SiteRegistryHydrator> — so a
// site added in Settings flows through every consumer (switcher, scoping, Tess's
// knowledge, dashboards) without a redeploy. The three founding sites stay as the
// initial value so anything that reads the registry before it's seeded still works.

export type SiteKey = string;
export type SiteScope = "all" | SiteKey;

export type SiteMeta = { name: string; domain: string; dot: string; text: string; chip: string };

// Accent palette new sites pick from. Full class strings (so Tailwind keeps them)
// backed by the --site-* tokens in globals.css.
export type AccentName = "blue" | "purple" | "teal" | "amber" | "rose" | "cyan" | "green" | "orange";
export const ACCENT_NAMES: AccentName[] = ["blue", "purple", "teal", "amber", "rose", "cyan", "green", "orange"];
export const SITE_ACCENTS: Record<AccentName, Pick<SiteMeta, "dot" | "text" | "chip">> = {
  blue: { dot: "bg-site-blue", text: "text-site-blue", chip: "bg-site-blue/15 text-site-blue" },
  purple: { dot: "bg-site-purple", text: "text-site-purple", chip: "bg-site-purple/15 text-site-purple" },
  teal: { dot: "bg-site-teal", text: "text-site-teal", chip: "bg-site-teal/15 text-site-teal" },
  amber: { dot: "bg-site-amber", text: "text-site-amber", chip: "bg-site-amber/15 text-site-amber" },
  rose: { dot: "bg-site-rose", text: "text-site-rose", chip: "bg-site-rose/15 text-site-rose" },
  cyan: { dot: "bg-site-cyan", text: "text-site-cyan", chip: "bg-site-cyan/15 text-site-cyan" },
  green: { dot: "bg-site-green", text: "text-site-green", chip: "bg-site-green/15 text-site-green" },
  orange: { dot: "bg-site-orange", text: "text-site-orange", chip: "bg-site-orange/15 text-site-orange" },
};

// The founding three keep their own dedicated tokens (unchanged visuals).
const FOUNDING: Record<string, SiteMeta> = {
  calculatry: { name: "Calculatry", domain: "calculatry.com", dot: "bg-site-calculatry", text: "text-site-calculatry", chip: "bg-site-calculatry/15 text-site-calculatry" },
  resumehub: { name: "GlobalResumeHub", domain: "globalresumehub.com", dot: "bg-site-resumehub", text: "text-site-resumehub", chip: "bg-site-resumehub/15 text-site-resumehub" },
  checkinvest: { name: "CheckInvestNg", domain: "checkinvestng.com", dot: "bg-site-checkinvest", text: "text-site-checkinvest", chip: "bg-site-checkinvest/15 text-site-checkinvest" },
};
const FOUNDING_KEYS = new Set(Object.keys(FOUNDING));

// Live registry — mutated in place by registerSites() so all importers (which hold
// the same object/array reference) observe new sites.
export const SITE_META: Record<string, SiteMeta> = { ...FOUNDING };
export const SITE_KEYS: SiteKey[] = Object.keys(FOUNDING);

export function metaFor(input: { name: string; domain: string; accent?: string | null }): SiteMeta {
  const palette = SITE_ACCENTS[(input.accent as AccentName)] ?? SITE_ACCENTS.blue;
  return { name: input.name, domain: input.domain, ...palette };
}

// Merge DB sites into the live registry. Founding sites keep their dedicated colors
// (only name/domain refresh); others adopt the palette from their accent. Idempotent.
export function registerSites(list: { key: string; name: string; domain: string; accent?: string | null }[]): void {
  for (const s of list) {
    if (!s.key) continue;
    SITE_META[s.key] = FOUNDING_KEYS.has(s.key)
      ? { ...FOUNDING[s.key], name: s.name || FOUNDING[s.key].name, domain: s.domain || FOUNDING[s.key].domain }
      : metaFor(s);
    if (!SITE_KEYS.includes(s.key)) SITE_KEYS.push(s.key);
  }
}
