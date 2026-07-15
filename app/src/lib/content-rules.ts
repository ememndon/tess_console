import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { settings } from "./db/schema";

// Per-site STANDING content rules the owner sets ("never post about X", "always
// emphasize Y"). Unlike a chat acknowledgement or a remembered note, these are
// read by the deterministic daily generator (see contentRulesBlock injected into
// daily-plan guidance) so the instruction actually binds the automated posts.
const KEY = "content_rules";
export type SiteContentRules = { avoidTopics: string[]; guidance: string };
type Store = Record<string, SiteContentRules>;

async function readStore(): Promise<Store> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY));
  return (row?.value as Store) ?? {};
}

export async function getContentRules(site: string): Promise<SiteContentRules> {
  const r = (await readStore())[site];
  return {
    avoidTopics: Array.isArray(r?.avoidTopics) ? r!.avoidTopics.map(String) : [],
    guidance: typeof r?.guidance === "string" ? r.guidance : "",
  };
}

export async function setContentRules(
  site: string,
  patch: { avoidTopics?: string[]; addAvoid?: string[]; clearAvoid?: boolean; guidance?: string },
): Promise<SiteContentRules> {
  const store = await readStore();
  const cur = store[site] ?? { avoidTopics: [], guidance: "" };
  let avoid = Array.isArray(cur.avoidTopics) ? [...cur.avoidTopics] : [];
  if (patch.clearAvoid) avoid = [];
  if (patch.avoidTopics) avoid = patch.avoidTopics.map((t) => t.trim()).filter(Boolean);
  if (patch.addAvoid) for (const t of patch.addAvoid) {
    const v = t.trim();
    if (v && !avoid.some((x) => x.toLowerCase() === v.toLowerCase())) avoid.push(v);
  }
  const next: SiteContentRules = { avoidTopics: avoid, guidance: patch.guidance !== undefined ? patch.guidance : cur.guidance ?? "" };
  store[site] = next;
  await db.insert(settings).values({ key: KEY, value: store }).onConflictDoUpdate({ target: settings.key, set: { value: store, updatedAt: new Date() } });
  return next;
}

// A guidance fragment appended to the generator prompt so standing rules bind output.
export async function contentRulesBlock(site: string): Promise<string> {
  const r = await getContentRules(site);
  const parts: string[] = [];
  if (r.avoidTopics.length) parts.push(`Do NOT post about, mention or reference: ${r.avoidTopics.join("; ")}.`);
  if (r.guidance.trim()) parts.push(r.guidance.trim());
  return parts.length ? ` Owner's standing rules (must follow): ${parts.join(" ")}` : "";
}
