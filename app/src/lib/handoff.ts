import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { MEDIA_ROOT } from "./banner";

// Manual-posting handoff (owner's workflow, 2026-06-13): for Meta/LinkedIn, drop
// the final caption + media into a per-platform/brand outbox folder so the owner
// can post by hand. Files live under MEDIA_ROOT/outbox and are also downloadable
// in-console via /api/media.
export async function writeHandoff(opts: {
  site: string;
  platform: string;
  postId: string;
  caption: string;
  mediaPaths: string[];
}): Promise<string> {
  const dir = path.join(MEDIA_ROOT, "outbox", opts.platform, opts.site, opts.postId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "caption.txt"), opts.caption ?? "", "utf8");
  for (const m of opts.mediaPaths) {
    try {
      await fs.copyFile(m, path.join(dir, path.basename(m)));
    } catch {
      /* media missing — caption still handed off */
    }
  }
  return path.relative(MEDIA_ROOT, dir);
}
