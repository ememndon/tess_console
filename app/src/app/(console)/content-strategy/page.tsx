import { requireSectionView } from "@/lib/auth";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_KEYS, SITE_META, type SiteKey } from "@/lib/site-scope";
import { db } from "@/lib/db";
import { brandProfiles } from "@/lib/db/schema";
import { getOutliers } from "@/lib/research/ingest";
import { listContentPlans, getLatestPlanItems, getSiteBacklog, getCarouselPlanSites } from "@/lib/research/grid";
import { getSecretValue } from "@/lib/secrets";
import { ContentStrategyClient, type SiteData } from "./content-strategy-client";

export const metadata = { title: "Content Director" };
export const dynamic = "force-dynamic";

export default async function ContentStrategyPage() {
  await requireSectionView("/content-strategy");
  const scope = await getSiteScope();
  const sites = (scope === "all" ? SITE_KEYS : [scope]) as SiteKey[];

  const profiles = await db.select().from(brandProfiles);
  const nichesBySite = new Map(
    profiles.map((p) => {
      const arr = Array.isArray(p.niches) ? (p.niches as unknown[]).map(String).filter(Boolean) : [];
      return [p.site, arr.length ? arr : p.niche ? [p.niche] : []] as const;
    }),
  );

  const carouselSites = await getCarouselPlanSites();

  const data: SiteData[] = await Promise.all(
    sites.map(async (s) => {
      const niches = nichesBySite.get(s) ?? [];
      const primary = niches[0] ?? "";
      const outliers = primary ? await getOutliers(primary, 30) : [];
      const plans = await listContentPlans(s);
      const latest = await getLatestPlanItems(s);
      // Show the MERGED backlog (every niche's plans for this site), best-first —
      // exactly what Tess's daily pipeline draws from.
      const backlog = await getSiteBacklog(s);
      return {
        site: s,
        name: SITE_META[s].name,
        domain: SITE_META[s].domain,
        niches,
        primary,
        carouselPlan: carouselSites.has(s),
        outliers,
        planRef: latest.planRef,
        planItems: backlog,
        plans: plans.map((p) => ({
          ref: p.ref ?? "",
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          summary: (p.summary as Record<string, unknown>) ?? {},
        })),
      };
    }),
  );

  const [youtubeReady, mcpReady] = await Promise.all([
    getSecretValue("youtube_api_key").then((v) => !!v),
    getSecretValue("mcp_access_token").then((v) => !!v),
  ]);
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "";

  return <ContentStrategyClient sites={data} youtubeReady={youtubeReady} mcpReady={mcpReady} baseUrl={baseUrl} />;
}
