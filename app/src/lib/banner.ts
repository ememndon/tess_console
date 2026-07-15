import "server-only";
import satori from "satori";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "path";
import { brandDesignFor, type BrandDesign, layoutForSite, type BannerLayout, type BannerTextStyle } from "./design";
export type { BannerTextStyle } from "./design";

// Branded banner generator: laid out with Satori (flexbox + real fonts)
// and rasterized to PNG with sharp — free, unlimited, on-brand. Satori gives proper
// text layout (wrapping + measured fit, no SVG overflow) and a heavy display face
// (Archivo Black) for bold, art-directed headlines, per the owner's DESIGN_DIRECTIVE.
// No browser needed; Satori embeds glyph outlines so sharp can rasterize directly.

export const MEDIA_ROOT = process.env.MEDIA_ROOT ?? "/app/media";
const FONT_DIR = path.join(process.cwd(), "data", "fonts");
const W = 1200;
const H = 630;

type LoadedFont = { name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: "normal" };
let FONTS: LoadedFont[] | null = null;
async function fonts(): Promise<LoadedFont[]> {
  if (FONTS) return FONTS;
  const read = (f: string) => fs.readFile(path.join(FONT_DIR, f));
  const [archivo, med, semi, bold, dejavu] = await Promise.all([
    read("ArchivoBlack-Regular.ttf"),
    read("Poppins-Medium.ttf"),
    read("Poppins-SemiBold.ttf"),
    read("Poppins-Bold.ttf"),
    read("DejaVuSans.ttf"),
  ]);
  FONTS = [
    { name: "Archivo Black", data: archivo, weight: 400, style: "normal" },
    { name: "Poppins", data: med, weight: 500, style: "normal" },
    { name: "Poppins", data: semi, weight: 600, style: "normal" },
    { name: "Poppins", data: bold, weight: 700, style: "normal" },
    // Broad-coverage fallback so symbols the display faces lack still render —
    // notably ₦ (Naira) for CheckInvest. Satori falls back across provided fonts.
    { name: "DejaVu Sans", data: dejavu, weight: 400, style: "normal" },
  ];
  return FONTS;
}

// Minimal hyperscript so we can build the Satori tree without JSX in a .ts lib file.
type El = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: unknown[]): El => ({
  type,
  props: { style, children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children },
});

// BannerLayout + layoutForSite now live in ./design (client-safe, shared with
// the Create-tab preview). Imported above.

export type BannerSpec = {
  site: string;
  title: string;
  subtitle?: string;
  style?: BannerTextStyle; // manual overrides from the post-detail image editor
  badge?: string; // DEPRECATED — internal pillar label, NEVER rendered on the image (audience-facing rule)
  dataLines?: { label: string; value: string }[]; // data-bound numbers (no invented numbers)
  hashtags?: string[]; // DEPRECATED — not rendered on the image (hashtags belong in the caption, not the art)
  bgImage?: Buffer; // optional AI/photo backdrop — text is composited on top as real type
  layout?: BannerLayout; // override the design; default resolves per site (layoutForSite)
};

// Trim to a character budget on a WORD boundary — never mid-word — so copy can
// never end in a chopped fragment like "job seekers in e". Drops any trailing
// partial word and dangling punctuation.
function fit(s: string, max: number): string {
  const clean = s.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  let cut = clean.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  if (sp > 8) cut = cut.slice(0, sp); // keep at least one word
  return cut.replace(/[\s,;:.–—-]+$/, "").trim();
}

// A headline may carry explicit line breaks ("\n") so the admin can force a wrap
// (e.g. put "Two Fates" on its own line). titleLines returns the fitted lines and
// headlineNode stacks them in a column; a single line renders exactly as before.
function titleLines(raw: string, max: number): string[] {
  const parts = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return (parts.length ? parts : [raw.trim()]).map((l) => fit(l, max)).filter(Boolean);
}
const longestLine = (lines: string[]): string => lines.reduce((a, b) => (a.length >= b.length ? a : b), "");
function headlineNode(lines: string[], style: Record<string, unknown>): El {
  if (lines.length <= 1) return h("div", style, lines[0] ?? "");
  return h("div", { ...style, flexDirection: "column" }, ...lines.map((l) => h("div", { display: "flex" }, l)));
}

