import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { dnsChecks, settings } from "./db/schema";
import { SITE_KEYS, SITE_META } from "./site-scope";
import { checkDomain, DEFAULT_DKIM_SELECTORS } from "./dns-auth";

// SPF/DKIM/DMARC/MX verification report. Runs the checks for each
// site's mail domain and upserts the latest snapshot per (domain, kind). Owner
// configures DKIM selectors in settings.email_dns if the defaults don't match.

export async function runDnsChecks(): Promise<{ ok: boolean; checked: number }> {
  const started = Date.now();
  const [cfgRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "email_dns"));
  const cfg = (cfgRow?.value as { dkimSelectors?: string[] }) ?? {};
  const selectors = cfg.dkimSelectors?.length ? cfg.dkimSelectors : DEFAULT_DKIM_SELECTORS;

  let checked = 0;
  for (const site of SITE_KEYS) {
    const domain = SITE_META[site].domain;
    const results = await checkDomain(domain, selectors);
    for (const r of results) {
      await db
        .insert(dnsChecks)
        .values({ site, domain, kind: r.kind, status: r.status, record: r.record, detail: r.detail })
        .onConflictDoUpdate({
          target: [dnsChecks.domain, dnsChecks.kind],
          set: { site, status: r.status, record: r.record, detail: r.detail, checkedAt: new Date() },
        });
      checked++;
    }
  }

  const durMs = Date.now() - started;
  const summary = `${SITE_KEYS.length} domains, ${checked} records`;
  await db.execute(sql`
    INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
    VALUES ('dns-check', now() - (${durMs} * interval '1 millisecond'), now(), 'ok', ${summary})
  `);
  await db.execute(sql`
    UPDATE jobs SET last_run_at = now(), last_status = 'ok', last_duration_ms = ${durMs}, last_output = ${summary}
    WHERE name = 'dns-check'
  `);
  return { ok: true, checked };
}

export async function latestDnsChecks() {
  return db.select().from(dnsChecks);
}

// Used by the retention job: purge cached email past the window.
export async function purgeOldEmail(): Promise<{ ok: boolean; deleted: number }> {
  const started = Date.now();
  const [cfgRow] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "email_retention"));
  const cfg = (cfgRow?.value as { supportDays?: number; autoPurge?: boolean }) ?? {};
  if (cfg.autoPurge === false) {
    await db.execute(sql`UPDATE jobs SET last_run_at = now(), last_status = 'ok', last_output = 'auto-purge disabled' WHERE name = 'email-retention'`);
    return { ok: true, deleted: 0 };
  }
  const days = Math.max(7, cfg.supportDays ?? 365);
  const res = await db.execute(sql`
    DELETE FROM email_messages
    WHERE coalesce(internal_date, created_at) < now() - (${days} * interval '1 day')
  `);
  const deleted = (res as unknown as { count?: number }).count ?? 0;
  const durMs = Date.now() - started;
  const summary = `purged ${deleted} message(s) older than ${days}d`;
  await db.execute(sql`
    INSERT INTO job_runs (job_name, started_at, finished_at, status, output)
    VALUES ('email-retention', now() - (${durMs} * interval '1 millisecond'), now(), 'ok', ${summary})
  `);
  await db.execute(sql`
    UPDATE jobs SET last_run_at = now(), last_status = 'ok', last_duration_ms = ${durMs}, last_output = ${summary}
    WHERE name = 'email-retention'
  `);
  return { ok: true, deleted };
}
