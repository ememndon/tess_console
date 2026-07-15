import "server-only";
import { promises as dns } from "dns";

// Email-auth pre-flight: verify SPF / DKIM / DMARC / MX before the
// first outreach send. The owner edits DNS in Hostinger; the console only reads
// and reports. No DNS is written here.

export type DnsStatus = "pass" | "warn" | "fail" | "missing";
export type DnsKind = "spf" | "dkim" | "dmarc" | "mx";
export type DnsResult = { kind: DnsKind; status: DnsStatus; record: string | null; detail: string };

// Common DKIM selectors to probe. Hostinger publishes hostingermail-a/-b/-c
// (the -a selector carries the live key; -b/-c are rotation placeholders). Owner
// can extend via settings.email_dns.dkimSelectors.
export const DEFAULT_DKIM_SELECTORS = [
  "hostingermail-a",
  "hostingermail-b",
  "hostingermail-c",
  "default",
  "dkim",
  "mail",
  "google",
  "k1",
  "s1",
  "s2",
  "selector1",
  "selector2",
];

async function txt(name: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(name);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

async function checkSpf(domain: string): Promise<DnsResult> {
  const records = (await txt(domain)).filter((r) => /^v=spf1/i.test(r.trim()));
  if (records.length === 0) {
    return { kind: "spf", status: "missing", record: null, detail: "No SPF (v=spf1) record found." };
  }
  if (records.length > 1) {
    return { kind: "spf", status: "fail", record: records.join(" | "), detail: "Multiple SPF records — only one is allowed; mail servers will reject SPF entirely." };
  }
  const rec = records[0];
  const all = rec.match(/([-~?+])all\b/i)?.[1];
  if (all === "+") return { kind: "spf", status: "warn", record: rec, detail: "SPF ends with +all — allows anyone to send as you. Use ~all or -all." };
  if (!all) return { kind: "spf", status: "warn", record: rec, detail: "SPF has no 'all' mechanism — add ~all or -all to define the policy." };
  return { kind: "spf", status: "pass", record: rec, detail: `SPF present (${all}all).` };
}

async function checkDmarc(domain: string): Promise<DnsResult> {
  const records = (await txt(`_dmarc.${domain}`)).filter((r) => /^v=DMARC1/i.test(r.trim()));
  if (records.length === 0) {
    return { kind: "dmarc", status: "missing", record: null, detail: "No DMARC record at _dmarc — add v=DMARC1; p=none; rua=… to start monitoring." };
  }
  const rec = records[0];
  const policy = rec.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
  if (policy === "quarantine" || policy === "reject") return { kind: "dmarc", status: "pass", record: rec, detail: `DMARC enforced (p=${policy}).` };
  if (policy === "none") return { kind: "dmarc", status: "warn", record: rec, detail: "DMARC present but p=none (monitor-only) — tighten to quarantine/reject once aligned." };
  return { kind: "dmarc", status: "warn", record: rec, detail: "DMARC record present but no clear policy." };
}

// A DKIM record only counts as published if it has a non-empty public key (p=…).
// An empty p= is a revoked/rotation placeholder, so we keep probing for a real one.
function dkimKey(rec: string): string | null {
  const m = rec.match(/(?:^|;)\s*p=([A-Za-z0-9+/=]+)/);
  return m && m[1].length > 0 ? m[1] : null;
}

async function checkDkim(domain: string, selectors: string[]): Promise<DnsResult> {
  let placeholderSel: string | null = null;
  for (const sel of selectors) {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    for (const rec of recs) {
      if (!/v=DKIM1/i.test(rec) && !rec.includes("p=")) continue;
      if (dkimKey(rec)) return { kind: "dkim", status: "pass", record: rec.slice(0, 240), detail: `DKIM key published (selector "${sel}").` };
      placeholderSel = sel; // present but empty
    }
  }
  if (placeholderSel) {
    return { kind: "dkim", status: "warn", record: null, detail: `DKIM record exists (selector "${placeholderSel}") but its key is empty — likely rotated/disabled. Re-enable DKIM signing for this domain.` };
  }
  return { kind: "dkim", status: "missing", record: null, detail: `No DKIM key found for the probed selectors (${selectors.slice(0, 4).join(", ")}…). Set the correct selector in Settings if it differs.` };
}

async function checkMx(domain: string): Promise<DnsResult> {
  try {
    const mx = await dns.resolveMx(domain);
    if (mx.length === 0) return { kind: "mx", status: "fail", record: null, detail: "No MX records — the domain cannot receive mail." };
    const sorted = mx.sort((a, b) => a.priority - b.priority);
    return { kind: "mx", status: "pass", record: sorted.map((m) => `${m.priority} ${m.exchange}`).join(", "), detail: `${mx.length} MX record(s).` };
  } catch {
    return { kind: "mx", status: "fail", record: null, detail: "No MX records — the domain cannot receive mail." };
  }
}

export async function checkDomain(domain: string, dkimSelectors: string[] = DEFAULT_DKIM_SELECTORS): Promise<DnsResult[]> {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return Promise.all([checkSpf(d), checkDkim(d, dkimSelectors), checkDmarc(d), checkMx(d)]);
}