// Headline size scales with length so it stays bold but never overflows the canvas.
function headlineSize(title: string): number {
  const n = title.length;
  if (n <= 16) return 98;
  if (n <= 28) return 84;
  if (n <= 44) return 70;
  if (n <= 64) return 58;
  return 50;
}

// Resolve headline/subhead font+weight+size+colour from the spec's manual overrides,
// falling back to the brand/auto defaults. Shared by all three layouts.
function resolveText(b: BrandDesign, spec: BannerSpec, autoHeadlineSize: number, subDefaultSize: number) {
  const st = spec.style ?? {};
  const hFont = st.headlineFont === "Poppins" || st.headlineFont === "Archivo Black" ? st.headlineFont : "Archivo Black";
  const sFont = st.subheadFont === "Poppins" || st.subheadFont === "Archivo Black" ? st.subheadFont : "Poppins";
  return {
    hFont,
    hWeight: hFont === "Poppins" ? 700 : 400,
    hSize: st.headlineSizePx && st.headlineSizePx >= 24 ? Math.min(160, st.headlineSizePx) : autoHeadlineSize,
    hColor: st.headlineColor || b.ink,
    sFont,
    sWeight: sFont === "Poppins" ? 500 : 400,
    sSize: st.subheadSizePx && st.subheadSizePx >= 16 ? Math.min(90, st.subheadSizePx) : subDefaultSize,
    sColor: st.subheadColor || withAlpha(b.ink, 0.82),
  };
}

function withAlpha(hex: string, a: number): string {
  const c = hex.replace("#", "");
  const v = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function treeRail(b: BrandDesign, spec: BannerSpec, mode: "solid" | "overlay"): El {
  const tLines = titleLines(spec.title, 130);
  const T = resolveText(b, spec, headlineSize(longestLine(tLines)), 32);
  const data = (spec.dataLines ?? []).slice(0, 3).filter((d) => d.label && d.value);

  // Background layers. "solid" = the brand gradient + soft glows (text-only banner).
  // "overlay" = transparent root with a dark legibility scrim, composited over an
  // AI/photo backdrop by renderBanner so the real type stays crisp and readable.
  const layers: El[] =
    mode === "overlay"
      ? [
          // diagonal scrim: heavy on the left where the headline sits, lighter right
          h("div", { position: "absolute", display: "flex", top: "0px", left: "0px", width: `${W}px`, height: `${H}px`, backgroundImage: `linear-gradient(115deg, rgba(7,8,18,0.88) 0%, rgba(7,8,18,0.66) 46%, rgba(7,8,18,0.30) 100%)` }),
          // extra darkening along the bottom so the footer row stays legible
          h("div", { position: "absolute", display: "flex", bottom: "0px", left: "0px", width: `${W}px`, height: "240px", backgroundImage: `linear-gradient(to top, rgba(7,8,18,0.82) 0%, rgba(7,8,18,0) 100%)` }),
          // solid accent rail, left edge (brand cue)
          h("div", { position: "absolute", display: "flex", left: "0px", top: "0px", width: "16px", height: `${H}px`, backgroundColor: b.accent }),
        ]
      : [
          // soft accent glow, top-right, bleeding off-canvas
          h("div", { position: "absolute", display: "flex", top: "-220px", right: "-180px", width: "640px", height: "640px", borderRadius: "9999px", backgroundImage: `radial-gradient(circle at center, ${withAlpha(b.accent, 0.55)} 0%, ${withAlpha(b.accent, 0)} 70%)` }),
          // faint brand orb, low-left
          h("div", { position: "absolute", display: "flex", bottom: "-200px", left: "120px", width: "520px", height: "520px", borderRadius: "9999px", backgroundImage: `radial-gradient(circle at center, ${withAlpha(b.bright, 0.5)} 0%, ${withAlpha(b.bright, 0)} 70%)` }),
          // solid accent rail, left edge
          h("div", { position: "absolute", display: "flex", left: "0px", top: "0px", width: "16px", height: `${H}px`, backgroundColor: b.accent }),
        ];

  // Top row: just the wordmark. NO pillar badge — "How-To"/"Tool Spotlight" are
  // internal structure labels, never shown to the audience (owner rule).
  const topRow = h(
    "div",
    { display: "flex", alignItems: "baseline", fontFamily: "Archivo Black", fontSize: "30px", letterSpacing: "-0.5px", color: b.ink },
    h("span", { display: "flex" }, b.wordmark[0]),
    h("span", { display: "flex", color: b.accent }, b.wordmark[1]),
  );

  // Hero headline — heavy, tight, auto-fit.
  const headline = headlineNode(tLines, { display: "flex", fontFamily: T.hFont, fontWeight: T.hWeight, fontSize: `${T.hSize}px`, lineHeight: 1.02, letterSpacing: "-1px", color: T.hColor, maxWidth: "1000px", marginTop: "30px" });

  const subtitle = spec.subtitle
    ? h("div", { display: "flex", fontFamily: T.sFont, fontWeight: T.sWeight, fontSize: `${T.sSize}px`, color: T.sColor, maxWidth: "900px", marginTop: "22px" }, fit(spec.subtitle, 120))
    : null;

  // Data → bold stat pills (value over label), only when present (no invented numbers).
  const stats = data.length
    ? h(
        "div",
        { display: "flex", gap: "20px", marginTop: "34px" },
        ...data.map((d) =>
          h(
            "div",
            { display: "flex", flexDirection: "column", padding: "16px 26px", borderRadius: "18px", backgroundColor: withAlpha("#FFFFFF", 0.08), border: `1px solid ${withAlpha("#FFFFFF", 0.14)}` },
            h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "38px", color: b.accent }, d.value.slice(0, 16)),
            h("div", { display: "flex", fontFamily: "Poppins", fontWeight: 500, fontSize: "20px", color: withAlpha(b.ink, 0.7), marginTop: "4px" }, d.label.slice(0, 28)),
          ),
        ),
      )
    : null;

  const content = h(
    "div",
    { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", width: "100%" },
    topRow,
    headline,
    ...(subtitle ? [subtitle] : []),
    ...(stats ? [stats] : []),
  );

  // Footer: divider + domain only. NO hashtags on the image (they belong in the
  // caption, not baked into the art — owner rule). The URL stays, by design.
  const footer = h(
    "div",
    { display: "flex", flexDirection: "column", width: "100%" },
    h("div", { display: "flex", width: "100%", height: "2px", backgroundColor: withAlpha("#FFFFFF", 0.16), marginBottom: "20px" }),
    h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "30px", color: b.accent }, b.domain),
  );

  // Overlay mode: transparent root (the AI/photo backdrop is composited behind it
  // by renderBanner). Solid mode: the brand gradient.
  const rootBg =
    mode === "overlay"
      ? { backgroundColor: "transparent" }
      : { backgroundColor: b.base, backgroundImage: `linear-gradient(135deg, ${b.base} 0%, ${b.mid} 58%, ${b.bright} 100%)` };

  return h(
    "div",
    {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      width: `${W}px`,
      height: `${H}px`,
      padding: "64px 72px",
      ...rootBg,
      fontFamily: "Poppins",
    },
    ...layers,
    content,
    footer,
  );
}

