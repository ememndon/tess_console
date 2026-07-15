import path from "node:path";
import fs from "node:fs/promises";
import { CFG } from "./config.js";

// Animated HTML/CSS brand intro & outro, rendered in the browser at native
// resolution and recorded (far richer motion than ffmpeg text). Per-brand opt-in;
// brands without a template fall back to the ffmpeg slide. Calculatry is first.
const HTML_BRANDS = new Set(["calculatry", "resumehub", "checkinvest"]);
export function hasHtmlIntro(site: string): boolean {
  return HTML_BRANDS.has(site);
}

const TAGLINES: Record<string, string> = {
  calculatry: "200+ Calculators. Built-in AI Assistant",
  resumehub: "Build the Right Resume for Any Country",
  checkinvest: "Nigeria's Smartest Investment Calculator",
};

// Per-brand intro theme (background gradient + accent). Matches each site's real
// look — Calculatry is a dark navy→purple with a gold accent (per the brand banners).
// bg2 = bright center of the gradient, mid = midpoint, bg1 = dark edge, glow = the
// soft light pool behind the logo. Tuned so content sits on a vibrant, lifted area.
const THEME: Record<string, { bg1: string; bg2: string; mid: string; accent: string; glow: string }> = {
  // Navy → indigo-purple with gold accent (per the Calculatry brand banners).
  calculatry: { bg1: "#0A0A20", mid: "#221A4C", bg2: "#3C2E76", accent: "#F5C842", glow: "#5A3FA6" },
  // Deep navy → royal blue with an ORANGE accent — blue background contrasts cleanly
  // with the orange wordmark/eyebrow/domain text (owner preference over the old purple).
  resumehub: { bg1: "#041027", mid: "#0A2A6E", bg2: "#1D4ED8", accent: "#FF6A1A", glow: "#3B82F6" },
  // Deep green with a gold accent — matches the real logo (green tile + mint bars +
  // gold trend arrow, "Ng" in gold).
  checkinvest: { bg1: "#04140D", mid: "#0A4D33", bg2: "#0E7A4E", accent: "#E6B33A", glow: "#14B886" },
};

// Wordmark HTML (lets us style part of the name, e.g. gold "try" in Calculatry).
const WORDMARK: Record<string, (accent: string) => string> = {
  calculatry: (a) => `Calcula<span style="color:${a}">try</span>`,
  resumehub: (a) => `GlobalResume<span style="color:${a}">Hub</span>`,
  // Matches the real logo's wordmark treatment ("CheckInvest" + gold "Ng").
  checkinvest: (a) => `CheckInvest<span style="color:${a}">Ng</span>`,
};

// Bold brand monogram used until a real logo is dropped at media/assets/brand/<site>/.
// A confident gradient tile + heavy initial reads as an intentional mark — not the old
// generic four-square placeholder. Pure HTML/CSS (rendered in real Chromium).
function monogramHtml(initial: string, c1: string, c2: string): string {
  return `<div style="width:100%;height:100%;border-radius:26%;overflow:hidden;position:relative;
    background:linear-gradient(135deg, ${c1} 0%, ${c2} 100%);display:flex;align-items:center;justify-content:center;
    box-shadow:inset 0 0 0 .55vmin rgba(255,255,255,.22), 0 1.6vmin 3.4vmin rgba(0,0,0,.45)">
    <div style="position:absolute;top:-28%;left:-22%;width:95%;height:95%;border-radius:50%;background:rgba(255,255,255,.20);filter:blur(2.2vmin)"></div>
    <span style="font-family:'Archivo Black','Poppins',system-ui,sans-serif;font-size:12.5vmin;line-height:1;color:#fff;letter-spacing:-.3vmin;position:relative">${esc(initial)}</span>
  </div>`;
}

