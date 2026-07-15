import "server-only";
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";
import { getSecretValue } from "./secrets";
import { MEDIA_ROOT } from "./banner";

// Stock media sourcing (Pexels primary, Pixabay fallback). Lets the post pipeline
// SOMETIMES use a real photo/clip instead of generating one — cutting AI
// image-gen load + cost. Every function returns null when no key is configured or
// nothing relevant is found, so callers always fall back (→ FLUX → banner).

type StockHit = { url: string; credit: string };
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

async function pexelsPhoto(key: string, query: string): Promise<StockHit | null> {
  const u = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=square`;
  const r = await fetch(u, { headers: { Authorization: key } });
  if (!r.ok) return null;
  const j = (await r.json()) as { photos?: { src?: { large2x?: string; large?: string; original?: string }; photographer?: string }[] };
  const list = j.photos ?? [];
  if (!list.length) return null;
  const p = pick(list);
  const url = p.src?.large2x || p.src?.large || p.src?.original;
  return url ? { url, credit: `Pexels / ${p.photographer ?? "photographer"}` } : null;
}

async function pixabayPhoto(key: string, query: string): Promise<StockHit | null> {
  const u = `https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&image_type=photo&per_page=20&safesearch=true`;
  const r = await fetch(u);
  if (!r.ok) return null;
  const j = (await r.json()) as { hits?: { largeImageURL?: string; webformatURL?: string; user?: string }[] };
  const list = j.hits ?? [];
  if (!list.length) return null;
  const h = pick(list);
  const url = h.largeImageURL || h.webformatURL;
  return url ? { url, credit: `Pixabay / ${h.user ?? "creator"}` } : null;
}

export async function fetchStockPhoto(query: string): Promise<{ data: Buffer; credit: string } | null> {
  const got = await fetchStockPhotoUrl(query);
  if (!got) return null;
  const img = await fetch(got.url).catch(() => null);
  if (!img || !img.ok) return null;
  return { data: Buffer.from(await img.arrayBuffer()), credit: got.credit };
}

// Like fetchStockVideoUrl, but for a still PHOTO — used as the B-roll fallback when
// no suitable video is found (the worker Ken-Burns the still into a clip).
export async function fetchStockPhotoUrl(query: string): Promise<{ url: string; credit: string } | null> {
  const [pexels, pixabay] = await Promise.all([getSecretValue("pexels_api_key"), getSecretValue("pixabay_api_key")]);
  let found: StockHit | null = null;
  if (pexels) found = await pexelsPhoto(pexels, query).catch(() => null);
  if (!found && pixabay) found = await pixabayPhoto(pixabay, query).catch(() => null);
  return found;
}

// Return SEVERAL stock-photo candidates for a query (not just one), so the
// thumbnail engine can try multiple faces — pick the one that cuts out cleanest,
// and give variety across the 3 thumbnail concepts. Pexels first, Pixabay topped
// up after. orientation only applies to Pexels. Returns [] when nothing/no key.
export async function fetchStockPhotoCandidates(
  query: string,
  opts: { orientation?: "portrait" | "square" | "landscape"; limit?: number } = {},
): Promise<StockHit[]> {
  const limit = opts.limit ?? 8;
  const orientation = opts.orientation ?? "portrait";
  const [pexels, pixabay] = await Promise.all([getSecretValue("pexels_api_key"), getSecretValue("pixabay_api_key")]);
  const out: StockHit[] = [];
  if (pexels) {
    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${limit}&orientation=${orientation}`,
      { headers: { Authorization: pexels } },
    ).catch(() => null);
    if (r?.ok) {
      const j = (await r.json()) as { photos?: { src?: { large2x?: string; large?: string; original?: string }; photographer?: string }[] };
      for (const p of j.photos ?? []) {
        const url = p.src?.large2x || p.src?.large || p.src?.original;
        if (url) out.push({ url, credit: `Pexels / ${p.photographer ?? "photographer"}` });
      }
    }
  }
  if (out.length < limit && pixabay) {
    const r = await fetch(
      `https://pixabay.com/api/?key=${encodeURIComponent(pixabay)}&q=${encodeURIComponent(query)}&image_type=photo&category=people&per_page=${Math.max(limit, 20)}&safesearch=true`,
    ).catch(() => null);
    if (r?.ok) {
      const j = (await r.json()) as { hits?: { largeImageURL?: string; webformatURL?: string; user?: string }[] };
      for (const h of j.hits ?? []) {
        const url = h.largeImageURL || h.webformatURL;
        if (url) out.push({ url, credit: `Pixabay / ${h.user ?? "creator"}` });
      }
    }
  }
  return out.slice(0, limit);
}

