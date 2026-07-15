import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvals, vpsActions } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { notePreference } from "./feedback";

// Core approval-decision logic shared by the console action and the Telegram
// command channel (one-tap approve/reject). The actual *execution* of
// the approved action is still owner-gated and handled by each module; this
// records the human decision, audits it, and fans out a confirmation.
export type DecisionResult = { ok: boolean; message: string; title?: string };

export async function applyApprovalDecision(input: {
  id: string;
  approve: boolean;
  actorId?: string | null;
  actorName: string;
  via: "console" | "telegram";
}): Promise<DecisionResult> {
  const [a] = await db.select().from(approvals).where(eq(approvals.id, input.id)).limit(1);
  if (!a) return { ok: false, message: "That approval no longer exists." };
  if (a.status !== "pending") return { ok: false, message: `Already ${a.status}.`, title: a.title };

  await db
    .update(approvals)
    .set({ status: input.approve ? "approved" : "rejected", decidedBy: input.actorName, decidedAt: new Date() })
    .where(eq(approvals.id, input.id));

  await audit({
    actorId: input.actorId ?? null,
    actorName: input.actorName,
    action: input.approve ? "approval.approve" : "approval.reject",
    target: input.id,
    detail: { kind: a.kind, via: input.via },
  });

  // Close the loop on approved server ops: enqueue them for the host
  // VPS runner to execute. Only the runner's whitelist actually runs.
  if (input.approve && a.kind.startsWith("vps.")) {
    const p = (a.payload as { action?: string; service?: string; reason?: string }) ?? {};
    if (p.action) {
      await db.insert(vpsActions).values({ action: p.action, args: p.service ? { service: p.service } : {}, reason: p.reason ?? `approved by ${input.actorName}`, requestedBy: input.actorName });
    }
  } else if (input.approve && a.kind !== "info") {
    // Close the loop on every OTHER approved action: re-invoke Tess to actually
    // carry out what was approved (vps ops are handled above by the host runner).
    // Without this, an approved action just sat — "approve but nothing happens".
    // Fire-and-forget (dynamic import avoids a module cycle); the approve click
    // returns immediately and she has the same tools she queued it with.
    void (async () => {
      try {
        const { runTess } = await import("./run");
        await runTess({
          text: `The admin APPROVED this action you queued: "${a.title}". ${a.summary ? `Details: ${a.summary}. ` : ""}Carry it out now with your tools. If it is already done or no longer applies, say so briefly and do NOT queue another approval for it.`,
          channel: "autonomous",
          author: "approval",
        });
      } catch {
        /* best-effort — the decision is already recorded and audited */
      }
    })();
  }

  await notify({
    severity: "info",
    title: `${input.approve ? "✅ Approved" : "🚫 Rejected"}: ${a.title}`,
    body: `${input.approve ? "Approved" : "Rejected"} by ${input.actorName} via ${input.via}.`,
    module: a.module,
  });

  // Learn from a rejection (a strong signal): remember it so similar future
  // proposals are weighed more carefully.
  if (!input.approve) {
    await notePreference(`The admin REJECTED a "${a.kind}" proposal titled "${a.title}". Be more cautious with similar proposals and reconsider whether they're actually wanted.`);
  }

  return { ok: true, message: `${input.approve ? "Approved" : "Rejected"}: ${a.title}`, title: a.title };
}
