import Link from "next/link";
import { Inbox as InboxIcon, Settings } from "lucide-react";
import { getSiteScope } from "@/lib/site-scope.server";
import { SITE_META, type SiteKey } from "@/lib/site-scope";
import { getInboxMailboxes } from "@/lib/inbox";
import { requireSectionView } from "@/lib/auth";
import { getDesignMode } from "@/lib/design-mode";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { InboxClient } from "./inbox-client";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  await requireSectionView("/inbox");
  const scope = await getSiteScope();
  const design = await getDesignMode();
  const all = await getInboxMailboxes();
  const mailboxes = scope === "all" ? all : all.filter((m) => m.site === scope);
  const scopeName = scope === "all" ? "all sites" : SITE_META[scope as SiteKey].name;

  if (mailboxes.length === 0) {
    return (
      <div data-section="inbox" className="flex flex-1 flex-col">
        <EmptyState
          icon={InboxIcon}
          title={all.length === 0 ? "No mailboxes connected yet" : `No mailboxes for ${scopeName}`}
          description={
            all.length === 0
              ? "Connect a Hostinger mailbox (IMAP + SMTP) in Settings to read support mail here and approve Tess-drafted replies. Hostinger stays the mail server — Tess just reads and drafts."
              : "Switch the site scope, or connect a mailbox for this site in Settings."
          }
        />
        <div className="-mt-6 flex justify-center pb-12">
          <Button render={<Link href="/settings?tab=mailboxes" />} className="gap-1.5">
            <Settings className="size-3.5" /> Connect a mailbox
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div data-section="inbox" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          {mailboxes.length} mailbox{mailboxes.length > 1 ? "es" : ""} · {scopeName}. Tess drafts replies; you approve
          every send.
        </p>
      </div>
      <InboxClient mailboxes={mailboxes} design={design} />
    </div>
  );
}
