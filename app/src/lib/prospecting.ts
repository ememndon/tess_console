import "server-only";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { outreachContacts, outreachProspects } from "./db/schema";
import { getSecretValue } from "./secrets";
import { generateText } from "./llm";
import { SITE_META, type SiteKey } from "./site-scope";

// ─────────────────────────── Prospect discovery ───────────────────────────
// ADMIN-INITIATED only (a button in Outreach → Prospects). Tess never runs this
// on her own. Searches the web (Tavily) for sites that fit a brand's partnership
// profile, extracts a public contact email, dedups against the CRM, and queues
// the candidates for human review. Approving a candidate creates a real contact.

type Icp = { valueProp: string; category: string; queries: string[] };

// Ideal-partner profile per site: what we offer + the searches that surface good
// partners + the default contact category. Edit here to retune targeting.
const ICP: Record<string, Icp> = {
  calculatry: {
    valueProp:
      "Calculatry offers free, embeddable calculator widgets (finance, health, math). Ideal partners run content sites or blogs that would embed a calculator to help their readers.",
    category: "embed_prospect",
    queries: [
      "personal finance blog mortgage calculator",
      "health and fitness blog BMI calculator",
      "best free online calculator resource site",
    ],
  },
  resumehub: {
    valueProp:
      "GlobalResumeHub is a resume builder and career-tools site. Ideal partners are career coaches, job-search blogs, and university or bootcamp career resources.",
    category: "career_blogger",
    queries: [
      "career advice blog resume tips",
      "professional resume writing service blog",
      "job search coaching website resources",
    ],
  },
  checkinvest: {
    valueProp:
      "CheckInvestNg helps Nigerians verify investment platforms and avoid investment scams. Ideal partners are Nigerian personal-finance blogs, fintech communities, and finance journalists.",
    category: "finance_journalist",
    queries: [
      "Nigeria personal finance blog investing tips",
      "Nigerian fintech news and reviews website",
      "investment scam awareness Nigeria blog",
    ],
  },
};

// Hosts that are never prospects (platforms, socials, marketplaces, mega-publishers).
const SKIP_HOSTS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "linkedin.com", "youtube.com", "tiktok.com",
  "reddit.com", "quora.com", "medium.com", "wikipedia.org", "amazon.com", "pinterest.com", "github.com",
  "google.com", "bing.com", "yahoo.com", "apple.com", "play.google.com", "apps.apple.com", "forbes.com",
  "investopedia.com", "nerdwallet.com",
];

const ROLE_PREFIXES = ["partnerships", "partner", "press", "media", "editor", "contact", "hello", "hi", "info", "team", "support", "admin"];
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const JUNK_EMAIL = /(no-?reply|noreply|example\.|sentry|wixpress|\.png|\.jpe?g|\.gif|\.webp|@2x|u002|your-?email|name@)/i;

function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_RE) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()).filter((e) => !JUNK_EMAIL.test(e)))];
}

