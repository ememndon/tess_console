"use strict";
// Tess thumbnail-render service. Fabric.js lays BIG, punchy, varied title text over
// the AI scene — like a real YouTube thumbnail, not a tidy poster. No kicker/prefix
// words, no underline bars: just the title, with one key word emphasised (bright
// colour, a filled highlight box, or a coloured punch-line). Placement is decided
// by reading the scene so text never covers the face.

const fs = require("fs");
const express = require("express");
const { registerFont, createCanvas, loadImage } = require("canvas");

const FONT_DIR = process.env.FONT_DIR || "/fonts";
function reg(file, opts) {
  try { registerFont(`${FONT_DIR}/${file}`, opts); } catch (e) { console.error("font", file, e.message); }
}
reg("ArchivoBlack-Regular.ttf", { family: "Archivo Black" });
reg("Poppins-Bold.ttf", { family: "Poppins", weight: "bold" });
reg("DejaVuSans.ttf", { family: "DejaVu Sans" });

const fabric = require("fabric/node");

const W = 1280, H = 720;
const KEY = process.env.INTERNAL_SYNC_KEY || "";

const softShadow = () => new fabric.Shadow({ color: "rgba(0,0,0,0.7)", blur: 14, offsetX: 0, offsetY: 5 });
const glow = (color) => new fabric.Shadow({ color, blur: 18, offsetX: 0, offsetY: 0 });

function gradientRect(x, y, w, h, stops, horizontal) {
  return new fabric.Rect({
    left: x, top: y, width: w, height: h, selectable: false,
    fill: new fabric.Gradient({ type: "linear", coords: horizontal ? { x1: 0, y1: 0, x2: w, y2: 0 } : { x1: 0, y1: 0, x2: 0, y2: h }, colorStops: stops }),
  });
}

// Cinematic vignette: darken the edges/corners so the bright face pops and the eye
// is pulled to the centre. Cheap depth separation that doesn't need segmentation.
function vignette(canvas) {
  canvas.add(new fabric.Rect({
    left: 0, top: 0, width: W, height: H, selectable: false,
    fill: new fabric.Gradient({
      type: "radial",
      coords: { x1: W / 2, y1: H / 2, r1: H * 0.28, x2: W / 2, y2: H / 2, r2: W * 0.62 },
      colorStops: [
        { offset: 0, color: "rgba(0,0,0,0)" },
        { offset: 0.62, color: "rgba(0,0,0,0)" },
        { offset: 1, color: "rgba(0,0,0,0.5)" },
      ],
    }),
  }));
}

// Supporting graphic accent — drawn ONLY when the planner asked for one, and ONLY
// on side layouts (a centred face leaves no safe spot, so we skip it there to honour
// "never cover the face"). Lives in the upper part of the text column, opposite the
// subject, so it reinforces the story without touching the face.
function drawGraphic(canvas, graphic, place, palette) {
  const kind = graphic && graphic.kind;
  if (!kind || kind === "none") return null;
  if (place !== "left" && place !== "right") return null; // no safe zone over a centred face
  const S = 132;
  const cx = place === "right" ? W - 70 - S / 2 : 70 + S / 2;
  const cy = 120;
  const red = "#FF3B30", green = "#22C55E", accent = palette.accent || "#FFD23F";
  const SW = 20;
  let color = accent, dir;

  if (kind === "redX") {
    color = red;
    const r = S * 0.42;
    canvas.add(new fabric.Path(`M ${cx - r} ${cy - r} L ${cx + r} ${cy + r} M ${cx + r} ${cy - r} L ${cx - r} ${cy + r}`,
      { stroke: red, strokeWidth: SW, fill: "", strokeLineCap: "round", shadow: glow("rgba(255,59,48,0.6)") }));
  } else if (kind === "greenCheck") {
    color = green;
    const r = S * 0.46;
    canvas.add(new fabric.Path(`M ${cx - r} ${cy + r * 0.05} L ${cx - r * 0.2} ${cy + r * 0.6} L ${cx + r} ${cy - r * 0.55}`,
      { stroke: green, strokeWidth: SW, fill: "", strokeLineCap: "round", strokeLineJoin: "round", shadow: glow("rgba(34,197,94,0.6)") }));
  } else if (kind === "circle") {
    canvas.add(new fabric.Ellipse({ left: cx, top: cy, originX: "center", originY: "center", rx: S * 0.5, ry: S * 0.4, fill: "", stroke: accent, strokeWidth: SW * 0.85, angle: -8, shadow: glow("rgba(0,0,0,0.45)") }));
  } else if (kind === "arrow") {
    // Point toward the subject: left layout (face right) → arrow right; right layout (face left) → arrow left.
    dir = place === "left" ? 1 : -1;
    const half = S * 0.5, tail = cx - dir * half, tip = cx + dir * half, neck = tip - dir * 44;
    canvas.add(new fabric.Path(`M ${tail} ${cy} L ${neck} ${cy}`, { stroke: accent, strokeWidth: SW, fill: "", strokeLineCap: "round", shadow: glow("rgba(0,0,0,0.45)") }));
    canvas.add(new fabric.Path(`M ${tip} ${cy} L ${neck} ${cy - 30} L ${neck} ${cy + 30} Z`, { fill: accent, shadow: glow("rgba(0,0,0,0.45)") }));
  }
  return { type: "accent", kind, cx: Math.round(cx), cy: Math.round(cy), size: S, color, dir };
}

