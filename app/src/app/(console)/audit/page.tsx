import { headers } from "next/headers";
import { queryAudit, auditFacets, type AuditFilters } from "@/lib/audit-query";
import { requireSectionView } from "@/lib/auth";
import { getDesignMode } from "@/lib/design-mode";
import { AuditView } from "./audit-client";
import { AuditFilament } from "./audit-filament";

export const metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

// Scratch actors left over from development. They are never removed from the audit
// rows themselves — only hidden from the Actor filter's roster while Tess's recorder
// is filming (x-tess-capture), so the showcase doesn't put dev noise on screen.
const CAPTURE_HIDDEN_ACTORS = new Set(["carousel-test", "carousel-p2-test", "gsc-test"]);

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSectionView("/audit");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filters: AuditFilters = { actor: str("actor"), module: str("module"), q: str("q"), from: str("from"), to: str("to") };
  const page = Math.max(1, Number(str("page")) || 1);

  const [{ rows, total, pageSize }, rawFacets] = await Promise.all([queryAudit(filters, page), auditFacets()]);

  const capturing = (await headers()).get("x-tess-capture") === "1";
  const facets = capturing
    ? { ...rawFacets, actors: rawFacets.actors.filter((a) => !CAPTURE_HIDDEN_ACTORS.has(a)) }
    : rawFacets;

  if ((await getDesignMode()) === "filament") {
    return <AuditFilament rows={rows} total={total} page={page} pageSize={pageSize} facets={facets} filters={filters} />;
  }

  return (
    <div data-section="audit" className="flex flex-1 flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Who did what, when — every action by every user, human or Tess. Filter, search, expand a row for
          full detail, or export.
        </p>
      </div>
      <AuditView rows={rows} total={total} page={page} pageSize={pageSize} facets={facets} filters={filters} />
    </div>
  );
}
