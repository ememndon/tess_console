import fs from "node:fs/promises";
import path from "node:path";
import { desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaJobs, socialMedia, socialPosts } from "@/lib/db/schema";
import { listRecipes } from "@/lib/demo/recipes";
import { VOICES, DEFAULT_VOICE } from "@/lib/demo/voices";
import { MEDIA_ROOT } from "@/lib/banner";
import { SITE_KEYS, SITE_META } from "@/lib/site-scope";
import { DemoStudio, type JobView, type RecipeView } from "./demo-client";
import { SectionHeader } from "@/components/filament/section-header";

export const metadata = { title: "Demo Studio" };
export const dynamic = "force-dynamic";

export default async function DemoStudioPage() {
  const recipes: RecipeView[] = listRecipes().map((r) => ({
    id: r.id,
    site: r.site,
    feature: r.feature,
    summary: r.summary,
    url: r.url,
  }));

  const brands = SITE_KEYS.map((k) => ({ key: k as string, name: SITE_META[k].name }));
  const musicTracks = await fs
    .readdir(path.join(MEDIA_ROOT, "assets", "music"))
    .then((files) => files.filter((f) => /\.(mp3|m4a|aac|wav|ogg)$/i.test(f)).sort())
    .catch(() => [] as string[]);

  // Recent renders lists real-site demos only. Console-showcase (bare) jobs carry
  // site="console" (never a registered brand) — an internal pipeline that films the
  // console itself; excluding them keeps this list from flooding during a showcase batch.
  const jobs = await db
    .select()
    .from(mediaJobs)
    .where(inArray(mediaJobs.site, SITE_KEYS as string[]))
    .orderBy(desc(mediaJobs.createdAt))
    .limit(20);
  const postIds = jobs.map((j) => j.postId).filter((x): x is string => !!x);
  const media = postIds.length ? await db.select().from(socialMedia).where(inArray(socialMedia.postId, postIds)) : [];
  const posts = postIds.length ? await db.select({ id: socialPosts.id, ref: socialPosts.ref }).from(socialPosts).where(inArray(socialPosts.id, postIds)) : [];
  const refByPost = new Map(posts.map((p) => [p.id, p.ref]));

  const mediaByPost = new Map<string, { type: string; path: string; width: number | null; height: number | null }[]>();
  for (const m of media) {
    const arr = mediaByPost.get(m.postId) ?? [];
    arr.push({ type: m.type, path: m.path, width: m.width, height: m.height });
    mediaByPost.set(m.postId, arr);
  }

  const jobsView: JobView[] = jobs.map((j) => ({
    id: j.id,
    site: j.site,
    recipeId: j.recipeId,
    feature: j.feature,
    status: j.status,
    createdBy: j.createdBy,
    result: j.result,
    postId: j.postId,
    ref: j.postId ? refByPost.get(j.postId) ?? null : null,
    createdAt: (j.createdAt instanceof Date ? j.createdAt : new Date(j.createdAt as unknown as string)).toISOString(),
    media: j.postId ? mediaByPost.get(j.postId) ?? [] : [],
  }));

  return (
    <div data-section="demo" className="flex flex-1 flex-col gap-6 p-6">
      <SectionHeader title="Demo Studio" register="STUDIO">
        Tess drives a live site feature like a human, screen-records it with a brand-voice voiceover, and renders
        share-ready demo videos in three formats (9:16, 1:1, 16:9). Output lands as a draft in Social Studio for you to
        review &amp; post — nothing is posted automatically.
      </SectionHeader>
      <DemoStudio
        recipes={recipes}
        jobs={jobsView}
        brands={brands}
        musicTracks={musicTracks}
        voices={VOICES}
        defaultVoice={DEFAULT_VOICE}
      />
    </div>
  );
}
