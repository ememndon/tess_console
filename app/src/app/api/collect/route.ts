import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, embedRegistry, feedback } from "@/lib/db/schema";
import * as ing from "@/lib/analytics-ingest";

// First-party analytics ingestion: CORS-locked to the three site
// domains, bot-filtered, rate-limited, cookieless. Write-only — always returns
// an empty body so the beacon never blocks the page. Bypasses the Caddy dev
// wall (see caddy/Caddyfile) so the public sites can reach it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_TYPES = ["pageview", "event", "error", "not_found"] as const;
type EventType = (typeof EVENT_TYPES)[number];

function cors(origin: string | null): Record<string, string> {
  // No credentials, no readable response — reflecting Origin just stops the
  // browser console from logging a CORS error on the fire-and-forget beacon.
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "cache-control": "no-store",
    vary: "Origin",
  };
}

const done = (status: number, headers: Record<string, string>) => new Response(null, { status, headers });

export async function OPTIONS(req: NextRequest) {
  return done(204, cors(req.headers.get("origin")));
}

export async function POST(req: NextRequest) {
  const h = req.headers;
  const origin = h.get("origin");
  const headers = cors(origin);
  const ua = h.get("user-agent");

  // 1) Bot/crawler/monitor filter.
  if (ing.isBot(ua)) return done(204, headers);

  // 2) Per-IP rate limit (the IP is hashed immediately, never stored).
  const ip = ing.clientIp(h);
  if (ing.rateLimited(ing.hashIp(ip))) return done(429, headers);

  // 3) Body — sent as text/plain to avoid a CORS preflight. Cap the size (hardening): a legitimate event is well under 8KB; reject floods/oversized
  //    payloads up front by content-length and again after reading.
  const MAX_BODY = 8192;
  if (Number(h.get("content-length") ?? 0) > MAX_BODY) return done(413, headers);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return done(413, headers);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return done(204, headers);
    body = parsed as Record<string, unknown>;
  } catch {
    return done(204, headers);
  }

  const site = ing.str(body.site, 40);
  if (!site) return done(204, headers);
  const domain = await ing.siteDomain(site);
  if (!domain) return done(204, headers); // unknown site → drop

  const type = String(body.type ?? "pageview");
  // Prefer a CDN/proxy geo header if one is ever present; otherwise resolve the
  // country from the client IP via the local offline GeoIP DB.
  const country = ing.countryFromHeaders(h) ?? (await ing.countryFromIp(ip));
  const { city, region } = await ing.cityFromIp(ip);

  // ── Embed pings (Calculatry widgets) are cross-domain by design → registry ──
  if (type === "embed") {
    let host = ing.str(body.host, 200);
    if (!host && origin) {
      try {
        host = new URL(origin).hostname.replace(/^www\./, "");
      } catch {
        /* ignore */
      }
    }
    if (!host) return done(204, headers);
    await db
      .insert(embedRegistry)
      .values({ site, host })
      .onConflictDoUpdate({
        target: [embedRegistry.site, embedRegistry.host],
        set: { lastSeenAt: sql`now()`, hits: sql`${embedRegistry.hits} + 1` },
      });
    return done(204, headers);
  }

  // ── Everything else is first-party: enforce the CORS-lock to the site's domain.
  //    Browser requests always carry Origin; reject mismatches. Origin-less posts
  //    (server-side tests) are allowed through, already validated as a known site.
  if (origin && !ing.originMatchesSite(origin, domain)) return done(204, headers);

  // ── Feedback widget → Feedback module ──
  if (type === "feedback") {
    const rating = ing.str(body.rating, 20);
    const message = ing.str(body.message, 2000);
    if (!rating && !message) return done(204, headers);
    await db.insert(feedback).values({ site, path: ing.cleanPath(body.path), rating, message, country });
    return done(204, headers);
  }

  // ── Events: pageview | event | error | not_found ──
  const evType: EventType = (EVENT_TYPES as readonly string[]).includes(type) ? (type as EventType) : "event";
  const { device, browser, os } = ing.parseUa(ua);
  const visitorId = ing.visitorHash(site, ip, ua ?? "");
  const load =
    typeof body.load === "number" && Number.isFinite(body.load)
      ? Math.max(0, Math.min(600_000, Math.round(body.load)))
      : null;

  let props: unknown = null;
  if (body.props && typeof body.props === "object") {
    const s = JSON.stringify(body.props);
    if (s.length <= 4000) props = body.props;
  }

  await db.insert(events).values({
    site,
    type: evType,
    name: evType === "event" ? ing.str(body.name, 80) : null,
    path: ing.cleanPath(body.path),
    referrerHost: ing.referrerHost(ing.str(body.ref, 500), domain),
    utmSource: ing.str(body.utm_source, 100),
    utmMedium: ing.str(body.utm_medium, 100),
    utmCampaign: ing.str(body.utm_campaign, 100),
    country,
    region,
    city,
    device,
    browser,
    os,
    loadMs: evType === "pageview" ? load : null,
    visitorId,
    props,
  });

  return done(204, headers);
}