// ── Calculatry: centered spotlight ──────────────────────────────────────────
// Symmetrical, confident composition: wordmark up top, a big centered headline
// with a single gold underline accent, centered subhead, domain centered below.
// Faint concentric gold rings + a soft glow give it a precise, "instrument" feel
// distinct from the left-rail. (No left rail anywhere here.)
function treeCalc(b: BrandDesign, spec: BannerSpec, mode: "solid" | "overlay"): El {
  const tLines = titleLines(spec.title, 110);
  const T = resolveText(b, spec, headlineSize(longestLine(tLines)), 30);
  const sub = spec.subtitle ? fit(spec.subtitle, 110) : null;
  const overlay = mode === "overlay";

  const layers: El[] = overlay
    ? [
        // radial dark scrim keeps centered white type readable over any photo
        h("div", { position: "absolute", display: "flex", top: "0px", left: "0px", width: `${W}px`, height: `${H}px`, backgroundImage: `radial-gradient(circle at 50% 48%, rgba(7,8,18,0.62) 0%, rgba(7,8,18,0.88) 100%)` }),
      ]
    : [
        // concentric gold rings, bottom-right
        h("div", { position: "absolute", display: "flex", right: "-170px", bottom: "-170px", width: "540px", height: "540px", borderRadius: "9999px", border: `2px solid ${withAlpha(b.accent, 0.22)}` }),
        h("div", { position: "absolute", display: "flex", right: "-90px", bottom: "-90px", width: "380px", height: "380px", borderRadius: "9999px", border: `2px solid ${withAlpha(b.accent, 0.16)}` }),
        // soft gold glow, upper area
        h("div", { position: "absolute", display: "flex", top: "-220px", left: "340px", width: "560px", height: "560px", borderRadius: "9999px", backgroundImage: `radial-gradient(circle at center, ${withAlpha(b.accent, 0.28)} 0%, ${withAlpha(b.accent, 0)} 70%)` }),
      ];

  const wordmark = h(
    "div",
    { display: "flex", alignItems: "baseline", fontFamily: "Archivo Black", fontSize: "28px", letterSpacing: "-0.5px", color: b.ink },
    h("span", { display: "flex" }, b.wordmark[0]),
    h("span", { display: "flex", color: b.accent }, b.wordmark[1]),
  );
  const headline = headlineNode(tLines, { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: T.hFont, fontWeight: T.hWeight, fontSize: `${T.hSize}px`, lineHeight: 1.04, letterSpacing: "-1px", color: T.hColor, maxWidth: "980px" });
  const underline = h("div", { display: "flex", width: "92px", height: "6px", borderRadius: "9999px", backgroundColor: b.accent, marginTop: "26px" });
  const subEl = sub ? h("div", { display: "flex", justifyContent: "center", textAlign: "center", fontFamily: T.sFont, fontWeight: T.sWeight, fontSize: `${T.sSize}px`, color: T.sColor, maxWidth: "840px", marginTop: "24px" }, sub) : null;
  const domain = h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "28px", letterSpacing: "0.3px", color: b.accent }, b.domain);

  const rootBg = overlay
    ? { backgroundColor: "transparent" }
    : { backgroundColor: b.base, backgroundImage: `linear-gradient(135deg, ${b.base} 0%, ${b.mid} 58%, ${b.bright} 100%)` };

  return h(
    "div",
    { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", width: `${W}px`, height: `${H}px`, padding: "60px 80px", ...rootBg, fontFamily: "Poppins" },
    ...layers,
    h("div", { display: "flex", justifyContent: "center", width: "100%" }, wordmark),
    h("div", { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, width: "100%" }, headline, underline, ...(subEl ? [subEl] : [])),
    h("div", { display: "flex", justifyContent: "center", width: "100%" }, domain),
  );
}