async function readFirst(dir: string, files: string[]): Promise<string | null> {
  for (const f of files) {
    try {
      return await fs.readFile(path.join(dir, f), "utf8");
    } catch {
      /* next */
    }
  }
  return null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Make any dropped inline SVG fill the logo box: strip hardcoded width/height on the
// root <svg> (e.g. a favicon's width="32") and force 100% + contain. The viewBox is
// kept, so artwork scales crisply to whatever size the layout gives it.
function normalizeSvg(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) => {
    const cleaned = tag.replace(/\s(?:width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    const withRatio = /preserveAspectRatio/i.test(cleaned)
      ? cleaned
      : cleaned.replace(/>$/, ' preserveAspectRatio="xMidYMid meet">');
    return withRatio.replace(/>$/, ' width="100%" height="100%">');
  });
}

async function brandAssets(site: string, theme: { bg2: string; accent: string }, fallbackName: string): Promise<{ logo: string; tagline: string; wordmark: string; fontFace: string; fontFamily: string }> {
  const dir = path.join(CFG.mediaRoot, "assets", "brand", site);
  const accent = theme.accent;

  const initial = (fallbackName.trim()[0] ?? "•").toUpperCase();
  let logo = monogramHtml(initial, theme.bg2, theme.accent);
  const svg = await readFirst(dir, ["logo.svg"]);
  if (svg) {
    logo = normalizeSvg(svg);
  } else {
    for (const ext of ["png", "webp", "jpg", "jpeg"]) {
      try {
        const buf = await fs.readFile(path.join(dir, `logo.${ext}`));
        const mime = ext === "jpg" ? "jpeg" : ext;
        logo = `<img src="data:image/${mime};base64,${buf.toString("base64")}" style="width:100%;height:100%;object-fit:contain" alt=""/>`;
        break;
      } catch {
        /* next */
      }
    }
  }

  const tagFile = await readFirst(dir, ["tagline.txt"]);
  const tagline = (tagFile?.trim() || TAGLINES[site] || "").slice(0, 70);
  const wordmark = WORDMARK[site] ? WORDMARK[site](accent) : esc(fallbackName);

  let fontFace = "";
  let fontFamily = "'Poppins', 'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
  for (const ext of ["woff2", "ttf", "otf"]) {
    try {
      const buf = await fs.readFile(path.join(dir, `font.${ext}`));
      const fmt = ext === "ttf" ? "truetype" : ext === "otf" ? "opentype" : "woff2";
      fontFace = `@font-face{font-family:'BrandFont';src:url(data:font/${ext};base64,${buf.toString("base64")}) format('${fmt}');font-weight:400 800;}`;
      fontFamily = "'BrandFont', " + fontFamily;
      break;
    } catch {
      /* no custom font */
    }
  }
  return { logo, tagline, wordmark, fontFamily, fontFace };
}

function page(opts: {
  kind: "intro" | "outro";
  bg1: string;
  bg2: string;
  mid: string;
  glow: string;
  accent: string;
  domain: string;
  tagline: string;
  feature: string; // eyebrow: what's being featured
  wordmark: string;
  logo: string;
  fontFamily: string;
  fontFace: string;
}): string {
  const cta = opts.kind === "outro" ? `<div class="cta">Try it free</div>` : "";
  // Display face for the wordmark/headline: a dropped-in BrandFont wins; otherwise the
  // heavy Archivo Black (same display face as the banners) for a bold, unified look.
  const hasBrandFont = opts.fontFamily.includes("BrandFont");
  const display = hasBrandFont ? opts.fontFamily : `'Archivo Black', ${opts.fontFamily}`;

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  ${opts.fontFace}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;overflow:hidden;background:${opts.bg1};font-family:${opts.fontFamily};color:#fff}
  /* Brighter, lifted gradient: a vibrant pool of light centered behind the content,
     fading to dark at the edges so the logo + text really pop. */
  .stage{position:fixed;inset:0;overflow:hidden;
    background:radial-gradient(95% 70% at 50% 50%, ${opts.bg2} 0%, ${opts.mid} 46%, ${opts.bg1} 100%)}
  .stage::before{content:"";position:absolute;inset:0;background:linear-gradient(130deg, ${opts.bg1}00 0%, ${opts.bg2}55 50%, ${opts.bg1}00 100%);background-size:220% 220%;animation:bg 9s ease-in-out infinite}
  @keyframes bg{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
  /* Giant ghost initial behind the content — editorial depth, very low contrast. */
  .ghost{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-8deg);
    font-family:${display};font-size:80vmin;line-height:1;color:#fff;opacity:.04;z-index:0;
    animation:ghostdrift 14s ease-in-out infinite;white-space:nowrap}
  @keyframes ghostdrift{0%,100%{transform:translate(-50%,-50%) rotate(-8deg) scale(1)}50%{transform:translate(-50%,-52%) rotate(-8deg) scale(1.04)}}
  .glow{position:absolute;border-radius:50%;filter:blur(70px);z-index:0}
  .g1{width:52vmin;height:52vmin;background:${opts.accent};top:6%;left:50%;transform:translateX(-50%);opacity:.16;animation:float1 8s ease-in-out infinite}
  .g2{width:60vmin;height:60vmin;background:${opts.glow};top:50%;left:50%;transform:translate(-50%,-50%);opacity:.4;animation:float2 10s ease-in-out infinite}
  @keyframes float1{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(2vmin)}}
  @keyframes float2{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(-50%,-54%)}}
  /* Absolutely-centered content block — guarantees true vertical+horizontal centering
     across 9:16, 1:1 and 16:9 (nothing drifts to the bottom). */
  .content{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100%;
    display:flex;flex-direction:column;align-items:center;text-align:center;padding:0 8vmin;z-index:1}
  .logo{width:20vmin;height:20vmin;opacity:0;transform:scale(.5) rotate(-10deg);
    animation:pop .9s cubic-bezier(.2,.9,.25,1.4) .15s forwards;filter:drop-shadow(0 1.6vmin 3.2vmin rgba(0,0,0,.5))}
  @keyframes pop{to{opacity:1;transform:scale(1) rotate(0)}}
  .name{margin-top:3vmin;font-family:${display};font-size:7.2vmin;font-weight:800;letter-spacing:-.35vmin;line-height:1;
    white-space:nowrap;text-shadow:0 .4vmin 2.4vmin rgba(0,0,0,.35);
    opacity:0;transform:translateY(4vmin);animation:rise .7s cubic-bezier(.2,.7,.2,1) .55s forwards}
  /* Accent underline that wipes in beneath the wordmark. */
  .rule{margin-top:2.4vmin;width:13vmin;height:1vmin;border-radius:99px;background:${opts.accent};
    transform:scaleX(0);transform-origin:center;animation:wipe .6s cubic-bezier(.2,.7,.2,1) .85s forwards;
    box-shadow:0 0 2.4vmin ${opts.accent}}
  @keyframes wipe{to{transform:scaleX(1)}}
  .tag{margin-top:3vmin;font-size:3.2vmin;font-weight:500;color:#ffffffe6;max-width:84vmin;
    opacity:0;transform:translateY(2vmin);animation:rise .7s ease 1s forwards}
  .cta{margin-top:4.4vmin;font-size:3.5vmin;font-weight:700;padding:1.7vmin 4.8vmin;border-radius:99px;
    background:linear-gradient(90deg, ${opts.bg2}, ${opts.accent});color:#fff;
    box-shadow:0 1.2vmin 3.2vmin ${opts.accent}66;
    opacity:0;transform:scale(.9);animation:pop2 .6s cubic-bezier(.2,.9,.25,1.4) 1.15s forwards}
  @keyframes pop2{to{opacity:1;transform:scale(1)}}
  .domain{margin-top:3.4vmin;font-size:2.9vmin;font-weight:700;letter-spacing:.15vmin;color:${opts.accent};
    opacity:0;animation:fade .6s ease 1.4s forwards}
  @keyframes fade{to{opacity:1}}
  @keyframes rise{to{opacity:1;transform:translateY(0)}}
