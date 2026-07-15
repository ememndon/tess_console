import "server-only";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "./db";
import { socialPosts, socialTargets, socialMedia, socialAccounts, platformThrottle, notifications } from "./db/schema";
import { decryptSecret } from "./vault";
import { getSecretValue } from "./secrets";
import { writeHandoff } from "./handoff";
import * as X from "./x";
import * as TG from "./telegram";

// Deterministic publisher: publishes due posts to autonomous
// channels (X, Telegram) and writes handoff files for manual channels. Plain
// code — runs even when Tess's LLM is paused. Self-throttles: two consecutive
// failures on a (site, platform) pause it and alert, instead of retrying forever.

type Post = typeof socialPosts.$inferSelect;
type Target = typeof socialTargets.$inferSelect;
type Media = typeof socialMedia.$inferSelect;

async function notify(severity: "info" | "warning" | "critical", title: string, body: string) {
  await db.insert(notifications).values({ severity, title, body, module: "social" });
}

async function bumpThrottle(site: string, platform: Target["platform"], success: boolean): Promise<boolean> {
  if (success) {
    await db
      .insert(platformThrottle)
      .values({ site, platform, consecutiveFails: 0, paused: false })
      .onConflictDoUpdate({
        target: [platformThrottle.site, platformThrottle.platform],
        set: { consecutiveFails: 0, paused: false, pausedReason: null, updatedAt: new Date() },
      });
    return false;
  }
  const [row] = await db
    .insert(platformThrottle)
    .values({ site, platform, consecutiveFails: 1 })
    .onConflictDoUpdate({
      target: [platformThrottle.site, platformThrottle.platform],
      set: { consecutiveFails: sql`${platformThrottle.consecutiveFails} + 1`, updatedAt: new Date() },
    })
    .returning();
  if ((row?.consecutiveFails ?? 1) >= 2 && !row?.paused) {
    await db
      .update(platformThrottle)
      .set({ paused: true, pausedReason: "two consecutive failures" })
      .where(and(eq(platformThrottle.site, site), eq(platformThrottle.platform, platform)));
    return true;
  }
  return false;
}

async function publishOne(post: Post, t: Target, media: Media[]): Promise<{ id: string; url: string }> {
  const [acct] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.site, post.site), eq(socialAccounts.platform, t.platform)));
  const img = media.find((m) => m.type === "image");
  const caption = post.caption ?? "";

  if (t.platform === "x") {
    if (!acct?.connected || !acct.credentialsEnc) throw new Error("X account not connected");
    const creds = JSON.parse(decryptSecret(acct.credentialsEnc)) as X.XCreds;
    let mediaIds: string[] | undefined;
    if (img) {
      try {
        mediaIds = [await X.xUploadMedia(creds, img.path)];
      } catch {
        // Free tier may block media upload — fall back to a text-only post.
        mediaIds = undefined;
      }
    }
    return X.xPostTweet(creds, caption.slice(0, 280), mediaIds);
  }

  if (t.platform === "telegram") {
    const token = await getSecretValue("telegram_bot_token");
    if (!token) throw new Error("Telegram bot token not set");
    const chatId = (acct?.meta as { chatId?: string } | null)?.chatId ?? acct?.handle ?? null;
    if (!chatId) throw new Error("no Telegram channel configured for this brand");
    const res = img ? await TG.tgSendPhoto(token, chatId, img.path, caption) : await TG.tgSendMessage(token, chatId, caption);
    return { id: String(res.id), url: "" };
  }

  throw new Error(`no autonomous publisher for ${t.platform}`);
}

