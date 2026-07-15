import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { emailMessages, mailboxFolders, mailboxes } from "./db/schema";

// Single source of truth for "this email needs a reply": an inbound, actionable,
// still-unanswered message sitting in a real folder — NOT one the user has
// triaged into Junk or Trash. Shared by the inbox mailbox badge, the Site
// Overview cards, Tess's daily report and the agent tick so the count is
// identical everywhere (a message moved to spam/trash stops counting).
export const needsReplyWhere: SQL = and(
  eq(emailMessages.direction, "inbound"),
  eq(emailMessages.actionable, true),
  eq(emailMessages.answered, false),
  // Respect a per-mailbox mute: if the admin turned auto-reply OFF for a mailbox,
  // its messages stop counting as "needs a reply" everywhere (badges, reports, and
  // the autopilot's drafting scan) — this is what makes "stop replying to this
  // mailbox" actually take effect instead of just being acknowledged in chat.
  sql`EXISTS (
    SELECT 1 FROM ${mailboxes} mb
    WHERE mb.id = ${emailMessages.mailboxId} AND mb.auto_reply = true
  )`,
  sql`NOT EXISTS (
    SELECT 1 FROM ${mailboxFolders} f
    WHERE f.mailbox_id = ${emailMessages.mailboxId}
      AND f.path = ${emailMessages.folder}
      AND f.role IN ('junk', 'trash')
  )`,
)!;