</style></head>
<body><div class="stage">
  <div class="ghost">${esc((opts.wordmark.replace(/<[^>]+>/g, "").trim()[0] ?? "").toUpperCase())}</div>
  <div class="glow g1"></div><div class="glow g2"></div>
  <div class="content">
    <div class="logo">${opts.logo}</div>
    <div class="name">${opts.wordmark}</div>
    <div class="rule"></div>
    ${opts.tagline ? `<div class="tag">${esc(opts.tagline)}</div>` : ""}
    ${cta}
    <div class="domain">${esc(opts.domain)}</div>
  </div>
</div></body></html>`;
}

type Brand = { name: string; c1: string; c2: string; accent: string; domain: string };

async function build(kind: "intro" | "outro", site: string, brand: Brand, feature: string): Promise<string> {
  const theme = THEME[site] ?? { bg1: brand.c1, bg2: brand.c2, mid: brand.c1, accent: brand.accent, glow: brand.accent };
  const a = await brandAssets(site, theme, brand.name);
  return page({
    kind,
    bg1: theme.bg1,
    bg2: theme.bg2,
    mid: theme.mid,
    glow: theme.glow,
    accent: theme.accent,
    domain: brand.domain,
    tagline: a.tagline,
    feature,
    wordmark: a.wordmark,
    logo: a.logo,
    fontFamily: a.fontFamily,
    fontFace: a.fontFace,
  });
}

export function introHtml(site: string, brand: Brand, feature: string): Promise<string> {
  return build("intro", site, brand, feature);
}
export function outroHtml(site: string, brand: Brand): Promise<string> {
  return build("outro", site, brand, "");
}
