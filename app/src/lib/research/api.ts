import "server-only";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { brandProfiles } from "../db/schema";
import { SITE_KEYS, SITE_META, type SiteKey } from "../site-scope";
import { getSecretValue } from "../secrets";
import { refreshNiche, getOutliers } from "./ingest";
import { analyzeNiche } from "./analyze";
import { buildContentCalendar, getContentPlan, listContentPlans } from "./grid";

// Shared surface for the Content Director, used by BOTH the REST API and the MCP
// server so external AIs (Claude or any model/agent) drive the exact same logic
// Tess uses internally. Auth is a single bearer token (mcp_access_token).

/** Constant-time bearer check against the vault's mcp_access_token. Closed by
 * default: if no token is configured, all external access is denied. */
export async function tokenOk(authHeader: string | null | undefined): Promise<boolean> {
  const secret = await getSecretValue("mcp_access_token");
  if (!secret) return false;
  const supplied = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

type Args = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));

async function resolveNiche(args: Args): Promise<string> {
  const explicit = str(args.niche).trim();
  if (explicit) return explicit;
  const site = str(args.site);
  if (site && site !== "all" && (SITE_KEYS as string[]).includes(site)) {
    const [b] = await db.select({ niche: brandProfiles.niche }).from(brandProfiles).where(eq(brandProfiles.site, site)).limit(1);
    if (b?.niche?.trim()) return b.niche.trim();
    return SITE_META[site as SiteKey]?.name ?? "";
  }
  return "";
}

// Tool catalog — shared by MCP tools/list and documents the REST actions. JSON Schema.
export const CONTENT_INTEL_TOOLS = [
  { name: "research_niche", description: "Pull what's winning in a niche from YouTube and score outliers (views vs each channel's baseline) + velocity + engagement into one opportunity score. Pass a site (uses its configured niche) or an explicit niche. Refreshes the research store.", inputSchema: { type: "object", properties: { site: { type: "string" }, niche: { type: "string" }, days: { type: "number" }, shortsOnly: { type: "boolean" } } } },
  { name: "find_viral_outliers", description: "Top viral outlier videos for a site/niche (title, channel, views, outlier multiplier, opportunity score, format), ranked by opportunity. Run research_niche first.", inputSchema: { type: "object", properties: { site: { type: "string" }, niche: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_content_strategy", description: "Ranked subtopics to make next (with the winning pattern, saturation, difficulty, examples), the formats actually winning (with templates + win share), and mined hook formulas. Run research_niche first.", inputSchema: { type: "object", properties: { site: { type: "string" }, niche: { type: "string" } } } },
  { name: "build_content_calendar", description: "Build a rotating 30-day content grid for a site. source 'youtube' (default) anchors briefs to proven YouTube outliers; source 'gsc' builds from the site's OWN Google Search Console demand (real queries + the exact ranking page per brief, no niche needed). Saves a plan + DRAFTS (never auto-posts). Returns a plan ref.", inputSchema: { type: "object", properties: { site: { type: "string" }, niche: { type: "string" }, source: { type: "string", enum: ["youtube", "gsc"] }, days: { type: "number" }, startAt: { type: "string" } }, required: ["site"] } },
  { name: "get_content_plan", description: "Read a saved content plan by ref (e.g. CD123456), or omit ref to list recent plans (optionally for a site).", inputSchema: { type: "object", properties: { ref: { type: "string" }, site: { type: "string" } } } },
] as const;

export const CONTENT_INTEL_TOOL_NAMES = CONTENT_INTEL_TOOLS.map((t) => t.name);

/** Run one Content Director action. Returns a JSON-serializable result; throws on
 * bad input so callers can map to an error response. createdBy tags the source. */
export async function runContentIntel(name: string, args: Args, createdBy = "api"): Promise<unknown> {
  switch (name) {
    case "research_niche": {
      const niche = await resolveNiche(args);
      if (!niche) throw new Error("Provide a niche, or a site that has one configured.");
      const days = [7, 30, 90, 180].includes(Number(args.days)) ? Number(args.days) : 90;
      const site = str(args.site) && str(args.site) !== "all" ? str(args.site) : undefined;
      return refreshNiche(niche, { days, shortsOnly: !!args.shortsOnly, site });
    }
    case "find_viral_outliers": {
      const niche = await resolveNiche(args);
      if (!niche) throw new Error("Provide a niche or a configured site.");
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 25));
      return { niche, outliers: await getOutliers(niche, limit) };
    }
    case "get_content_strategy": {
      const niche = await resolveNiche(args);
      if (!niche) throw new Error("Provide a niche or a configured site.");
      const site = str(args.site) && str(args.site) !== "all" ? str(args.site) : undefined;
      return analyzeNiche(niche, { site });
    }
    case "build_content_calendar": {
      const site = str(args.site);
      if (!(SITE_KEYS as string[]).includes(site)) throw new Error("Provide a valid site.");
      const sv = str(args.source);
      const source = sv === "gsc" ? ("gsc" as const) : sv === "blend" ? ("blend" as const) : ("youtube" as const);
      const days = [7, 14, 30].includes(Number(args.days)) ? Number(args.days) : 30;
      const startAt = args.startAt ? str(args.startAt) : undefined;
      if (source === "gsc") {
        // Search-Console demand needs no niche — it reads the site's own queries.
        return buildContentCalendar({ site, days, source, startAt, createdBy });
      }
      // blend uses the niche for its YouTube lane but degrades to Search-only without one.
      const niche = await resolveNiche({ site, niche: args.niche });
      if (!niche && source === "youtube") throw new Error("No niche configured for this site; pass a niche.");
      return buildContentCalendar({ site, niche: niche || undefined, days, source, startAt, createdBy });
    }
    case "get_content_plan": {
      if (args.ref) return (await getContentPlan(str(args.ref))) ?? { error: "plan not found" };
      const site = str(args.site) && str(args.site) !== "all" ? str(args.site) : undefined;
      return listContentPlans(site);
    }
    default:
      throw new Error(`Unknown action: ${name}`);
  }
}
