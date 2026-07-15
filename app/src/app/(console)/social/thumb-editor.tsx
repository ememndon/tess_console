"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Trash2, Type, Save, X, RotateCcw, Copy, ArrowUp, ArrowDown, Ban, Check, Circle, ArrowRight, CaseUpper, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { YouTubeThumb, ThumbLayer, ThumbTextLayer, ThumbAccentLayer, ThumbLayers, ThumbGraphicKind } from "@/lib/youtube/types";
import { saveThumbEdit } from "./youtube-actions";

// Interactive thumbnail editor. Loads the clean no-text base image and the
// generated text/accent layers, lets the owner drag/edit/add/recolour/resize text,
// add shapes, undo/redo, then exports a 1280x720 JPEG and saves it back.
// Self-hosted fonts (same TTFs the renderer uses) keep the export faithful.

const CW = 1280, CH = 720;
const BOX_PADX = 16, BOX_PADY = 6, BOX_RADIUS = 12;
const DEF_TRACK = -0.012; // default letter-spacing in em (matches the renderer's -12/1000)
const autoStroke = (fs: number) => Math.max(3, Math.round(fs * 0.05));

// Curated, commercial-safe (OFL/Apache) bold display fonts that suit thumbnails.
// Each TTF is self-hosted in /public/fonts and declared at weight 400 so the
// canvas export and the live preview use the exact same face.
const FONTS = [
  { family: "Archivo Black", file: "ArchivoBlack-Regular.ttf" },
  { family: "Anton", file: "Anton-Regular.ttf" },
  { family: "Bebas Neue", file: "BebasNeue-Regular.ttf" },
  { family: "Bangers", file: "Bangers-Regular.ttf" },
  { family: "Luckiest Guy", file: "LuckiestGuy-Regular.ttf" },
  { family: "Alfa Slab One", file: "AlfaSlabOne-Regular.ttf" },
  { family: "Titan One", file: "TitanOne-Regular.ttf" },
  { family: "Poppins", file: "Poppins-Bold.ttf" },
] as const;
const DEFAULT_FAMILY = "Archivo Black";
const FONT_CSS = FONTS.map(
  (f) => `@font-face{font-family:'${f.family}';src:url('/fonts/${f.file}') format('truetype');font-weight:400;font-display:block;}`,
).join("\n");

type Item = (ThumbTextLayer | ThumbAccentLayer) & { id: string };
const uid = () => Math.random().toString(36).slice(2, 9);

// Resolved per-text style values (defaults applied) used by BOTH the preview and
// the canvas export so they never drift.
function txt(t: ThumbTextLayer) {
  const display = t.uppercase ? (t.text || "").toUpperCase() : t.text || "";
  return {
    display,
    family: t.family || DEFAULT_FAMILY,
    track: typeof t.track === "number" ? t.track : DEF_TRACK,
    opacity: typeof t.opacity === "number" ? t.opacity : 1,
    rotation: t.rotation || 0,
    shadow: t.shadow ?? !t.box, // default: shadow on plain text, off when boxed
    strokeColor: t.strokeColor || "#0B0B0B",
    strokeWidth: typeof t.strokeWidth === "number" ? t.strokeWidth : autoStroke(t.fontSize),
  };
}

function mediaUrl(rel?: string) {
  return rel ? `/api/media/${rel}` : "";
}