// Save a stock photo for a post as a 1080² social image (cover-cropped on the
// salient region) — same return shape as renderBanner/renderAiImage so the
// composer attaches it identically. Returns null → caller falls back to AI/banner.
export async function renderStockImage(
  postId: string,
  query: string,
): Promise<{ path: string; width: number; height: number; credit: string } | null> {
  const got = await fetchStockPhoto(query);
  if (!got) return null;
  const dir = path.join(MEDIA_ROOT, "social", postId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `stock-${Date.now()}.jpg`);
  await sharp(got.data).resize(1080, 1080, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toFile(file);
  return { path: file, width: 1080, height: 1080, credit: got.credit };
}

// Find a stock VIDEO clip URL for a query (mp4 link), Pexels then Pixabay. The
// caller (media worker / video engine) downloads + composes it. Null → no clip.
export async function fetchStockVideoUrl(query: string): Promise<{ url: string; credit: string } | null> {
  const [pexels, pixabay] = await Promise.all([getSecretValue("pexels_api_key"), getSecretValue("pixabay_api_key")]);
  if (pexels) {
    const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=12&orientation=portrait`, {
      headers: { Authorization: pexels },
    }).catch(() => null);
    if (r && r.ok) {
      const j = (await r.json()) as { videos?: { video_files?: { link?: string; quality?: string; width?: number }[]; user?: { name?: string } }[] };
      const list = j.videos ?? [];
      if (list.length) {
        const v = pick(list);
        const files = (v.video_files ?? []).filter((f) => f.link).sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
        // Prefer an HD-ish file that isn't enormous (≈1080 wide), else the largest.
        const f = files.find((x) => (x.width ?? 0) >= 1080) ?? files[files.length - 1];
        if (f?.link) return { url: f.link, credit: `Pexels / ${v.user?.name ?? "creator"}` };
      }
    }
  }
  if (pixabay) {
    const r = await fetch(`https://pixabay.com/api/videos/?key=${encodeURIComponent(pixabay)}&q=${encodeURIComponent(query)}&per_page=12&safesearch=true`).catch(() => null);
    if (r && r.ok) {
      const j = (await r.json()) as { hits?: { videos?: { large?: { url?: string }; medium?: { url?: string } }; user?: string }[] };
      const list = j.hits ?? [];
      if (list.length) {
        const h = pick(list);
        const url = h.videos?.large?.url || h.videos?.medium?.url;
        if (url) return { url, credit: `Pixabay / ${h.user ?? "creator"}` };
      }
    }
  }
  return null;
}

// Build a short, stock-search-friendly query from a page title + the site's
// subject area (drops "calculator"/"tool" noise that returns screenshots).
const SITE_STOCK_TERM: Record<string, string> = {
  calculatry: "finance health lifestyle",
  resumehub: "career office professional",
  checkinvest: "finance investment money",
};
export function stockQueryFor(site: string, pageTitle: string): string {
  const base = pageTitle
    .replace(/\b(calculator|calc|generator|converter|tool|builder|template|maker)\b/gi, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const term = SITE_STOCK_TERM[site] ?? "";
  const q = `${base} ${term}`.trim().split(/\s+/).slice(0, 6).join(" ");
  return q || term || "abstract background";
}