// Subtle film grain — kills the "too clean / obviously AI" look (a fine texture
// real photographs have). Drawn straight on the node canvas in overlay at very low
// alpha so it reads as texture, not noise.
function addGrain(nodeCanvas) {
  try {
    const nw = 426, nh = 240;
    const noise = createCanvas(nw, nh);
    const nctx = noise.getContext("2d");
    const img = nctx.createImageData(nw, nh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255; }
    nctx.putImageData(img, 0, 0);
    const ctx = nodeCanvas.getContext("2d");
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.globalCompositeOperation = "overlay";
    ctx.drawImage(noise, 0, 0, W, H);
    ctx.restore();
  } catch (e) { /* grain is cosmetic — never fail the render over it */ }
}

// Decide where text goes by finding the FACE. Faces are skin-toned, so we score
// each side by skin-tone pixels (weighted toward the top, where faces sit) plus a
// little detail/edge energy; text goes to the side with LESS subject, or the bottom
// when the subject is centred. This reliably keeps text off the face even when the
// person stands against a dark background (which fooled a luminance-only check).
const isSkin = (r, g, b) =>
  r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 12 && Math.max(r, g, b) - Math.min(r, g, b) > 15;

async function pickPlacement(scenePath) {
  try {
    const img = await loadImage(scenePath);
    const sw = 96, sh = 54;
    const c = createCanvas(sw, sh); const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0, sw, sh);
    const d = cx.getImageData(0, 0, sw, sh).data;
    // Find the FACE's horizontal centre: skin pixels in the UPPER ~60% only (so
    // pointing hands lower down don't fool it), weighted toward the very top.
    const yMax = Math.floor(sh * 0.6);
    let sumX = 0, tot = 0;
    for (let y = 0; y < yMax; y++) for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      if (isSkin(d[i], d[i + 1], d[i + 2])) { const w = 1 - y / sh; sumX += x * w; tot += w; }
    }
    if (tot < 8) return "lower"; // no clear face → bottom band (safe: faces are upper)
    const cxn = sumX / tot / sw; // face centre, 0..1
    if (cxn < 0.45) return "right"; // face on the left → text right
    if (cxn > 0.55) return "left"; // face on the right → text left
    return "lower"; // face centred → text along the bottom
  } catch { return "lower"; }
}