// ── Accent geometry (shared by the SVG preview and the canvas export) ──────────
function AccentSvg({ item, scale }: { item: ThumbAccentLayer; scale: number }) {
  const S = item.size;
  const c = S / 2;
  const px = (item.cx - S / 2) * scale, py = (item.cy - S / 2) * scale, sz = S * scale;
  const common = { stroke: item.color, fill: "none", strokeWidth: 20, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let shape: React.ReactNode = null;
  if (item.kind === "redX") {
    const r = S * 0.42;
    shape = (<g {...common}><line x1={c - r} y1={c - r} x2={c + r} y2={c + r} /><line x1={c + r} y1={c - r} x2={c - r} y2={c + r} /></g>);
  } else if (item.kind === "greenCheck") {
    const r = S * 0.46;
    shape = <polyline {...common} points={`${c - r},${c + r * 0.05} ${c - r * 0.2},${c + r * 0.6} ${c + r},${c - r * 0.55}`} />;
  } else if (item.kind === "circle") {
    shape = <ellipse cx={c} cy={c} rx={S * 0.46} ry={S * 0.38} stroke={item.color} fill="none" strokeWidth={17} transform={`rotate(-8 ${c} ${c})`} />;
  } else if (item.kind === "arrow") {
    const dir = item.dir ?? 1, half = S * 0.46, tail = c - dir * half, tip = c + dir * half, neck = tip - dir * 30;
    shape = (<g><line x1={tail} y1={c} x2={neck} y2={c} {...common} /><polygon points={`${tip},${c} ${neck},${c - 22} ${neck},${c + 22}`} fill={item.color} /></g>);
  }
  return (
    <svg width={sz} height={sz} viewBox={`0 0 ${S} ${S}`} style={{ position: "absolute", left: px, top: py, overflow: "visible", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" }}>
      {shape}
    </svg>
  );
}

function drawAccent(ctx: CanvasRenderingContext2D, item: ThumbAccentLayer) {
  const S = item.size, c = S / 2;
  ctx.save();
  ctx.translate(item.cx - S / 2, item.cy - S / 2);
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  ctx.strokeStyle = item.color; ctx.fillStyle = item.color; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 20;
  if (item.kind === "redX") {
    const r = S * 0.42;
    ctx.beginPath(); ctx.moveTo(c - r, c - r); ctx.lineTo(c + r, c + r); ctx.moveTo(c + r, c - r); ctx.lineTo(c - r, c + r); ctx.stroke();
  } else if (item.kind === "greenCheck") {
    const r = S * 0.46;
    ctx.beginPath(); ctx.moveTo(c - r, c + r * 0.05); ctx.lineTo(c - r * 0.2, c + r * 0.6); ctx.lineTo(c + r, c - r * 0.55); ctx.stroke();
  } else if (item.kind === "circle") {
    ctx.lineWidth = 17; ctx.translate(c, c); ctx.rotate((-8 * Math.PI) / 180); ctx.beginPath(); ctx.ellipse(0, 0, S * 0.46, S * 0.38, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (item.kind === "arrow") {
    const dir = item.dir ?? 1, half = S * 0.46, tail = c - dir * half, tip = c + dir * half, neck = tip - dir * 30;
    ctx.beginPath(); ctx.moveTo(tail, c); ctx.lineTo(neck, c); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tip, c); ctx.lineTo(neck, c - 22); ctx.lineTo(neck, c + 22); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

const ACCENT_DEFAULT_COLOR: Record<ThumbGraphicKind, string> = {
  none: "#FFFFFF", redX: "#FF3B30", greenCheck: "#34C759", circle: "#FFD23F", arrow: "#FFD23F",
};

export function ThumbEditor({ thumb, postRef, onClose, onSaved }: { thumb: YouTubeThumb; postRef?: string; onClose: () => void; onSaved: (url: string, state: ThumbLayers) => void }) {
  const startItems = thumb.editState?.items ?? thumb.layers?.items ?? [];
  const [items, setItems] = useState<Item[]>(() => startItems.map((l) => ({ ...l, id: uid() })));
  const [past, setPast] = useState<Item[][]>([]);
  const [future, setFuture] = useState<Item[][]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const coalesce = useRef<{ key: string; t: number }>({ key: "", t: 0 });

  const scale = width > 0 ? width / CW : 0;
  const baseUrl = mediaUrl(thumb.editBase);
  const sel = items.find((i) => i.id === selId) ?? null;

  // Latest values for the (stable) keyboard handler to read without re-subscribing.
  const stateRef = useRef({ items, past, future, selId, editingId });
  stateRef.current = { items, past, future, selId, editingId };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── Undo / redo history ───────────────────────────────────────────────────
  // Snapshot the current items as an undo checkpoint. Rapid edits that share a key
  // (e.g. scrubbing one slider, or a single drag) collapse into ONE step.
  const checkpoint = useCallback((key: string) => {
    const now = Date.now();
    if (key && key === coalesce.current.key && now - coalesce.current.t < 700) { coalesce.current.t = now; return; }
    coalesce.current = { key, t: now };
    setPast((p) => [...p.slice(-49), stateRef.current.items]);
    setFuture([]);
  }, []);
  // A discrete, never-coalesced checkpoint (add / delete / duplicate / reorder / reset).
  const pushNow = useCallback(() => {
    coalesce.current = { key: "", t: 0 };
    setPast((p) => [...p.slice(-49), stateRef.current.items]);
    setFuture([]);
  }, []);
  const undo = useCallback(() => {
    const { items: cur, past: p } = stateRef.current;
    if (!p.length) return;
    setFuture((f) => [cur, ...f].slice(0, 50));
    setPast((q) => q.slice(0, -1));
    setItems(p[p.length - 1]);
    setSelId(null); setEditingId(null);
    coalesce.current = { key: "", t: 0 };
  }, []);
  const redo = useCallback(() => {
    const { items: cur, future: f } = stateRef.current;
    if (!f.length) return;
    setPast((p) => [...p.slice(-49), cur]);
    setFuture((q) => q.slice(1));
    setItems(f[0]);
    setSelId(null); setEditingId(null);
    coalesce.current = { key: "", t: 0 };
  }, []);

  // Mutate one item. Pass a histKey to record an undo checkpoint (control edits);
  // omit it for continuous drag moves (those checkpoint once on drag start).
  const patch = useCallback((id: string, p: Partial<Item>, histKey?: string) => {
    if (histKey !== undefined) checkpoint(histKey);
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...p } as Item) : it)));
  }, [checkpoint]);

  // Keyboard: undo/redo + arrow-key nudge. Subscribed once (stable callbacks).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      const inField = !!tgt && (/^(INPUT|SELECT|TEXTAREA)$/.test(tgt.tagName) || tgt.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        if (inField) return; // let the focused field do its own undo
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) { if (inField) return; e.preventDefault(); redo(); return; }
      const { selId: sId, editingId: eId } = stateRef.current;
      if (!sId || eId || inField) return;
      const step = e.shiftKey ? 20 : 4;
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const d = map[e.key];
      if (!d) return;
      e.preventDefault();
      checkpoint(`nudge:${sId}`);
      setItems((prev) => prev.map((it) => {
        if (it.id !== sId) return it;
        if (it.type === "accent") return { ...it, cx: it.cx + d[0], cy: it.cy + d[1] };
        return { ...it, left: (it as ThumbTextLayer).left + d[0], top: (it as ThumbTextLayer).top + d[1] };
      }));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, checkpoint]);

  // Drag (pointer-captured on the element). Disabled while editing text.
  function startDrag(e: React.PointerEvent, item: Item) {
    if (editingId === item.id) return;
    e.preventDefault();
    setSelId(item.id);
    checkpoint(`drag:${item.id}`); // one undo step for the whole drag
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY;
    const isAccent = item.type === "accent";
    const o = isAccent ? { cx: (item as ThumbAccentLayer).cx, cy: (item as ThumbAccentLayer).cy } : { left: (item as ThumbTextLayer).left, top: (item as ThumbTextLayer).top };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      patch(item.id, isAccent ? { cx: (o as { cx: number }).cx + dx, cy: (o as { cy: number }).cy + dy } : { left: (o as { left: number }).left + dx, top: (o as { top: number }).top + dy });
    };
    const up = () => { el.releasePointerCapture(e.pointerId); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }

  function addText() {
    pushNow();
    const it: Item = { id: uid(), type: "text", text: "NEW TEXT", left: 140, top: 300, fontSize: 120, fill: "#FFFFFF", stroke: false, box: null, family: DEFAULT_FAMILY, opacity: 1, rotation: 0 };
    setItems((p) => [...p, it]);
    setSelId(it.id);
    setEditingId(it.id);
  }
  function addShape(kind: ThumbGraphicKind) {
    pushNow();
    const it: Item = { id: uid(), type: "accent", kind, cx: CW / 2, cy: CH / 2, size: 220, color: ACCENT_DEFAULT_COLOR[kind], ...(kind === "arrow" ? { dir: 1 } : {}) };
    setItems((p) => [...p, it]);
    setSelId(it.id);
  }
  function del() { if (selId) { pushNow(); setItems((p) => p.filter((i) => i.id !== selId)); setSelId(null); setEditingId(null); } }
  function duplicate() {
    if (!sel) return;
    pushNow();
    const clone: Item = sel.type === "accent"
      ? { ...(sel as ThumbAccentLayer), id: uid(), cx: (sel as ThumbAccentLayer).cx + 30, cy: (sel as ThumbAccentLayer).cy + 30 }
      : { ...(sel as ThumbTextLayer), id: uid(), left: (sel as ThumbTextLayer).left + 30, top: (sel as ThumbTextLayer).top + 30 };
    setItems((p) => [...p, clone]); setSelId(clone.id);
  }
  function reorder(dir: 1 | -1) {
    pushNow();
    setItems((prev) => {
      const i = prev.findIndex((it) => it.id === selId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function reset() {
    pushNow();
    const s = thumb.layers?.items ?? [];
    setItems(s.map((l) => ({ ...l, id: uid() })));
    setSelId(null); setEditingId(null);
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      await Promise.all(FONTS.map((f) => (document as Document & { fonts: FontFaceSet }).fonts.load(`400 100px "${f.family}"`))).catch(() => {});
      const canvas = document.createElement("canvas");
      canvas.width = CW; canvas.height = CH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const img = new Image();
      img.src = baseUrl;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("base image failed")); });
      ctx.drawImage(img, 0, 0, CW, CH);
      for (const it of items) {
        if (it.type === "accent") { drawAccent(ctx, it); continue; }
        drawText(ctx, it as ThumbTextLayer);
      }
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const state: ThumbLayers = { w: CW, h: CH, items: items.map(({ id: _id, ...rest }) => rest as ThumbLayer) };
      const r = await saveThumbEdit({ relPath: thumb.relPath, dataUrl, ref: postRef, index: thumb.index, state });
      if (!r.ok) { setError(r.error ?? "Save failed."); return; }
      onSaved(r.url ?? mediaUrl(thumb.relPath), state);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // Canvas text draw — anchored + rotated identically to the preview.
  function drawText(ctx: CanvasRenderingContext2D, t: ThumbTextLayer) {
    const s = txt(t);
    ctx.font = `${t.fontSize}px "${s.family}"`;
    ctx.textBaseline = "top";
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${s.track * t.fontSize}px`;
    const w = ctx.measureText(s.display || " ").width;
    const ax = t.box ? t.left - BOX_PADX : t.left;
    const ay = t.box ? t.top - BOX_PADY : t.top;
    const tx = t.box ? BOX_PADX : 0, ty = t.box ? BOX_PADY : 0;
    ctx.save();
    ctx.globalAlpha = s.opacity;
    ctx.translate(ax, ay);
    if (s.rotation) ctx.rotate((s.rotation * Math.PI) / 180);
    if (t.box) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
      ctx.fillStyle = t.box;
      const bw = w + BOX_PADX * 2, bh = t.fontSize + BOX_PADY * 2;
      ctx.beginPath();
      if (typeof (ctx as CanvasRenderingContext2D & { roundRect?: unknown }).roundRect === "function") (ctx as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(0, 0, bw, bh, BOX_RADIUS);
      else ctx.rect(0, 0, bw, bh);
      ctx.fill();
      ctx.restore();
    }
    if (s.shadow && !t.box) { ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5; }
    if (t.stroke) { ctx.lineWidth = s.strokeWidth; ctx.strokeStyle = s.strokeColor; ctx.lineJoin = "round"; ctx.strokeText(s.display, tx, ty); }
    ctx.fillStyle = t.fill;
    ctx.fillText(s.display, tx, ty);
    ctx.restore();
  }

  const canEdit = !!(thumb.editBase && (thumb.layers || thumb.editState));

  function textStyle(t: ThumbTextLayer, selected: boolean, editing: boolean): React.CSSProperties {
    const s = txt(t);
    const ax = t.box ? t.left - BOX_PADX : t.left;
    const ay = t.box ? t.top - BOX_PADY : t.top;
    return {
      position: "absolute",
      left: ax * scale,
      top: ay * scale,
      transform: s.rotation ? `rotate(${s.rotation}deg)` : undefined,
      transformOrigin: "top left",
      opacity: s.opacity,
      fontFamily: `'${s.family}', sans-serif`,
      fontWeight: 400,
      fontSize: t.fontSize * scale,
      lineHeight: 1,
      color: t.fill,
      whiteSpace: "nowrap",
      textTransform: t.uppercase ? "uppercase" : "none",
      letterSpacing: `${s.track * t.fontSize * scale}px`,
      textShadow: s.shadow && !t.box ? `0 ${5 * scale}px ${14 * scale}px rgba(0,0,0,0.7)` : "none",
      WebkitTextStroke: t.stroke ? `${s.strokeWidth * scale}px ${s.strokeColor}` : undefined,
      paintOrder: "stroke fill",
      background: t.box || "transparent",
      padding: t.box ? `${BOX_PADY * scale}px ${BOX_PADX * scale}px` : 0,
      borderRadius: t.box ? BOX_RADIUS * scale : 0,
      boxShadow: t.box ? `0 ${4 * scale}px ${12 * scale}px rgba(0,0,0,0.45)` : "none",
      cursor: editing ? "text" : "move",
      userSelect: editing ? "text" : "none",
      outline: selected ? "2px dashed rgba(99,102,241,0.95)" : "none",
      outlineOffset: 2 * scale,
      touchAction: "none",
    };
  }

  const t = sel?.type === "text" ? (sel as ThumbTextLayer) : null;
  const a = sel?.type === "accent" ? (sel as ThumbAccentLayer) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-5" onMouseDown={onClose}>
      <style>{FONT_CSS}</style>
      {/* Opaque solid panel — inline bg + backdrop-filter:none beat the global Pulse
          "glass" rule that would otherwise make rounded-xl+border panels translucent. */}
      <div
        className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border shadow-2xl"
        style={{ background: "var(--popover, var(--background))", backdropFilter: "none", WebkitBackdropFilter: "none" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Type className="size-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Edit thumbnail</h3>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={undo} disabled={!past.length} title="Undo (Ctrl/Cmd+Z)" className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted disabled:opacity-40"><Undo2 className="size-4" /></button>
            <button onClick={redo} disabled={!future.length} title="Redo (Ctrl/Cmd+Shift+Z)" className="inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted disabled:opacity-40"><Redo2 className="size-4" /></button>
            <button onClick={onClose} className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
          </div>
        </div>

        {!canEdit ? (
          <p className="m-4 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-6 text-center text-sm text-amber-700 dark:text-amber-400">
            This thumbnail was made before the editor existed. Hit “Regenerate” on it once, then Edit will be available.
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* ── Tools (left) ─────────────────────────────────────────────── */}
            <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b p-4 text-xs md:w-80 md:border-b-0 md:border-r" style={{ background: "var(--background)" }}>
              {/* History */}
              <div className="flex items-center gap-1.5">
                <button onClick={undo} disabled={!past.length} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border hover:bg-muted disabled:opacity-40"><Undo2 className="size-3.5" /> Undo</button>
                <button onClick={redo} disabled={!future.length} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-md border hover:bg-muted disabled:opacity-40"><Redo2 className="size-3.5" /> Redo</button>
              </div>

              {/* Add */}
              <div>
                <p className="mb-1.5 font-semibold text-muted-foreground">Add</p>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={addText} className="h-8 gap-1"><Plus className="size-3.5" /> Text</Button>
                  <button onClick={() => addShape("redX")} title="Red X" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><Ban className="size-3.5 text-rose-500" /> X</button>
                  <button onClick={() => addShape("greenCheck")} title="Check" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><Check className="size-3.5 text-emerald-500" /></button>
                  <button onClick={() => addShape("circle")} title="Circle" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><Circle className="size-3.5 text-amber-500" /></button>
                  <button onClick={() => addShape("arrow")} title="Arrow" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><ArrowRight className="size-3.5 text-amber-500" /></button>
                </div>
              </div>

              {/* Selected — text controls */}
              {t && (
                <div className="flex flex-col gap-3 border-t pt-3">
                  <p className="font-semibold text-muted-foreground">Selected text</p>

                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Text</span>
                    <input value={t.text} onChange={(e) => patch(sel!.id, { text: e.target.value }, `text:${sel!.id}`)} className="h-8 rounded-md border bg-background px-2" />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Font</span>
                    <select value={t.family || DEFAULT_FAMILY} onChange={(e) => patch(sel!.id, { family: e.target.value }, `font:${sel!.id}`)} className="h-8 rounded-md border bg-background px-1">
                      {FONTS.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
                    </select>
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Size</span>
                    <div className="flex items-center gap-2">
                      <input type="range" min={24} max={300} value={t.fontSize} onChange={(e) => patch(sel!.id, { fontSize: Number(e.target.value) }, `size:${sel!.id}`)} className="flex-1" />
                      <span className="flex items-center gap-0.5">
                        <input type="number" min={8} max={400} value={Math.round(t.fontSize)} onChange={(e) => patch(sel!.id, { fontSize: Math.max(8, Math.min(400, Number(e.target.value) || 0)) }, `size:${sel!.id}`)} className="w-14 rounded-md border bg-background px-1 py-0.5 text-right" />
                        <span className="text-muted-foreground">px</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5">
                      <span className="text-muted-foreground">Color</span>
                      <input type="color" value={t.fill} onChange={(e) => patch(sel!.id, { fill: e.target.value }, `fill:${sel!.id}`)} className="h-7 w-9 rounded border bg-transparent p-0.5" />
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={!!t.uppercase} onChange={(e) => patch(sel!.id, { uppercase: e.target.checked }, `caps:${sel!.id}`)} /> <CaseUpper className="size-3.5" /> Caps
                    </label>
                  </div>

                  {/* Outline */}
                  <div className="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2">
                    <label className="flex items-center gap-1.5 font-medium">
                      <input type="checkbox" checked={!!t.stroke} onChange={(e) => patch(sel!.id, { stroke: e.target.checked }, `stroke:${sel!.id}`)} /> Outline
                    </label>
                    {t.stroke && (
                      <div className="flex items-center gap-2 pl-5">
                        <input type="color" value={t.strokeColor || "#0B0B0B"} onChange={(e) => patch(sel!.id, { strokeColor: e.target.value }, `strokecolor:${sel!.id}`)} className="h-7 w-9 rounded border bg-transparent p-0.5" />
                        <span className="text-muted-foreground">Width</span>
                        <input type="range" min={1} max={40} value={typeof t.strokeWidth === "number" ? t.strokeWidth : autoStroke(t.fontSize)} onChange={(e) => patch(sel!.id, { strokeWidth: Number(e.target.value) }, `strokewidth:${sel!.id}`)} className="flex-1" />
                        <span className="w-9 text-right">{Math.round(typeof t.strokeWidth === "number" ? t.strokeWidth : autoStroke(t.fontSize))}px</span>
                      </div>
                    )}
                  </div>

                  {/* Highlight box */}
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 font-medium">
                      <input type="checkbox" checked={!!t.box} onChange={(e) => patch(sel!.id, { box: e.target.checked ? "#FFD23F" : null, fill: e.target.checked ? "#0E0E0E" : "#FFFFFF" }, `box:${sel!.id}`)} /> Highlight
                    </label>
                    {t.box && <input type="color" value={t.box || "#FFD23F"} onChange={(e) => patch(sel!.id, { box: e.target.value }, `boxcolor:${sel!.id}`)} className="h-7 w-9 rounded border bg-transparent p-0.5" />}
                  </div>

                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={txt(t).shadow} onChange={(e) => patch(sel!.id, { shadow: e.target.checked }, `shadow:${sel!.id}`)} /> Drop shadow
                  </label>

                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Rotation <span className="text-foreground">{Math.round(txt(t).rotation)}°</span></span>
                    <input type="range" min={-45} max={45} value={txt(t).rotation} onChange={(e) => patch(sel!.id, { rotation: Number(e.target.value) }, `rot:${sel!.id}`)} />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Opacity <span className="text-foreground">{Math.round(txt(t).opacity * 100)}%</span></span>
                    <input type="range" min={0} max={100} value={Math.round(txt(t).opacity * 100)} onChange={(e) => patch(sel!.id, { opacity: Number(e.target.value) / 100 }, `opacity:${sel!.id}`)} />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Letter spacing <span className="text-foreground">{Math.round(txt(t).track * 1000)}</span></span>
                    <input type="range" min={-60} max={120} value={Math.round(txt(t).track * 1000)} onChange={(e) => patch(sel!.id, { track: Number(e.target.value) / 1000 }, `track:${sel!.id}`)} />
                  </div>
                </div>
              )}

              {/* Selected — accent controls */}
              {a && (
                <div className="flex flex-col gap-3 border-t pt-3">
                  <p className="font-semibold text-muted-foreground">Selected shape</p>
                  <label className="flex items-center gap-1.5">
                    <span className="text-muted-foreground">Color</span>
                    <input type="color" value={a.color} onChange={(e) => patch(sel!.id, { color: e.target.value }, `shapecolor:${sel!.id}`)} className="h-7 w-9 rounded border bg-transparent p-0.5" />
                  </label>
                  <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Size <span className="text-foreground">{Math.round(a.size)}px</span></span>
                    <input type="range" min={60} max={420} value={a.size} onChange={(e) => patch(sel!.id, { size: Number(e.target.value) }, `shapesize:${sel!.id}`)} />
                  </div>
                  {a.kind === "arrow" && (
                    <Button size="sm" variant="outline" onClick={() => patch(sel!.id, { dir: (a.dir ?? 1) * -1 }, `flip:${sel!.id}`)} className="h-8 w-fit">Flip direction</Button>
                  )}
                </div>
              )}

              {/* Arrange (any selection) */}
              {sel && (
                <div className="flex flex-wrap gap-1.5 border-t pt-3">
                  <button onClick={duplicate} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><Copy className="size-3.5" /> Duplicate</button>
                  <button onClick={() => reorder(1)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><ArrowUp className="size-3.5" /> Forward</button>
                  <button onClick={() => reorder(-1)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 hover:bg-muted"><ArrowDown className="size-3.5" /> Back</button>
                  <button onClick={del} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-rose-500 hover:bg-muted"><Trash2 className="size-3.5" /> Delete</button>
                </div>
              )}

              <div className="mt-auto flex items-center gap-2 border-t pt-3">
                <button onClick={reset} className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-muted-foreground hover:bg-muted"><RotateCcw className="size-3.5" /> Reset to generated</button>
              </div>
            </div>

            {/* ── Preview (right) ──────────────────────────────────────────── */}
            <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
              <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg border bg-black/40" style={{ aspectRatio: "16 / 9" }} onMouseDown={() => { setSelId(null); setEditingId(null); }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {baseUrl && <img src={baseUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover" draggable={false} />}
                {scale > 0 && items.map((it) =>
                  it.type === "accent" ? (
                    <div key={it.id} onPointerDown={(e) => startDrag(e, it)} onMouseDown={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, top: 0, cursor: "move", outline: selId === it.id ? "2px dashed rgba(99,102,241,0.95)" : "none" }}>
                      <AccentSvg item={it} scale={scale} />
                    </div>
                  ) : (
                    <div
                      key={it.id}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => startDrag(e, it)}
                      onDoubleClick={() => { setSelId(it.id); setEditingId(it.id); }}
                      contentEditable={editingId === it.id}
                      suppressContentEditableWarning
                      onBlur={(e) => { patch(it.id, { text: (e.currentTarget.textContent || "").replace(/\s+/g, " ").trim() || "TEXT" }, `textedit:${it.id}`); setEditingId(null); }}
                      style={textStyle(it as ThumbTextLayer, selId === it.id, editingId === it.id)}
                    >
                      {(it as ThumbTextLayer).text}
                    </div>
                  ),
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">Drag to move. Double-click text to edit. Arrow keys nudge (Shift = bigger). Ctrl/Cmd+Z to undo.</p>
              {error && <p className="text-xs text-rose-500">{error}</p>}
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Button onClick={save} disabled={saving} className="gap-1.5">{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? "Saving…" : "Save thumbnail"}</Button>
                <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
