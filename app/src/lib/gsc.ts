import "server-only";
import crypto from "crypto";

// Google Search Console client via a service-account key. The owner
// pastes the service-account JSON into the vault and adds its client_email as a
// user on each GSC property. Auth is a self-signed JWT → OAuth token exchange
// (no redirect flow, no token expiry to manage). Read-only scope.

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type ServiceAccount = { client_email: string; private_key: string };

function parseKey(json: string): ServiceAccount {
  const sa = JSON.parse(json) as Partial<ServiceAccount> & { type?: string };
  if (!sa.client_email || !sa.private_key)
    throw new Error("Not a service-account key (missing client_email/private_key).");
  return { client_email: sa.client_email, private_key: sa.private_key };
}

function signJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  ).toString("base64url");
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign(sa.private_key).toString("base64url");
  return `${header}.${claims}.${sig}`;
}

export async function gscAccessToken(saJson: string): Promise<string> {
  const sa = parseKey(saJson);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signJwt(sa),
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("No access_token in token response.");
  return j.access_token;
}

export type GscSite = { siteUrl: string; permissionLevel: string };

export async function gscListSites(saJson: string): Promise<GscSite[]> {
  const token = await gscAccessToken(saJson);
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`List sites failed (${res.status}).`);
  const j = (await res.json()) as { siteEntry?: GscSite[] };
  return j.siteEntry ?? [];
}

export type SearchRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

/** Search Analytics query — the workhorse for performance + the opportunity finder. */
export async function gscSearchAnalytics(
  saJson: string,
  siteUrl: string,
  body: {
    startDate: string;
    endDate: string;
    dimensions?: ("query" | "page" | "date" | "country" | "device")[];
    rowLimit?: number;
    startRow?: number;
  },
): Promise<SearchRow[]> {
  const token = await gscAccessToken(saJson);
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ rowLimit: 1000, ...body }),
    },
  );
  if (!res.ok) throw new Error(`Search Analytics failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { rows?: SearchRow[] };
  return j.rows ?? [];
}

/** Our domains → the GSC property forms that could represent them. */
export function domainMatchesProperty(domain: string, siteUrl: string): boolean {
  const s = siteUrl.toLowerCase();
  return s === `sc-domain:${domain}` || s.includes(`://${domain}`) || s.includes(`://www.${domain}`);
}