// Two overlapping CV documents — the ResumeHub motif. Only drawn on the solid
// (Tess-designed) banner; omitted over photo/AI backdrops where it would clash.
function cvDocuments(b: BrandDesign): El {
  const grayLine = (w: string, mt = "10px") => h("div", { display: "flex", width: w, height: "8px", borderRadius: "4px", backgroundColor: "#D7DBE4", marginTop: mt });
  const frontCard = h(
    "div",
    { position: "absolute", display: "flex", flexDirection: "column", top: "12px", left: "104px", width: "300px", height: "404px", borderRadius: "16px", backgroundColor: "#FFFFFF", overflow: "hidden", transform: "rotate(4deg)", boxShadow: "0 26px 60px rgba(0,0,0,0.40)" },
    // header band with avatar + name bars
    h(
      "div",
      { display: "flex", alignItems: "center", width: "100%", height: "94px", backgroundColor: b.mid, padding: "0 22px" },
      h("div", { display: "flex", width: "46px", height: "46px", borderRadius: "9999px", backgroundColor: b.accent }),
      h(
        "div",
        { display: "flex", flexDirection: "column", marginLeft: "16px" },
        h("div", { display: "flex", width: "118px", height: "11px", borderRadius: "4px", backgroundColor: "#FFFFFF" }),
        h("div", { display: "flex", width: "78px", height: "8px", borderRadius: "4px", backgroundColor: withAlpha("#FFFFFF", 0.55), marginTop: "9px" }),
      ),
    ),
    // body: orange section markers + gray text lines
    h(
      "div",
      { display: "flex", flexDirection: "column", width: "100%", padding: "22px 22px" },
      h("div", { display: "flex", width: "84px", height: "9px", borderRadius: "4px", backgroundColor: b.accent }),
      grayLine("100%"),
      grayLine("100%"),
      grayLine("72%"),
      h("div", { display: "flex", width: "84px", height: "9px", borderRadius: "4px", backgroundColor: b.accent, marginTop: "20px" }),
      grayLine("100%"),
      grayLine("88%"),
      grayLine("58%"),
    ),
  );
  const backCard = h("div", { position: "absolute", display: "flex", top: "34px", left: "6px", width: "296px", height: "384px", borderRadius: "16px", backgroundColor: "#E7EAF1", transform: "rotate(-7deg)", boxShadow: "0 18px 44px rgba(0,0,0,0.28)" });
  // The right-hand cluster holding both cards. Sits a bit below the letterhead
  // rule so the documents clear the line.
  return h("div", { position: "absolute", display: "flex", right: "56px", top: "150px", width: "430px", height: "430px" }, backCard, frontCard);
}