export async function publishDuePosts(): Promise<{ published: number; handoff: number; failed: number; skipped: number }> {
  let published = 0,
    handoff = 0,
    failed = 0,
    skipped = 0;

  const due = await db
    .select()
    .from(socialPosts)
    .where(
      and(
        inArray(socialPosts.status, ["ready", "scheduled"]),
        or(isNull(socialPosts.scheduledAt), lte(socialPosts.scheduledAt, new Date())),
      ),
    )
    .limit(50);

  for (const post of due) {
    // Pre-publish guard: a post that failed the quality check (empty caption, no
    // image, …) is held back — kicked to draft so it leaves the queue — rather
    // than published broken. Soft flags don't set ok=false and pass through.
    const review = (post.data && typeof post.data === "object" ? (post.data as { review?: { ok?: boolean; flags?: string[] } }).review : undefined);
    if (review && review.ok === false) {
      await db.update(socialPosts).set({ status: "draft" }).where(eq(socialPosts.id, post.id));
      await notify("warning", `🟡 Held a flagged post for ${post.site}`, `A scheduled post was held back from publishing and returned to drafts because it failed the pre-publish quality check (${(review.flags ?? []).join("; ") || "needs review"}). Review or fix it in Social Studio.`);
      skipped++;
      continue;
    }

    const targets = await db
      .select()
      .from(socialTargets)
      .where(and(eq(socialTargets.postId, post.id), eq(socialTargets.status, "queued")));
    const media = await db.select().from(socialMedia).where(eq(socialMedia.postId, post.id));

    for (const t of targets) {
      const [thr] = await db
        .select()
        .from(platformThrottle)
        .where(and(eq(platformThrottle.site, post.site), eq(platformThrottle.platform, t.platform)));
      if (thr?.paused) {
        skipped++;
        continue;
      }

      if (t.mode === "handoff") {
        await writeHandoff({ site: post.site, platform: t.platform, postId: post.id, caption: post.caption ?? "", mediaPaths: media.map((m) => m.path) });
        await db.update(socialTargets).set({ status: "handoff" }).where(eq(socialTargets.id, t.id));
        handoff++;
        continue;
      }

      try {
        const r = await publishOne(post, t, media);
        await db
          .update(socialTargets)
          .set({ status: "published", externalId: r.id, externalUrl: r.url || null, error: null, postedAt: new Date() })
          .where(eq(socialTargets.id, t.id));
        await bumpThrottle(post.site, t.platform, true);
        published++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.update(socialTargets).set({ status: "failed", error: msg.slice(0, 300) }).where(eq(socialTargets.id, t.id));
        const paused = await bumpThrottle(post.site, t.platform, false);
        failed++;
        if (paused) await notify("warning", `⛔ ${t.platform} paused for ${post.site}`, `Two consecutive failures — queue stopped. Last error: ${msg.slice(0, 160)}`);
      }
    }

    // A due post with NO targets at all (approved or scheduled without channels)
    // would otherwise be marked "done" and vanish — route it to manual posting
    // first so its image + caption land in the handoff widget instead of being lost.
    const [tot] = await db.select({ c: sql<number>`count(*)::int` }).from(socialTargets).where(eq(socialTargets.postId, post.id));
    if (Number(tot?.c ?? 0) === 0) {
      const planned = (post.data as { platform?: string } | null)?.platform ?? "";
      const platform = (["x", "facebook", "instagram", "linkedin", "telegram"].includes(planned) ? planned : "facebook") as "x" | "facebook" | "instagram" | "linkedin" | "telegram";
      await writeHandoff({ site: post.site, platform, postId: post.id, caption: post.caption ?? "", mediaPaths: media.map((m) => m.path) });
      await db.insert(socialTargets).values({ postId: post.id, platform, mode: "handoff", status: "handoff" });
      handoff++;
    }

    const [rem] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(socialTargets)
      .where(and(eq(socialTargets.postId, post.id), eq(socialTargets.status, "queued")));
    if (Number(rem?.c ?? 0) === 0) await db.update(socialPosts).set({ status: "done" }).where(eq(socialPosts.id, post.id));
  }

  if (handoff > 0) await notify("info", "📥 Content ready for manual posting", `${handoff} item(s) prepared — see Social Studio → Queue.`);
  return { published, handoff, failed, skipped };
}