function pickEmail(emails: string[], domain: string): string | null {
  if (emails.length === 0) return null;
  const own = emails.filter((e) => e.split("@")[1]?.endsWith(domain));
  const pool = own.length ? own : emails;
  for (const p of ROLE_PREFIXES) {
    const m = pool.find((e) => e.startsWith(p + "@"));
    if (m) return m;
  }
  return pool[0];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Best-effort: fetch a candidate's likely contact pages and pull a public email.
// Search results rarely include the email (it's on /contact), so this is what
// actually delivers the "check their contact page and grab the email" step.
const CONTACT_PATHS = ["/contact", "/contact-us", "/about", "/about-us", ""];

async function fetchHtml(url: string, ms = 5000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; TessConsole-Prospect/1.0)", accept: "text/html" },
    });
    if (!r.ok) return null;
    return (await r.text()).slice(0, 400_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function emailsFromHtml(html: string): string[] {
  const mailtos = [...html.matchAll(/mailto:([^"'?>\s]+@[^"'?>\s]+)/gi)].map((m) => m[1]);
  const plain = html.match(EMAIL_RE) ?? [];
  return [...new Set([...mailtos, ...plain].map((e) => e.toLowerCase()).filter((e) => !JUNK_EMAIL.test(e)))];
}

async function fetchEmailForDomain(domain: string): Promise<string | null> {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return null; // public hostname only (no IPs/localhost)
  for (const p of CONTACT_PATHS) {
    const html = await fetchHtml(`https://${domain}${p}`);
    if (!html) continue;
    const found = pickEmail(emailsFromHtml(html), domain);
    if (found) return found;
  }
  return null;
}

type TavilyResult = { title?: string; url: string; content?: string; raw_content?: string | null; score?: number };

async function tavilySearch(apiKey: string, query: string, maxResults = 5): Promise<TavilyResult[]> {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic", include_raw_content: true }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = (await r.json()) as { results?: TavilyResult[] };
  return j.results ?? [];
}

export type ProspectFindResult = { ok: boolean; found: number; scanned: number; message: string };

export async function findProspects(opts: { site: string; focus?: string; createdBy: string }): Promise<ProspectFindResult> {
  const { site } = opts;
  const icp = ICP[site];
  if (!icp) return { ok: false, found: 0, scanned: 0, message: `No prospecting profile for ${site}.` };
  const apiKey = await getSecretValue("tavily_api_key");
  if (!apiKey) return { ok: false, found: 0, scanned: 0, message: "Add your Tavily API key in Settings → Secrets first." };

  const ownDomain = (SITE_META[site as SiteKey]?.domain ?? "").toLowerCase();
  const focus = opts.focus?.trim();
  const queries = focus ? [focus, ...icp.queries.slice(0, 2)] : icp.queries;

  // 1) Search, collecting one result per unique host.
  const byHost = new Map<string, { result: TavilyResult; query: string }>();
  for (const q of queries) {
    let results: TavilyResult[];
    try {
      results = await tavilySearch(apiKey, q, 5);
    } catch (e) {
      return { ok: false, found: 0, scanned: 0, message: e instanceof Error ? e.message : "Search failed." };
    }
    for (const res of results) {
      const host = hostOf(res.url);
      if (!host || host === ownDomain) continue;
      if (SKIP_HOSTS.some((s) => host === s || host.endsWith("." + s))) continue;
      if (!byHost.has(host)) byHost.set(host, { result: res, query: q });
    }
  }
  const scanned = byHost.size;
  if (scanned === 0) return { ok: true, found: 0, scanned: 0, message: "No candidate sites found. Try a different focus." };

  // 2) Dedup against existing contacts + already-queued prospects for this site.
  const existingContacts = await db.select({ email: outreachContacts.email }).from(outreachContacts).where(eq(outreachContacts.site, site));
  const taken = new Set<string>();
  for (const c of existingContacts) {
    const d = c.email.split("@")[1]?.toLowerCase();
    if (d) taken.add(d);
  }
  const existingProspects = await db.select({ domain: outreachProspects.domain }).from(outreachProspects).where(eq(outreachProspects.site, site));
  for (const p of existingProspects) taken.add(p.domain.toLowerCase());

  const candidates = [...byHost.keys()]
    .filter((h) => !taken.has(h))
    .map((h) => {
      const { result, query } = byHost.get(h)!;
      const email = pickEmail(extractEmails(`${result.raw_content ?? ""} ${result.content ?? ""}`), h);
      return { domain: h, name: (result.title ?? h).slice(0, 120), url: result.url, email, query, score: Math.round((result.score ?? 0) * 100) };
    });
  if (candidates.length === 0) return { ok: true, found: 0, scanned, message: `Scanned ${scanned} sites — all already in your CRM.` };

  // 3) Optional LLM fit pass — qualifies each candidate + writes a short reason.
  //    Graceful fallback to a heuristic reason if no LLM key / parse fails.
  const fit = new Map<string, { keep: boolean; reason: string; category: string }>();
  try {
    const list = candidates.map((c, i) => `${i + 1}. ${c.name} (${c.domain}) — ${c.url}`).join("\n");
    const out = await generateText({
      system: `You qualify partnership prospects. ${icp.valueProp} For each candidate, decide if it's a plausible PARTNER (not a competitor, marketplace, or unrelated site). Return ONLY a JSON array like [{"n":1,"keep":true,"reason":"<=12 words why it fits","category":"${icp.category}"}].`,
      user: `Candidates:\n${list}`,
      maxTokens: 700,
      temperature: 0.2,
    });
    const arr = JSON.parse(out.slice(out.indexOf("["), out.lastIndexOf("]") + 1)) as { n: number; keep?: boolean; reason?: string; category?: string }[];
    for (const row of arr) {
      const c = candidates[row.n - 1];
      if (c) fit.set(c.domain, { keep: row.keep !== false, reason: (row.reason ?? "").slice(0, 200), category: row.category || icp.category });
    }
  } catch {
    /* heuristic fallback below */
  }

  // 3b) Keep the qualified candidates, then fill any missing emails from their
  //     contact/about pages (capped + parallel so the button stays responsive).
  const survivors = candidates.filter((c) => {
    const f = fit.get(c.domain);
    return !(f && f.keep === false);
  });
  const needEmail = survivors.filter((c) => !c.email).slice(0, 8);
  await Promise.all(needEmail.map(async (c) => { c.email = await fetchEmailForDomain(c.domain); }));

  // 4) Insert survivors (unique site+domain index dedups any race).
  let found = 0;
  for (const c of survivors) {
    const f = fit.get(c.domain);
    const r = await db
      .insert(outreachProspects)
      .values({
        site,
        name: c.name,
        domain: c.domain,
        url: c.url,
        email: c.email,
        category: f?.category || icp.category,
        fitReason: f?.reason || `Surfaced by "${c.query}".`,
        score: c.score,
        query: c.query,
        createdBy: opts.createdBy,
      })
      .onConflictDoNothing({ target: [outreachProspects.site, outreachProspects.domain] })
      .returning({ id: outreachProspects.id });
    if (r.length) found++;
  }

  return {
    ok: true,
    found,
    scanned,
    message: found ? `Found ${found} new prospect${found === 1 ? "" : "s"} (scanned ${scanned}).` : `Scanned ${scanned} sites — nothing new to add.`,
  };
}