// ── ResumeHub: editorial letterhead ─────────────────────────────────────────
// Reads like the header of a polished CV: wordmark over a full-width rule
// (letterhead), a small stack of orange "document lines" as a kicker, then a
// large left-aligned headline and subhead. On the solid banner, two overlapping
// CV documents sit on the right; on photo/AI backdrops they're dropped (they'd
// clash) and the headline gets the full width.
function treeResume(b: BrandDesign, spec: BannerSpec, mode: "solid" | "overlay"): El {
  const overlay = mode === "overlay";
  const showDocs = !overlay; // CV docs only on the Tess-designed gradient banner
  const tLines = titleLines(spec.title, showDocs ? 90 : 120);
  const T = resolveText(b, spec, headlineSize(longestLine(tLines)), 30);
  const sub = spec.subtitle ? fit(spec.subtitle, showDocs ? 80 : 120) : null;

  const layers: El[] = overlay
    ? [
        h("div", { position: "absolute", display: "flex", top: "0px", left: "0px", width: `${W}px`, height: `${H}px`, backgroundImage: `linear-gradient(105deg, rgba(4,16,39,0.9) 0%, rgba(4,16,39,0.62) 55%, rgba(4,16,39,0.34) 100%)` }),
      ]
    : [
        // faint royal-blue glow, lower-left, for depth
        h("div", { position: "absolute", display: "flex", bottom: "-220px", left: "-120px", width: "560px", height: "560px", borderRadius: "9999px", backgroundImage: `radial-gradient(circle at center, ${withAlpha(b.bright, 0.5)} 0%, ${withAlpha(b.bright, 0)} 70%)` }),
      ];

  const wordmark = h(
    "div",
    { display: "flex", alignItems: "baseline", fontFamily: "Archivo Black", fontSize: "30px", letterSpacing: "-0.5px", color: b.ink },
    h("span", { display: "flex" }, b.wordmark[0]),
    h("span", { display: "flex", color: b.accent }, b.wordmark[1]),
  );
  const topRule = h("div", { display: "flex", width: "100%", height: "2px", backgroundColor: withAlpha(b.ink, 0.22), marginTop: "16px" });
  const docMotif = h(
    "div",
    { display: "flex", flexDirection: "column", marginBottom: "20px" },
    h("div", { display: "flex", width: "66px", height: "7px", borderRadius: "4px", backgroundColor: b.accent }),
    h("div", { display: "flex", width: "42px", height: "7px", borderRadius: "4px", backgroundColor: withAlpha(b.accent, 0.6), marginTop: "7px" }),
    h("div", { display: "flex", width: "24px", height: "7px", borderRadius: "4px", backgroundColor: withAlpha(b.accent, 0.34), marginTop: "7px" }),
  );
  // Keep the headline/subhead clear of the documents on the solid banner.
  const headline = headlineNode(tLines, { display: "flex", fontFamily: T.hFont, fontWeight: T.hWeight, fontSize: `${T.hSize}px`, lineHeight: 1.03, letterSpacing: "-1px", color: T.hColor, maxWidth: showDocs ? "600px" : "980px" });
  const subEl = sub ? h("div", { display: "flex", fontFamily: T.sFont, fontWeight: T.sWeight, fontSize: `${T.sSize}px`, color: T.sColor, maxWidth: showDocs ? "560px" : "900px", marginTop: "22px" }, sub) : null;
  const domain = h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "30px", color: b.accent }, b.domain);

  const rootBg = overlay
    ? { backgroundColor: "transparent" }
    : { backgroundColor: b.base, backgroundImage: `linear-gradient(135deg, ${b.base} 0%, ${b.mid} 58%, ${b.bright} 100%)` };

  return h(
    "div",
    { position: "relative", display: "flex", flexDirection: "column", width: `${W}px`, height: `${H}px`, padding: "54px 72px", ...rootBg, fontFamily: "Poppins" },
    ...layers,
    ...(showDocs ? [cvDocuments(b)] : []),
    h("div", { display: "flex", flexDirection: "column", width: "100%" }, wordmark, topRule),
    h("div", { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1, width: "100%" }, docMotif, headline, ...(subEl ? [subEl] : [])),
    h("div", { display: "flex", width: "100%" }, domain),
  );
}

