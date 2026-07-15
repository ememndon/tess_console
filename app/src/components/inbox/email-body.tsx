"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOff, ShieldCheck } from "lucide-react";

// Renders an email's HTML body safely inside a SANDBOXED IFRAME.
//
//  • The iframe carries `sandbox` WITHOUT `allow-scripts`, so the message
//    physically cannot run JavaScript — no <script>, no inline on* handlers, no
//    javascript: URLs, no meta-refresh. This is the real isolation boundary: even
//    if the HTML sanitizer below is bypassed (e.g. a mutation-XSS payload), there
//    is no script execution in the console's origin. `allow-same-origin` is kept
//    only so the parent can read the rendered height to auto-size the frame —
//    safe precisely because scripts are disabled (the dangerous combination is
//    allow-same-origin + allow-scripts, which we never grant). `allow-popups`
//    lets the user open a link in a new tab; without allow-top-navigation the
//    message cannot hijack the console tab.
//  • The HTML is still sanitized (defense in depth): <script>/<iframe>/<form>/
//    <meta>/etc. removed, on* handlers and javascript: URLs stripped.
//  • REMOTE content (tracking pixels, remote images/backgrounds/stylesheets) is
//    blocked by default — nothing is fetched until the admin clicks "Load images"
//    for a sender they trust. The app's CSP is a further line of defence.

const REMOTE = /^(?:https?:)?\/\//i;

function hasRemoteContent(html: string): boolean {
  return (
    /<img[^>]+src\s*=\s*["']?(?:https?:)?\/\//i.test(html) ||
    /<link[^>]+href\s*=\s*["']?https?:/i.test(html) ||
    /background(?:-image)?\s*:\s*url\(\s*["']?(?:https?:)?\/\//i.test(html) ||
    /\burl\(\s*["']?(?:https?:)?\/\//i.test(html) ||
    /\b(?:background|src|srcset)\s*=\s*["']?(?:https?:)?\/\//i.test(html)
  );
}

// Parse + neutralize the HTML. Returns the safe inner HTML for the iframe body.
function process(html: string, allowRemote: boolean): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Drop anything that can execute, navigate, or redirect the document.
  doc.querySelectorAll("script, object, embed, applet, base, form, iframe, frame, frameset, meta").forEach((el) => el.remove());

  doc.querySelectorAll<HTMLElement>("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) el.setAttribute(attr.name, "#");
    }
  });

  if (!allowRemote) {
    doc.querySelectorAll<HTMLElement>("img, video, audio, source, [background]").forEach((el) => {
      const src = el.getAttribute("src");
      if (src && REMOTE.test(src)) { el.setAttribute("data-blocked-src", src); el.removeAttribute("src"); }
      if (el.getAttribute("srcset")) { el.removeAttribute("srcset"); }
      const bg = el.getAttribute("background");
      if (bg && REMOTE.test(bg)) el.removeAttribute("background");
    });
    // Remote stylesheets + any url(remote) in inline styles / <style> blocks.
    doc.querySelectorAll('link[rel~="stylesheet"]').forEach((el) => el.remove());
    const stripUrls = (css: string) => css.replace(/url\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi, "none");
    doc.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
      const s = el.getAttribute("style") || "";
      if (/url\(\s*["']?(?:https?:)?\/\//i.test(s)) el.setAttribute("style", stripUrls(s));
    });
    doc.querySelectorAll("style").forEach((el) => {
      if (el.textContent && /url\(\s*["']?(?:https?:)?\/\//i.test(el.textContent)) el.textContent = stripUrls(el.textContent);
    });
  }

  // Links always open in a new tab with no referrer leakage.
  doc.querySelectorAll("a[href]").forEach((a) => {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer nofollow");
  });

  return doc.body.innerHTML;
}

const DOC_STYLE = `
  html,body{ margin:0; padding:0; }
  .wrap{ background:#fff; color:#111; border-radius:8px; padding:14px 16px;
    font:14px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    word-break:break-word; overflow-wrap:anywhere; }
  .wrap img{ max-width:100%; height:auto; }
  .wrap a{ color:#2563eb; }
  .wrap table{ max-width:100%; }
  .wrap pre{ white-space:pre-wrap; }
`;

function buildSrcDoc(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${DOC_STYLE}</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

export function EmailBody({ html, text }: { html?: string | null; text?: string | null }) {
  const trimmed = (html ?? "").trim();
  const useHtml = trimmed.length > 0 && /<[a-z!/][\s\S]*>/i.test(trimmed);

  if (!useHtml) {
    return (
      <pre className="redact-strong whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground/90">
        {(text ?? "").trim() || "(empty message)"}
      </pre>
    );
  }
  return <HtmlFrame html={trimmed} />;
}

function HtmlFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [allowRemote, setAllowRemote] = useState(false);
  const blockable = useMemo(() => hasRemoteContent(html), [html]);
  const srcDoc = useMemo(() => buildSrcDoc(process(html, allowRemote)), [html, allowRemote]);
  const [height, setHeight] = useState(120);

  // Auto-size to the rendered content. Safe to read contentDocument because the
  // frame is same-origin (sandbox allow-same-origin) — and harmless because no
  // script runs inside it.
  const measure = useCallback(() => {
    try {
      const doc = ref.current?.contentDocument;
      const h = doc ? Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0) : 0;
      if (h) setHeight(Math.max(80, h));
    } catch {
      /* cross-origin or detached — ignore */
    }
  }, []);

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    let ro: ResizeObserver | undefined;
    const onLoad = () => {
      measure();
      try {
        const body = f.contentDocument?.body;
        if (body && "ResizeObserver" in window) {
          ro = new ResizeObserver(() => measure());
          ro.observe(body);
        }
      } catch {
        /* ignore */
      }
    };
    f.addEventListener("load", onLoad);
    return () => {
      f.removeEventListener("load", onLoad);
      ro?.disconnect();
    };
  }, [measure, srcDoc]);

  return (
    <div className="flex flex-col gap-2">
      {blockable && !allowRemote && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <ImageOff className="size-3.5 shrink-0" />
          <span className="flex-1">Remote images and content are blocked to protect your privacy.</span>
          <button
            onClick={() => setAllowRemote(true)}
            className="shrink-0 rounded bg-amber-500/20 px-2 py-1 font-medium text-amber-800 transition-colors hover:bg-amber-500/30 dark:text-amber-200"
          >
            Load images
          </button>
        </div>
      )}
      {blockable && allowRemote && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <ShieldCheck className="size-3.5" /> Remote content loaded.
        </div>
      )}
      <iframe
        ref={ref}
        title="Email message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        className="redact-strong w-full rounded-lg border bg-white"
        style={{ height }}
      />
    </div>
  );
}
