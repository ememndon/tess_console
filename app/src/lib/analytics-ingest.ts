import "server-only";
import crypto from "crypto";
import path from "path";
import maxmind, { type Reader, type CountryResponse, type CityResponse } from "maxmind";
import { db } from "./db";
import { sites } from "./db/schema";

// ──────────────────────── Ingestion helpers ────────────────────────
// Pure, dependency-free parsing + cookieless identity + abuse controls for the
// public /api/collect endpoint. The raw IP is never stored — it only feeds the
// daily-rotating visitor hash and (via proxy header) the country.

const SALT = process.env.SESSION_SECRET ?? "tess-analytics-dev-salt";

// Bot/crawler/monitor user agents — dropped so junk never pollutes the data.
const BOT_RE =
  /bot|crawl|spider|slurp|mediapartners|bingpreview|facebookexternalhit|embedly|quora link|pinterest|headless|phantomjs|puppeteer|playwright|lighthouse|gtmetrix|pingdom|uptimerobot|statuscake|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\/|okhttp|libwww|apache-httpclient|scrapy|semrush|ahrefs|mj12bot|dotbot|petalbot|dataforseo|preview/i;

export function isBot(ua: string | null): boolean {
  if (!ua || ua.length < 12) return true; // real browsers always send a UA
  return BOT_RE.test(ua);
}

export function parseUa(ua: string | null): { device: string; browser: string; os: string } {
  const u = ua ?? "";
  const isTablet = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(u);
  const isMobile = /mobile|iphone|ipod|android|blackberry|iemobile|opera mini/i.test(u);
  const device = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "Other";
  if (/edg(a|ios|e)?\//i.test(u)) browser = "Edge";
  else if (/opr\/|opera/i.test(u)) browser = "Opera";
  else if (/samsungbrowser/i.test(u)) browser = "Samsung Internet";
  else if (/firefox|fxios/i.test(u)) browser = "Firefox";
  else if (/chrome|crios|chromium/i.test(u)) browser = "Chrome";
  else if (/safari/i.test(u)) browser = "Safari";

  let os = "Other";
  if (/windows nt/i.test(u)) os = "Windows";
  else if (/iphone|ipad|ipod|ios/i.test(u)) os = "iOS";
  else if (/mac os x|macintosh/i.test(u)) os = "macOS";
  else if (/android/i.test(u)) os = "Android";
  else if (/cros/i.test(u)) os = "ChromeOS";
  else if (/linux/i.test(u)) os = "Linux";

  return { device, browser, os };
}

/**
 * Source attribution for the Sources report:
 *  - No referrer (typed URL, bookmark, native app, stripped header) → "$direct"
 *    sentinel, surfaced as "Direct" in the dashboard.
 *  - Same registered domain (internal page-to-page navigation) → null, excluded
 *    from Sources (it's not a traffic source).
 *  - Any other host → the external referrer host (e.g. "google.com").
 */
export function referrerHost(ref: string | null, siteDomain: string | null): string | null {
  if (!ref) return "$direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (siteDomain && (host === siteDomain || host.endsWith("." + siteDomain))) return null;
    return host || "$direct";
  } catch {
    return "$direct";
  }
}

/** Cookieless daily-rotating visitor id: stable per (site, ip, ua) for one UTC day. */
export function visitorHash(site: string, ip: string, ua: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(`${SALT}|${site}|${day}|${ip}|${ua}`).digest("hex").slice(0, 20);
}

/** 2-letter ISO country from a proxy/CDN header (Caddy maxmind, Cloudflare, etc.); null if absent. */
export function countryFromHeaders(h: Headers): string | null {
  const c =
    h.get("x-tess-country") ?? h.get("cf-ipcountry") ?? h.get("x-vercel-ip-country") ?? h.get("x-country-code");
  if (!c) return null;
  const up = c.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(up) && up !== "XX" ? up : null;
}

export function clientIp(h: Headers): string {
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "0.0.0.0"
  );
}