function buildTree(b: BrandDesign, spec: BannerSpec, mode: "solid" | "overlay", layout: BannerLayout): El {
  if (layout === "calc") return treeCalc(b, spec, mode);
  if (layout === "resume") return treeResume(b, spec, mode);
  return treeRail(b, spec, mode);
}

export async function renderBanner(
  id: string,
  spec: BannerSpec,
): Promise<{ path: string; relPath: string; width: number; height: number }> {
  const b = brandDesignFor(spec.site);
  const overlay = !!spec.bgImage;
  // Each site gets its own design (Calculatry centered, ResumeHub letterhead,
  // CheckInvest rail). An explicit spec.layout still wins (e.g. samples).
  const layout = spec.layout ?? layoutForSite(spec.site);
  const svg = await satori(buildTree(b, spec, overlay ? "overlay" : "solid", layout) as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts: await fonts() });

  const dir = path.join(MEDIA_ROOT, "banners", spec.site);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);

  if (overlay && spec.bgImage) {
    // Composite the transparent text layer over the AI/photo backdrop (cover-fit
    // to the canvas). The scrim baked into the SVG keeps the white type readable.
    const textLayer = await sharp(Buffer.from(svg)).png().toBuffer();
    const bg = await sharp(spec.bgImage).resize(W, H, { fit: "cover", position: "attention" }).toBuffer();
    await sharp(bg).composite([{ input: textLayer, top: 0, left: 0 }]).png().toFile(file);
  } else {
    await sharp(Buffer.from(svg)).png().toFile(file);
  }
  return { path: file, relPath: path.relative(MEDIA_ROOT, file), width: W, height: H };
}

// ── Instagram carousel slides ────────────────────────────────────────────────
// Portrait 4:5 (1080x1350) slides sharing ONE backdrop, so a whole carousel reads
// as one cohesive set. Three slide kinds: a cover (the hook), point slides (one
// idea each, numbered), and a CTA. Text is composited over the shared backdrop
// with a legibility scrim, same engine as the banner overlay.
const CW = 1080;
const CH_PORTRAIT = 1350; // 4:5 Instagram portrait
const CH_SQUARE = 1080; // 1:1 Instagram square

export type CarouselSlideKind = "cover" | "point" | "cta";
export type CarouselAspect = "portrait" | "square";
// Three layout treatments over the SAME shared backdrop + brand palette, so a set
// still reads as one brand but every carousel doesn't look like the last one.
//   bold      — full-height accent rail, chunky number chip, left-aligned (default)
//   minimal   — no rail, airy centred type, "TIP 01" label instead of a chip
//   editorial — accent bar beside the text block, oversized 01 numeral, pill counter
export type CarouselStyle = "bold" | "minimal" | "editorial";
// Portrait (4:5) fills more of the feed; square (1:1) is the classic grid look.
// Width is constant (1080) so the shared backdrop + type scale read identically.
function carouselDims(aspect?: CarouselAspect): { W: number; H: number; padY: number } {
  return aspect === "square" ? { W: CW, H: CH_SQUARE, padY: 76 } : { W: CW, H: CH_PORTRAIT, padY: 108 };
}
export type CarouselSlideSpec = {
  site: string;
  kind: CarouselSlideKind;
  index: number; // 1-based slide position
  total: number; // total slides in the set
  pointNo?: number; // for "point" slides: the 1-based tip number shown in the chip
  title: string;
  body?: string;
  bgImage?: Buffer; // the shared backdrop (same Buffer for every slide)
  aspect?: CarouselAspect; // portrait (default, 4:5) or square (1:1)
  style?: CarouselStyle; // layout treatment (default "bold")
};