async function coverBackground(scenePath) {
  const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(scenePath).toString("base64")}`;
  const fImg = await fabric.FabricImage.fromURL(dataUrl);
  fImg.set({ originX: "center", originY: "center", left: W / 2, top: H / 2, selectable: false });
  const iw = fImg.width || W, ih = fImg.height || H;
  const scale = Math.max(W / iw, H / ih);
  fImg.scaleX = scale; fImg.scaleY = scale;
  return fImg;
}

// Which word to emphasise: a number, else a high-impact "power" word, else the longest.
const POWER = new Set(["FREE", "STOP", "WRONG", "BEST", "NEW", "SECRET", "NOW", "WIN", "FAST", "EASY", "HUGE", "NEVER", "MISTAKE", "MISTAKES", "HACK", "HACKS", "TRICK", "TRICKS", "TRUTH", "RICH", "MONEY", "VS", "PROVEN", "INSTANT", "BANNED", "WARNING", "ULTIMATE", "WTF", "AVOID", "BEFORE", "REAL"]);
function keyIndex(words) {
  for (let i = 0; i < words.length; i++) if (/\d/.test(words[i])) return i;
  for (let i = 0; i < words.length; i++) if (POWER.has(words[i].toUpperCase())) return i;
  let bi = 0; for (let i = 1; i < words.length; i++) if (words[i].length > words[bi].length) bi = i; return bi;
}

// The planner can name the word to emphasise; fall back to the heuristic above.
function emphasisIndex(words, emphasisWord) {
  if (emphasisWord) {
    const t = String(emphasisWord).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (t) { const i = words.findIndex((w) => w.replace(/[^A-Z0-9]/g, "") === t); if (i >= 0) return i; }
  }
  return keyIndex(words);
}

const measure = (txt, size) => { const t = new fabric.FabricText(txt, { fontFamily: "Archivo Black", fontSize: size, charSpacing: TRACK }); return { w: t.width, h: t.height }; };

// Slightly condensed tracking reads as bold thumbnail type, not a tidy caption.
const TRACK = -12; // 1/1000 em
// Supporting words render at this fraction of the emphasis word → strong hierarchy.
const SUP = 0.6;

// One text node, with a soft drop shadow and an OPTIONAL contrast outline. The
// outline (stroke) is industry-standard but only used when the planner says it
// complements this design — never on every thumbnail.
function textNode(txt, left, top, size, fill, outline) {
  const o = { left, top, fontFamily: "Archivo Black", fontSize: size, fill, charSpacing: TRACK, shadow: softShadow() };
  if (outline) { o.stroke = "#0B0B0B"; o.strokeWidth = Math.max(3, Math.round(size * 0.05)); o.paintFirst = "stroke"; o.strokeLineJoin = "round"; }
  return new fabric.FabricText(txt, o);
}

// Lay out the title as big word-blocks with a DRAMATIC size hierarchy: the key word
// is much larger than the supporting words (the way real high-CTR thumbnails read).
function drawHeadline(canvas, headline, { place, maxW, palette, style, emphasisWord, outline }) {
  const layers = []; // editable text-layer spec, returned for the editor
  const words = String(headline || "WATCH THIS").toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return layers;
  const ki = emphasisIndex(words, emphasisWord);
  const PAD = 16; // highlight-box padding

  const sizeAt = (base, i) => (i === ki ? base : Math.max(28, Math.round(base * SUP)));
  const wordW = (base, i) => measure(words[i], sizeAt(base, i)).w + (i === ki && style === "box" ? PAD * 2 : 0);

  // Largest emphasis-word size at which every word still fits the column width.
  let base = place === "lower" ? 172 : 152;
  const fits = (b) => words.every((_, i) => wordW(b, i) <= maxW);
  while (base > 60 && !fits(base)) base -= 4;

  const space = Math.round(base * SUP * 0.24);
  const items = words.map((w, i) => {
    const key = i === ki;
    const size = sizeAt(base, i);
    const m = measure(w, size);
    let color = palette.text, box = false;
    if (key && style === "box") box = true;
    else if (key && (style === "pop" || style === "punch")) color = palette.accent;
    return { w, size, color: box ? "#0E0E0E" : color, box, width: m.w + (box ? PAD * 2 : 0), height: m.h, key };
  });

  // Greedy wrap into lines.
  const lines = []; let cur = [], curW = 0;
  for (const it of items) { const add = (cur.length ? space : 0) + it.width; if (cur.length && curW + add > maxW) { lines.push(cur); cur = [it]; curW = it.width; } else { cur.push(it); curW += add; } }
  if (cur.length) lines.push(cur);

  // "punch" style: colour the entire line that holds the key word.
  if (style === "punch") {
    for (const ln of lines) { const hasKey = ln.some((it) => it.key); for (const it of ln) if (!it.box) it.color = hasKey ? palette.accent : palette.text; }
  }

  const lineH = (ln) => Math.max(...ln.map((it) => it.height));
  const gap = Math.round(base * 0.03);
  const totalH = lines.reduce((s, ln) => s + lineH(ln), 0) + gap * (lines.length - 1);
  let y = place === "lower" ? H - 54 - totalH : (H - totalH) / 2;
  const edge = place === "right" ? W - 64 : 64;

  for (const ln of lines) {
    const lw = ln.reduce((s, it) => s + it.width, 0) + space * (ln.length - 1);
    let x = place === "right" ? edge - lw : edge;
    const lh = lineH(ln);
    for (const it of ln) {
      const by = y + (lh - it.height); // bottom-align differently-sized words on a line
      if (it.box) canvas.add(new fabric.Rect({ left: x, top: by + it.height * 0.04, width: it.width, height: it.height * 0.92, rx: 12, ry: 12, fill: palette.accent, shadow: softShadow() }));
      const tleft = x + (it.box ? PAD : 0);
      canvas.add(textNode(it.w, tleft, by, it.size, it.color, outline && !it.box));
      layers.push({ type: "text", text: it.w, left: Math.round(tleft), top: Math.round(by), fontSize: it.size, fill: it.color, stroke: !!(outline && !it.box), box: it.box ? palette.accent : null, family: "Archivo Black" });
      x += it.width + space;
    }
    y += lh + gap;
  }
  return layers;
}

const nodeCanvasOf = (canvas) => (typeof canvas.getNodeCanvas === "function" ? canvas.getNodeCanvas() : canvas.lowerCanvasEl);

// Readability scrim on the text side only.
function addScrim(canvas, place) {
  if (place === "left") canvas.add(gradientRect(0, 0, 880, H, [{ offset: 0, color: "rgba(0,0,0,0.82)" }, { offset: 0.62, color: "rgba(0,0,0,0.28)" }, { offset: 1, color: "rgba(0,0,0,0)" }], true));
  else if (place === "right") canvas.add(gradientRect(W - 880, 0, 880, H, [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 0.38, color: "rgba(0,0,0,0.28)" }, { offset: 1, color: "rgba(0,0,0,0.82)" }], true));
  else canvas.add(gradientRect(0, 0, W, H, [{ offset: 0.4, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0.88)" }], false));
}

// Two passes so the editor has a clean backdrop AND editable layers:
//  pass 1 = scene + vignette + scrim + grain  →  the no-text base (written to basePath)
//  pass 2 = base + accent + text              →  the final JPG (returned)
// Text/accent objects are also returned as a layer spec the editor reconstructs.
async function compose(scenePath, spec, basePath) {
  const palette = Object.assign({ text: "#FFFFFF", accent: "#FFD23F" }, spec.palette || {});
  if (spec.accentColor) palette.accent = spec.accentColor; // planner may pick the accent
  const style = ["pop", "box", "punch"].includes(spec.style) ? spec.style : "pop";
  // Prefer the app's real-face placement; only guess from skin tone if it's absent.
  const place = ["left", "right", "lower"].includes(spec.place) ? spec.place : await pickPlacement(scenePath);
  const maxW = Number.isFinite(spec.maxW) && spec.maxW > 200 ? Math.round(spec.maxW) : (place === "lower" ? 1060 : 560);

  // Pass 1 — background + cinematic depth only (no text/accent).
  const c1 = new fabric.StaticCanvas(null, { width: W, height: H });
  c1.add(await coverBackground(scenePath));
  vignette(c1);
  addScrim(c1, place);
  c1.renderAll();
  const nc1 = nodeCanvasOf(c1);
  addGrain(nc1);
  const baseBuf = nc1.toBuffer("image/jpeg", { quality: 0.92 });
  if (basePath) { try { fs.writeFileSync(basePath, baseBuf); } catch (e) { console.error("base write", e.message); } }

  // Pass 2 — the grained base as the backdrop, then accent + headline on top.
  const c2 = new fabric.StaticCanvas(null, { width: W, height: H });
  const baseImg = await fabric.FabricImage.fromURL(`data:image/jpeg;base64,${baseBuf.toString("base64")}`);
  baseImg.set({ originX: "left", originY: "top", left: 0, top: 0, selectable: false });
  c2.add(baseImg);
  const items = [];
  const accent = spec.graphic ? drawGraphic(c2, spec.graphic, place, palette) : null;
  if (accent) items.push(accent);
  const texts = drawHeadline(c2, spec.headline, { place, maxW, palette, style, emphasisWord: spec.emphasisWord, outline: !!spec.outline });
  for (const t of texts) items.push(t);
  c2.renderAll();
  const buf = nodeCanvasOf(c2).toBuffer("image/jpeg", { quality: 0.9 });
  return { buf, layers: { w: W, h: H, items } };
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) => res.json({ ok: true }));
app.post("/compose", async (req, res) => {
  if (KEY && req.get("x-internal-key") !== KEY) return res.status(403).json({ ok: false, error: "forbidden" });
  const { scenePath, outPath, basePath, spec } = req.body || {};
  if (!scenePath || !outPath || !spec) return res.status(400).json({ ok: false, error: "scenePath, outPath, spec required" });
  if (!fs.existsSync(scenePath)) return res.status(404).json({ ok: false, error: "scene not found" });
  try {
    const { buf, layers } = await compose(scenePath, spec, basePath);
    fs.writeFileSync(outPath, buf);
    res.json({ ok: true, bytes: buf.length, layers });
  } catch (e) {
    console.error("compose error", e);
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});
// ── Cut-out composite style (prototype) ───────────────────────────────────────
// A "designed" thumbnail: we draw the background ourselves (brand colours + an
// angled accent panel), paste a background-removed SUBJECT cut-out pinned to one
// edge (with an optional white sticker border to hide any matte fringing, like the
// reference templates), and lay the headline on the clean side. Positioning is
// deterministic — the subject is ALWAYS exactly at the edge.

function designedBg(ctx, pal, side) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, pal.base); g.addColorStop(0.6, pal.mid || pal.base); g.addColorStop(1, pal.base);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // bold angled accent panel behind the subject side
  ctx.save();
  ctx.fillStyle = pal.accent; ctx.globalAlpha = 0.92;
  ctx.beginPath();
  if (side === "right") { ctx.moveTo(W * 0.66, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(W * 0.52, H); }
  else { ctx.moveTo(0, 0); ctx.lineTo(W * 0.34, 0); ctx.lineTo(W * 0.48, H); ctx.lineTo(0, H); }
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // a thin bright edge stripe on the panel for a crisp designed feel
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 6;
  ctx.beginPath();
  if (side === "right") { ctx.moveTo(W * 0.66, 0); ctx.lineTo(W * 0.52, H); }
  else { ctx.moveTo(W * 0.34, 0); ctx.lineTo(W * 0.48, H); }
  ctx.stroke(); ctx.restore();
  // gentle darkening on the text side for readability
  ctx.save();
  const og = ctx.createLinearGradient(0, 0, W, 0);
  if (side === "right") { og.addColorStop(0, "rgba(0,0,0,0.34)"); og.addColorStop(0.55, "rgba(0,0,0,0)"); }
  else { og.addColorStop(0.45, "rgba(0,0,0,0)"); og.addColorStop(1, "rgba(0,0,0,0.34)"); }
  ctx.fillStyle = og; ctx.fillRect(0, 0, W, H); ctx.restore();
}

function fitCutout(img, side, fill, anchor) {
  const f = fill || 1.0;
  const ar = img.width / img.height;
  let h = H * f, w = h * ar;
  if (w > W * 0.62) { w = W * 0.56; h = w / ar; } // very wide image → cap width
  const x = side === "right" ? W - w : 0;
  // "top": pin the top of the cut-out to the frame top so the whole HEAD stays in
  // frame (only shoulders may run off the bottom). Otherwise bottom-anchored.
  const y = anchor === "top" ? 0 : H - h;
  return { x, y, w, h };
}

function hexA(hex, a) {
  const c = String(hex || "#FFFFFF").replace("#", "");
  const v = c.length === 3 ? c.split("").map((x) => x + x).join("") : c;
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// A bright colour glow behind the subject so the face pops off a busy background
// (like the halo behind the person in high-energy thumbnails). Additive (screen).
function subjectGlow(ctx, side, color) {
  const cx = side === "right" ? W * 0.78 : W * 0.22, cy = H * 0.42;
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 430);
  g.addColorStop(0, hexA(color, 0.6)); g.addColorStop(0.5, hexA(color, 0.26)); g.addColorStop(1, hexA(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// Photographic background: cover-fit the FLUX scene, add a vignette + a readability
// scrim on the text side so the headline stays crisp over the photo.
async function drawPhotoBg(ctx, bgPath, textSide) {
  const bg = await loadImage(bgPath);
  const ar = bg.width / bg.height, car = W / H;
  let w, h;
  if (ar > car) { h = H; w = H * ar; } else { w = W; h = W / ar; }
  ctx.drawImage(bg, (W - w) / 2, (H - h) / 2, w, h);
  ctx.save();
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.45)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  if (textSide === "left") { g.addColorStop(0, "rgba(0,0,0,0.74)"); g.addColorStop(0.55, "rgba(0,0,0,0.1)"); }
  else { g.addColorStop(0.45, "rgba(0,0,0,0.1)"); g.addColorStop(1, "rgba(0,0,0,0.74)"); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// White sticker outline: a uniform white silhouette drawn in a ring behind the
// cut-out (hides matte fringing + matches the reference style). t = thickness px.
function whiteBorder(ctx, img, x, y, w, h, t) {
  const off = createCanvas(W, H);
  const o = off.getContext("2d");
  o.drawImage(img, x, y, w, h);
  o.globalCompositeOperation = "source-in";
  o.fillStyle = "#FFFFFF";
  o.fillRect(0, 0, W, H);
  const steps = 28;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
  for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; ctx.drawImage(off, Math.cos(a) * t, Math.sin(a) * t); }
  ctx.restore();
}

// Draws the headline (+ optional subhead) on the clean side and RETURNS the text
// layers (top-left anchored, same model the editor uses) so the thumbnail stays
// editable. Emphasis word is coloured (not resized) so the layer model stays simple.
function drawCutoutText(ctx, headline, subhead, textSide, pal, emphasisWord) {
  const layers = [];
  const words = String(headline || "WATCH THIS").toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) return layers;
  const ki = emphasisIndex(words, emphasisWord);
  const maxW = 560, leftEdge = 64, rightEdge = W - 64;
  const measure = (w, size) => { ctx.font = `${size}px "Archivo Black"`; return ctx.measureText(w).width; };
  const wrapAt = (size) => {
    const space = size * 0.26, out = []; let cur = [], curW = 0;
    for (let i = 0; i < words.length; i++) {
      const ww = measure(words[i], size), add = (cur.length ? space : 0) + ww;
      if (cur.length && curW + add > maxW) { out.push(cur); cur = [{ w: words[i], i, ww }]; curW = ww; }
      else { cur.push({ w: words[i], i, ww }); curW += add; }
    }
    if (cur.length) out.push(cur);
    return { lines: out, space };
  };
  const subLines = String(subhead || "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const subSize = 36, subGap = 46;
  const subBlock = subLines.length ? 26 + subLines.length * subGap : 0;
  let base = 150, wrapped = wrapAt(base);
  while (base > 44) {
    wrapped = wrapAt(base);
    const widthOk = words.every((w) => measure(w, base) <= maxW);
    const totalH = wrapped.lines.length * base * 1.06 + subBlock;
    if (widthOk && totalH <= H - 90) break;
    base -= 4;
  }
  const { lines, space } = wrapped;
  const lineH = base * 1.06;
  ctx.textBaseline = "top";
  let y = (H - (lines.length * lineH + subBlock)) / 2;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  for (const ln of lines) {
    const lw = ln.reduce((s, it) => s + it.ww, 0) + space * (ln.length - 1);
    let x = textSide === "left" ? leftEdge : rightEdge - lw;
    for (const it of ln) {
      ctx.font = `${base}px "Archivo Black"`;
      const fill = it.i === ki ? pal.accent : "#FFFFFF";
      ctx.fillStyle = fill;
      ctx.fillText(it.w, x, y);
      layers.push({ type: "text", text: it.w, left: Math.round(x), top: Math.round(y), fontSize: base, fill, stroke: false, box: null, family: "Archivo Black" });
      x += it.ww + space;
    }
    y += lineH;
  }
  if (subLines.length) {
    y += 26;
    for (const line of subLines) {
      const up = line.toUpperCase();
      ctx.font = `bold ${subSize}px "Poppins"`;
      const lw = ctx.measureText(up).width;
      const x = textSide === "left" ? leftEdge : rightEdge - lw;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(up, x, y);
      layers.push({ type: "text", text: up, left: Math.round(x), top: Math.round(y), fontSize: subSize, fill: "#FFFFFF", stroke: false, box: null, family: "Poppins" });
      y += subGap;
    }
  }
  ctx.restore();
  return layers;
}

app.post("/compose-cutout", async (req, res) => {
  if (KEY && req.get("x-internal-key") !== KEY) return res.status(403).json({ ok: false, error: "forbidden" });
    const { outPath, basePath, cutoutPath, side, headline, subhead, palette, border, bgPath, fill, emphasisWord, accentColor } = req.body || {};
  if (!outPath || !cutoutPath || !fs.existsSync(cutoutPath)) return res.status(400).json({ ok: false, error: "cutoutPath (existing) + outPath required" });
  try {
    const s = side === "left" || side === "right" ? side : "right";
    const textSide = s === "right" ? "left" : "right";
    const pal = Object.assign({ base: "#0B1020", mid: "#1A2240", accent: "#FF6A1A" }, palette || {});
    if (accentColor) pal.accent = accentColor;
    const usePhoto = bgPath && fs.existsSync(bgPath);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (usePhoto) await drawPhotoBg(ctx, bgPath, textSide);
    else designedBg(ctx, pal, s);
    // Colour halo behind the subject so the face pops off the busy background.
    subjectGlow(ctx, s, pal.accent);
    const img = await loadImage(cutoutPath);
    const { x, y, w, h } = fitCutout(img, s, fill, "top");
    if (border === true) whiteBorder(ctx, img, x, y, w, h, 8);
    // Soft drop shadow so the cut-out sits on the background instead of looking pasted.
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 24; ctx.shadowOffsetX = s === "right" ? -8 : 8; ctx.shadowOffsetY = 10;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
    // Pass 1 = everything except text → the editor's clean base.
    const baseBuf = canvas.toBuffer("image/jpeg", { quality: 0.92 });
    if (basePath) { try { fs.writeFileSync(basePath, baseBuf); } catch (e) { console.error("base write", e.message); } }
    // Pass 2 = text on top → final (+ editable layer spec).
    const items = drawCutoutText(ctx, headline, subhead, textSide, pal, emphasisWord);
    const buf = canvas.toBuffer("image/jpeg", { quality: 0.9 });
    fs.writeFileSync(outPath, buf);
    res.json({ ok: true, bytes: buf.length, layers: { w: W, h: H, items } });
  } catch (e) {
    console.error("compose-cutout error", e);
    res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

const PORT = process.env.PORT || 7100;
app.listen(PORT, "0.0.0.0", () => console.log(`thumb-worker on :${PORT}`));