// ── IP → country (offline GeoIP) ───────────────────────────────────────────────
// A local DB-IP "IP to Country Lite" database (CC-BY, ~8 MB, no API key, no
// per-request network call) read by the maxmind library. Opened once and cached.
// The raw IP is only used for this lookup and the visitor hash — never stored.
// We still prefer a proxy/CDN geo header when one exists (see the collect route).
let geoReader: Promise<Reader<CountryResponse> | null> | null = null;
function geo(): Promise<Reader<CountryResponse> | null> {
  if (!geoReader) {
    const file = path.join(process.cwd(), "data", "dbip-country-lite.mmdb");
    geoReader = maxmind.open<CountryResponse>(file).catch(() => null);
  }
  return geoReader;
}

/** 2-letter ISO country resolved from a client IP via the local GeoIP DB; null if unknown. */
export async function countryFromIp(ip: string | null): Promise<string | null> {
  if (!ip || ip === "0.0.0.0" || ip === "::1" || ip === "127.0.0.1") return null;
  try {
    const reader = await geo();
    const code = reader?.get(ip)?.country?.iso_code;
    if (!code) return null;
    const up = code.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(up) && up !== "XX" ? up : null;
  } catch {
    return null;
  }
}

// ── IP → city/region (optional offline GeoIP) ─────────────────────────────────
// A local DB-IP "IP to City Lite" database (data/dbip-city-lite.mmdb), IF present.
// Best-effort: if the file isn't installed the reader stays null and we return
// nulls (country still resolves via the country DB / proxy header). Raw IP is
// only read here, never stored.
let cityReader: Promise<Reader<CityResponse> | null> | null = null;
function geoCity(): Promise<Reader<CityResponse> | null> {
  if (!cityReader) {
    const file = path.join(process.cwd(), "data", "dbip-city-lite.mmdb");
    cityReader = maxmind.open<CityResponse>(file).catch(() => null);
  }
  return cityReader;
}

/** City + region resolved from a client IP via the local city GeoIP DB; nulls if unknown or the DB isn't installed. */
export async function cityFromIp(ip: string | null): Promise<{ city: string | null; region: string | null }> {
  const none = { city: null, region: null };
  if (!ip || ip === "0.0.0.0" || ip === "::1" || ip === "127.0.0.1") return none;
  try {
    const reader = await geoCity();
    if (!reader) return none;
    const r = reader.get(ip);
    return { city: r?.city?.names?.en || null, region: r?.subdivisions?.[0]?.names?.en || null };
  } catch {
    return none;
  }
}

// ── Site registry (cached) — the CORS allowlist + site→domain map ──────────────
type SiteReg = { key: string; domain: string };
let regCache: { at: number; rows: SiteReg[] } | null = null;

export async function siteRegistry(): Promise<SiteReg[]> {
  if (regCache && Date.now() - regCache.at < 60_000) return regCache.rows;
  const rows = await db.select({ key: sites.key, domain: sites.domain }).from(sites);
  regCache = { at: Date.now(), rows };
  return rows;
}

export async function siteDomain(siteKey: string): Promise<string | null> {
  const reg = await siteRegistry();
  return reg.find((r) => r.key === siteKey)?.domain ?? null;
}

/** True when the browser Origin's host matches the claimed site's registered domain. */
export function originMatchesSite(origin: string | null, domain: string | null): boolean {
  if (!origin || !domain) return false;
  try {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    return host === domain || host.endsWith("." + domain);
  } catch {
    return false;
  }
}

// ── Best-effort per-IP rate limiter (single instance; fixed 60s window) ────────
const RL_MAX = 240; // events / minute / ip — generous; blocks only floods
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(ipHash: string): boolean {
  const now = Date.now();
  const b = buckets.get(ipHash);
  if (!b || now > b.resetAt) {
    buckets.set(ipHash, { count: 1, resetAt: now + 60_000 });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    return false;
  }
  b.count += 1;
  return b.count > RL_MAX;
}

export const hashIp = (ip: string) => crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);

export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string") return null;
  return p.slice(0, 300) || "/";
}

export function str(v: unknown, max = 200): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}