function carouselHeadlineSize(kind: CarouselSlideKind, title: string): number {
  const n = title.length;
  if (kind === "cover") return n <= 20 ? 100 : n <= 40 ? 82 : n <= 66 ? 66 : 56;
  if (kind === "cta") return n <= 22 ? 88 : n <= 44 ? 70 : 58;
  return n <= 24 ? 70 : n <= 46 ? 58 : n <= 72 ? 50 : 44; // point
}

function carouselTree(b: BrandDesign, spec: CarouselSlideSpec): El {
  const isCta = spec.kind === "cta";
  const style: CarouselStyle = spec.style ?? "bold";
  const { W, H, padY } = carouselDims(spec.aspect);
  const centred = style === "minimal";
  const editorial = style === "editorial";
  const barGutter = editorial ? 44 : 0; // accent bar + its margin eats horizontal room
  const tLines = titleLines(spec.title, spec.kind === "cover" ? 80 : 92);
  const hSize = carouselHeadlineSize(spec.kind, longestLine(tLines));
  const body = spec.body ? fit(spec.body, 210) : null;

  // Legibility scrim (baked into the transparent SVG), tuned per style. "bold" also
  // gets a full-height accent rail — the constant frame that makes a set read as one.
  const scrim = centred
    ? "linear-gradient(180deg, rgba(7,8,18,0.60) 0%, rgba(7,8,18,0.34) 45%, rgba(7,8,18,0.82) 100%)"
    : editorial
      ? "linear-gradient(180deg, rgba(7,8,18,0.72) 0%, rgba(7,8,18,0.46) 40%, rgba(7,8,18,0.92) 100%)"
      : "linear-gradient(180deg, rgba(7,8,18,0.74) 0%, rgba(7,8,18,0.50) 44%, rgba(7,8,18,0.88) 100%)";
  const layers: El[] = [
    h("div", { position: "absolute", display: "flex", top: "0px", left: "0px", width: `${W}px`, height: `${H}px`, backgroundImage: scrim }),
  ];
  if (style === "bold") {
    layers.push(h("div", { position: "absolute", display: "flex", left: "0px", top: "0px", width: "14px", height: `${H}px`, backgroundColor: b.accent }));
  }

  const wordmark = h(
    "div",
    { display: "flex", alignItems: "baseline", fontFamily: "Archivo Black", fontSize: "34px", letterSpacing: "-0.5px", color: b.ink },
    h("span", { display: "flex" }, b.wordmark[0]),
    h("span", { display: "flex", color: b.accent }, b.wordmark[1]),
  );
  const count = `${spec.index} / ${spec.total}`;
  const counter = editorial
    ? h("div", { display: "flex", alignItems: "center", justifyContent: "center", height: "44px", paddingLeft: "18px", paddingRight: "18px", borderRadius: "9999px", backgroundColor: b.accent, fontFamily: "Poppins", fontWeight: 700, fontSize: "22px", color: b.base }, count)
    : h("div", { display: "flex", fontFamily: "Poppins", fontWeight: 600, fontSize: "26px", color: withAlpha("#FFFFFF", 0.6) }, count);
  const topRow = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }, wordmark, counter);

  // The tip number: a chip (bold), a letter-spaced label (minimal), or an oversized
  // numeral (editorial). Cover + CTA slides never carry one.
  let numberEl: El | null = null;
  if (spec.kind === "point") {
    const n = String(spec.pointNo ?? spec.index);
    if (style === "bold") {
      numberEl = h(
        "div",
        { display: "flex", alignItems: "center", justifyContent: "center", width: "104px", height: "104px", borderRadius: "26px", backgroundColor: b.accent, marginBottom: "38px" },
        h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "56px", color: b.base }, n),
      );
    } else if (centred) {
      numberEl = h("div", { display: "flex", fontFamily: "Poppins", fontWeight: 700, fontSize: "24px", letterSpacing: "6px", color: b.accent, marginBottom: "22px" }, `TIP ${n.padStart(2, "0")}`);
    } else {
      numberEl = h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "96px", lineHeight: 1, letterSpacing: "-2px", color: withAlpha(b.accent, 0.92), marginBottom: "10px" }, n.padStart(2, "0"));
    }
  }

  const headline = headlineNode(tLines, {
    display: "flex",
    alignItems: centred ? "center" : "flex-start",
    fontFamily: "Archivo Black",
    fontWeight: 400,
    fontSize: `${hSize}px`,
    lineHeight: 1.04,
    letterSpacing: "-1px",
    color: "#FFFFFF",
    maxWidth: `${W - 200 - barGutter}px`,
    ...(centred ? { textAlign: "center" } : {}),
  });
  const bodyEl = body
    ? h("div", { display: "flex", fontFamily: "Poppins", fontWeight: 500, fontSize: "34px", lineHeight: 1.35, color: withAlpha("#FFFFFF", 0.86), maxWidth: `${W - 210 - barGutter}px`, marginTop: "28px", ...(centred ? { textAlign: "center" } : {}) }, body)
    : null;
  // Editorial's accent bar replaces the underline rule.
  const underline = editorial
    ? null
    : h("div", { display: "flex", width: centred ? "64px" : "96px", height: centred ? "6px" : "8px", borderRadius: "9999px", backgroundColor: b.accent, marginTop: spec.kind === "cover" ? "42px" : "34px" });

  const stack: El[] = [...(numberEl ? [numberEl] : []), headline, ...(bodyEl ? [bodyEl] : []), ...(underline ? [underline] : [])];
  const column = h("div", { display: "flex", flexDirection: "column", alignItems: centred ? "center" : "flex-start" }, ...stack);
  const middle = editorial
    ? h(
        "div",
        { display: "flex", flexDirection: "column", justifyContent: "center", flexGrow: 1, width: "100%" },
        // alignItems stretch makes the bar exactly as tall as the text block
        h(
          "div",
          { display: "flex", flexDirection: "row", alignItems: "stretch" },
          h("div", { display: "flex", width: "10px", borderRadius: "9999px", backgroundColor: b.accent, marginRight: "34px" }),
          column,
        ),
      )
    : h("div", { display: "flex", flexDirection: "column", justifyContent: "center", alignItems: centred ? "center" : "flex-start", flexGrow: 1, width: "100%" }, ...stack);

  // Bottom: a swipe cue on every non-final slide; the domain on the CTA.
  const swipe = h("div", { display: "flex", alignItems: "center", fontFamily: "Poppins", fontWeight: 600, fontSize: "28px", color: b.accent }, "Swipe →");
  const domain = h("div", { display: "flex", fontFamily: "Archivo Black", fontSize: "34px", letterSpacing: "0.3px", color: b.accent }, b.domain);
  const bottomJustify = centred ? "center" : isCta ? "flex-start" : "flex-end";
  const bottomRow = h("div", { display: "flex", justifyContent: bottomJustify, alignItems: "center", width: "100%" }, isCta ? domain : swipe);

  return h(
    "div",
    { position: "relative", display: "flex", flexDirection: "column", width: `${W}px`, height: `${H}px`, padding: `${padY}px 90px`, backgroundColor: "transparent", fontFamily: "Poppins" },
    ...layers,
    topRow,
    middle,
    bottomRow,
  );
}

