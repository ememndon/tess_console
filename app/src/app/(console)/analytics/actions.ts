"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sites } from "@/lib/db/schema";
import { requireOperator, getCurrentUser } from "@/lib/auth";
import { getVisitorJourney, type JourneyEvent } from "@/lib/analytics";
import { SITE_KEYS, type SiteScope } from "@/lib/site-scope";

// Install verifier: confirms a site has the tracking snippet live AND that the
// console is receiving its data. Two independent signals:
//   1) Fetch the site homepage and look for the t.js tracker with the right
//      data-site (proves the code is installed and reachable).
//   2) Read the most recent event row for that site (proves data is flowing in).
// Domains come from the trusted site registry (admin-managed), never user input.

export type VerifyResult = {
  ok: boolean; // snippet installed correctly AND site reachable
  domain: string;
  httpStatus: number | null;
  tjsPresent: boolean; // a /t.js tracker tag was found
  dataSiteMatch: boolean; // ...with data-site matching this site key
  lastEventAt: string | null; // ISO timestamp of the latest event for this site
  message: string;
  error?: string;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function verifyInstall(siteKey: string): Promise<VerifyResult> {
  const user = await requireOperator();
  if (!user) return blank("", "Not authorized.");

  const [row] = await db.select({ domain: sites.domain }).from(sites).where(sql`${sites.key} = ${siteKey}`);
  const domain = row?.domain?.trim();
  if (!domain) return blank("", `Unknown site "${siteKey}".`);

  // Latest event received for this site (any type) — proves ingestion is live.
  let lastEventAt: string | null = null;
  try {
    const [r] = (await db.execute(
      sql`SELECT max(created_at) AS last FROM events WHERE site = ${siteKey}`,
    )) as unknown as { last: string | null }[];
    lastEventAt = r?.last ? new Date(r.last).toISOString() : null;
  } catch {
    /* non-fatal — the install check still runs */
  }

  // Fetch the homepage and scan the served HTML for the tracker.
  let httpStatus: number | null = null;
  let tjsPresent = false;
  let dataSiteMatch = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    let html = "";
    try {
      const res = await fetch(`https://${domain}/`, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          // Look like a normal browser so we get the real SSR'd HTML, not a bot page.
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml",
        },
      });
      httpStatus = res.status;
      html = (await res.text()).slice(0, 600_000);
    } finally {
      clearTimeout(timer);
    }

    tjsPresent = /src=["'][^"']*\/t\.js(\?[^"']*)?["']/i.test(html);
    dataSiteMatch = new RegExp(`data-site=["']${escapeRe(siteKey)}["']`, "i").test(html);
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      ok: false,
      domain,
      httpStatus,
      tjsPresent: false,
      dataSiteMatch: false,
      lastEventAt,
      message: aborted
        ? `Timed out fetching ${domain} (no response in 9s).`
        : `Couldn't reach ${domain}. Check the site is live and public.`,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  const snippetFound = tjsPresent && dataSiteMatch;
  const reachable = httpStatus != null && httpStatus < 400;

  let message: string;
  if (!reachable) message = `${domain} returned HTTP ${httpStatus}. The tracker can't load until the page does.`;
  else if (snippetFound)
    message = lastEventAt
      ? `Installed correctly and receiving data.`
      : `Snippet is installed. No data received yet — load the site once and recheck.`;
  else if (tjsPresent && !dataSiteMatch)
    message = `Found a t.js tracker, but its data-site doesn't match "${siteKey}". Fix the data-site value.`;
  else message = `No Tess tracker found on ${domain}. Add the install snippet to the site's <head>.`;

  return { ok: snippetFound && reachable, domain, httpStatus, tjsPresent, dataSiteMatch, lastEventAt, message };
}

function blank(domain: string, message: string): VerifyResult {
  return { ok: false, domain, httpStatus: null, tjsPresent: false, dataSiteMatch: false, lastEventAt: null, message };
}

// Lazy-load one visitor's full timeline when their row is expanded in the explorer.
export async function loadVisitorJourney(scope: string, visitorId: string, day: string): Promise<JourneyEvent[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!visitorId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  const s: SiteScope = scope === "all" || (SITE_KEYS as string[]).includes(scope) ? (scope as SiteScope) : "all";
  return getVisitorJourney(s, visitorId, day);
}