export async function renderCarouselSlide(id: string, spec: CarouselSlideSpec): Promise<{ path: string; relPath: string; width: number; height: number }> {
  const b = brandDesignFor(spec.site);
  const { W, H } = carouselDims(spec.aspect);
  const svg = await satori(carouselTree(b, spec) as unknown as Parameters<typeof satori>[0], { width: W, height: H, fonts: await fonts() });
  const dir = path.join(MEDIA_ROOT, "banners", spec.site);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${id}.png`);
  const textLayer = await sharp(Buffer.from(svg)).png().toBuffer();
  const base = spec.bgImage
    ? await sharp(spec.bgImage).resize(W, H, { fit: "cover", position: "attention" }).toBuffer()
    : await sharp({ create: { width: W, height: H, channels: 4, background: b.base } }).png().toBuffer();
  await sharp(base).composite([{ input: textLayer, top: 0, left: 0 }]).png().toFile(file);
  return { path: file, relPath: path.relative(MEDIA_ROOT, file), width: W, height: H };
}

// The shared backdrop of a carousel is saved once at generation time so any single
// slide can later be re-rendered (edit text, reorder, change aspect) over the EXACT
// same image — no surprise photo swap on re-edit. Mirrors the banner `.src` cache.
export function carouselSrcPath(site: string, postId: string): string {
  return path.join(MEDIA_ROOT, "banners", site, `${postId}.carousel-src.png`);
}
