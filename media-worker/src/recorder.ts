import path from "node:path";
import fs from "node:fs/promises";
import { chromium, type Locator, type Page } from "playwright";
import { FORMATS, type FormatKey } from "./config.js";
import { ffmpeg, ffprobeDuration } from "./ffmpeg.js";
import type { BBox, DemoLocator, TimedScene } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const reOf = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

// An animated fake cursor, injected before page scripts on every navigation, so the
// recording shows a human-like pointer gliding to each control (Playwright's real
// cursor isn't captured in video). A click pulse adds tactile feedback.
const CURSOR_SCRIPT = `
(() => {
  if (window.__tessCursorReady) return;
  window.__tessCursorReady = true;
  var curX = 40, curY = 40, animId = 0, seq = 0;
  const add = () => {
    if (document.getElementById('__tess_cursor')) return;
    const c = document.createElement('div');
    c.id = '__tess_cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;will-change:transform;transform:translate(40px,40px);';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 3l14 7-6 1.5L9 18 5 3z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
  };
  const paint = (x, y) => { const c = document.getElementById('__tess_cursor'); if (c) c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  // Instant placement — keeps cursor continuity across page loads (re-asserted by the recorder after a goto).
  window.__tessMove = (x, y) => { if (animId) { cancelAnimationFrame(animId); animId = 0; } curX = x; curY = y; paint(x, y); };
  const ease = (t) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
  // Human-like glide: a curved path (quadratic bezier with a gentle alternating bow),
  // duration scaled to the distance, and slow-fast-slow easing. Driven per animation
  // frame so the screencast captures it smoothly. Returns a promise the recorder awaits,
  // so the click fires only once the pointer has actually arrived.
  window.__tessMoveTo = (x, y) => new Promise((res) => {
    if (animId) { cancelAnimationFrame(animId); animId = 0; }
    const sx = curX, sy = curY, dx = x - sx, dy = y - sy, dist = Math.hypot(dx, dy);
    if (dist < 2) { curX = x; curY = y; paint(x, y); return res(); }
    const dur = Math.max(480, Math.min(1300, 360 + dist * 0.85));
    seq++;
    const bow = Math.min(64, dist * 0.13) * (seq % 2 ? 1 : -1);
    const nx = -dy / dist, ny = dx / dist;
    const cx = sx + dx * 0.5 + nx * bow, cy = sy + dy * 0.5 + ny * bow;
    var t0 = 0;
    const step = (ts) => {
      if (!t0) t0 = ts;
      var p = (ts - t0) / dur; if (p > 1) p = 1;
      const e = ease(p), u = 1 - e;
      const mx = u*u*sx + 2*u*e*cx + e*e*x, my = u*u*sy + 2*u*e*cy + e*e*y;
      curX = mx; curY = my; paint(mx, my);
      if (p < 1) { animId = requestAnimationFrame(step); }
      else { animId = 0; curX = x; curY = y; paint(x, y); res(); }
    };
    animId = requestAnimationFrame(step);
  });
  window.__tessPulse = () => {
    const c = document.getElementById('__tess_cursor'); if (!c) return;
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;border-radius:50%;border:3px solid rgba(37,99,235,.8);z-index:2147483646;pointer-events:none;transform:translate(' + curX + 'px,' + curY + 'px) scale(.3);opacity:.9;transition:transform .5s ease-out,opacity .5s ease-out;';
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'translate(' + curX + 'px,' + curY + 'px) scale(1.6)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  };
  window.__tessFlash = (sx, sy, sw, sh) => {
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;left:'+sx+'px;top:'+sy+'px;width:'+sw+'px;height:'+sh+'px;border:3px solid rgba(37,99,235,.9);border-radius:10px;box-shadow:0 0 0 4px rgba(37,99,235,.15);z-index:2147483645;pointer-events:none;transition:opacity .4s;opacity:1;';
    document.documentElement.appendChild(b);
    setTimeout(() => { b.style.opacity = '0'; }, 1400);
    setTimeout(() => b.remove(), 1900);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
`;

// Built-in adblock for captures. Our sites (will) run ads; ads have no place in a
// demo video — they slow the page, cause layout shift mid-capture, and look unprofessional.
// 1) Block the ad/tracker networks so nothing is fetched. 2) Collapse any ad container
// so a blocked slot doesn't leave an empty gap. 3) Send `x-tess-capture: 1` on the page
// navigation so a site can additionally hide ads/banners/widgets server-side (capture mode).
// Applies to EVERY capture (all sites), not just one.
const AD_HOSTS = [
  "googlesyndication.com", "doubleclick.net", "googleadservices.com", "adservice.google.",
  "pagead2.", "amazon-adsystem.com", "adnxs.com", "rubiconproject.com", "pubmatic.com",
  "openx.net", "criteo.", "taboola.com", "outbrain.com", "media.net", "adsterra.com",
  "propellerads.com", "popads.net", "ad.doubleclick.net", "securepubads.g.doubleclick.net",
];

const HIDE_ADS_CSS =
  'ins.adsbygoogle,[id*="google_ads"],[id^="div-gpt-ad"],[class*="adsbygoogle"],[class*="ad-slot"],' +
  '[class*="ad-container"],[class*="ad-unit"],[class*="ad-wrapper"],[data-ad-slot],[data-ad-client],' +
  'iframe[src*="googlesyndication"],iframe[src*="doubleclick"],iframe[id*="google_ads"],' +
  'iframe[aria-label="Advertisement"]{display:none!important}';

// Capture-mode signal for STATIC sites (e.g. GitHub Pages) that can't read the
// x-tess-capture request header at render time. Set before page scripts run, on
// every navigation, so the site's own JS can self-skip ads/banners/widgets. Not
// user-shareable (a normal visitor never has this set); Tess controls it.
const CAPTURE_FLAG_SCRIPT = `
(() => {
  try { window.__tessCapture = true; } catch (e) {}
  try { localStorage.setItem('tess-capture', '1'); } catch (e) {}
})();
`;

// Per-pass override for the Inbox/Outreach showcase sections: they are filmed against
// fabricated sample data that is SAFE to show legibly, so the capture-mode .redact blur
// must be lifted. The app's root-layout inline script reads this flag and adds the
// html.tess-no-redact class (which un-blurs .redact / .redact-strong). Injected ONLY when
// the scenario sets noRedact, so real-PII sections keep the blur.
const NO_REDACT_FLAG_SCRIPT = `
(() => {
  try { window.__tessNoRedact = true; } catch (e) {}
  try { localStorage.setItem('tess-no-redact', '1'); } catch (e) {}
})();
`;

// Collapse the Tess chat panel before the app mounts, for content-heavy sections that
// need the wider main view (owner request). The panel reads its open/closed state from
// the persisted `tess_panel` key (open="open"/absent, collapsed="closed"), so seeding
// "closed" here makes it render as the narrow rail from the first frame. Injected only
// when the scenario sets panelCollapsed; sections where the chat IS the subject stay open.
const PANEL_COLLAPSE_SCRIPT = `
(() => {
  try { localStorage.setItem('tess_panel', 'closed'); } catch (e) {}
})();
`;

// Injected before page scripts on every navigation so blocked ad slots collapse early.
const HIDE_ADS_SCRIPT = `
(() => {
  const css = ${JSON.stringify(HIDE_ADS_CSS)};
  const inject = () => {
    if (document.getElementById('__tess_no_ads')) return;
    const st = document.createElement('style');
    st.id = '__tess_no_ads';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  };
  inject();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
})();
`;

async function resolveLocator(page: Page, t: DemoLocator, requireVisible: boolean): Promise<Locator | null> {
  const cands: Locator[] = [];
  if (t.testId) cands.push(page.getByTestId(t.testId));
  if (t.label) cands.push(page.getByLabel(reOf(t.label)));
  if (t.placeholder) cands.push(page.getByPlaceholder(reOf(t.placeholder)));
  if (t.role && t.name) cands.push(page.getByRole(t.role as Parameters<Page["getByRole"]>[0], { name: reOf(t.name) }));
  if (t.text) cands.push(page.getByText(reOf(t.text)));
  if (t.css) cands.push(page.locator(t.css));
  for (const c of cands) {
    const loc = t.nth != null ? c.nth(t.nth) : c.first();
    try {
      if ((await loc.count()) === 0) continue;
      if (!requireVisible || (await loc.isVisible())) return loc;
    } catch {
      /* try next strategy */
    }
  }
  // Heuristic fallback: scan visible form controls for one whose label/placeholder/
  // nearby text matches the hint — handles fields without proper <label for> wiring.
  return domFindControl(page, t.label || t.placeholder || t.name || t.text || "");
}

// Tag the best-matching visible form control with data-tess-t and return a locator
// for it. Prefers strong signals (aria-label/placeholder/name/id/associated label)
// over proximity text (preceding siblings / parent).
async function domFindControl(page: Page, term: string): Promise<Locator | null> {
  const q = term.trim().toLowerCase();
  if (!q) return null;
  // Passed as a raw string (not a transpiled function) so esbuild/tsx's keepNames
  // helper (__name) is never referenced inside the browser context.
  const expr = `(() => {
    var needle = ${JSON.stringify(q)};
    function strongAttr(el){ return [el.getAttribute('aria-label'),el.getAttribute('placeholder'),el.getAttribute('name'),el.id,el.getAttribute('title')].filter(Boolean).join(' ').toLowerCase(); }
    function labelText(el){ var s=''; var id=el.id; if(id){ var sel='label[for="'+((window.CSS&&CSS.escape)?CSS.escape(id):id)+'"]'; var l=document.querySelector(sel); if(l) s+=' '+(l.textContent||''); } var wl=el.closest('label'); if(wl) s+=' '+(wl.textContent||''); return s.toLowerCase(); }
    function nearText(el){ var s=''; var p=el.previousElementSibling, h=0; while(p&&h<3){ s+=' '+(p.textContent||''); p=p.previousElementSibling; h++; } if(el.parentElement) s+=' '+(el.parentElement.textContent||''); return s.toLowerCase(); }
    function visible(el){ var r=el.getBoundingClientRect(); return r.width>4 && r.height>4; }
    document.querySelectorAll('[data-tess-t]').forEach(function(e){ e.removeAttribute('data-tess-t'); });
    var ctrls = Array.prototype.slice.call(document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]),select,textarea'));
    var best=null, bestScore=-1;
    for (var i=0;i<ctrls.length;i++){ var el=ctrls[i]; if(!visible(el)) continue;
      var si=(strongAttr(el)+' '+labelText(el)).indexOf(needle);
      var ni=nearText(el).indexOf(needle);
      var score = si>=0 ? 3000-si : (ni>=0 ? 1000-Math.min(ni,900) : -1);
      if(score>bestScore){ bestScore=score; best=el; }
    }
    if(best && bestScore>=0){ best.setAttribute('data-tess-t','1'); return true; }
    return false;
  })()`;
  const ok = await page.evaluate(expr);
  if (!ok) return null;
  const loc = page.locator('[data-tess-t="1"]');
  return (await loc.count()) ? loc : null;
}

// Best-effort cookie/consent dismissal so banners don't cover the lower third.
// Clicks EVERY matching dismiss button (the page shows both a cookie bar and a
// "bookmark this" hint), and never clicks Decline.
async function dismissConsent(page: Page): Promise<boolean> {
  const labels = [/^accept all$/i, /^allow all$/i, /^accept$/i, /^i agree$/i, /^agree$/i, /^got it$/i, /^ok$/i];
  let clicked = false;
  for (const re of labels) {
    try {
      const b = page.getByRole("button", { name: re }).first();
      if ((await b.count()) && (await b.isVisible())) {
        await b.click({ timeout: 1500 });
        await sleep(300);
        clicked = true;
      }
    } catch {
      /* try next label */
    }
  }
  return clicked;
}

// A neutral box around the viewport centre — the fallback zoom target when no single
// prominent element stands out.
const centerBox = (F: { vw: number; vh: number }): BBox => ({ x: F.vw * 0.18, y: F.vh * 0.26, width: F.vw * 0.64, height: F.vh * 0.46 });

// Find a prominent on-screen element (heading / image / card / button near the centre)
// to push into for an emphasis zoom. Returns its viewport-relative box, or null.
async function findEmphasisBox(page: Page): Promise<BBox | null> {
  const expr = `(() => {
    var vw = window.innerWidth, vh = window.innerHeight;
    var els = Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3,img,svg,button,[class*=card],[class*=feature],[class*=hero],[class*=price]'));
    var best=null, bestScore=-1;
    for (var i=0;i<els.length;i++){ var r=els[i].getBoundingClientRect();
      if (r.width < vw*0.2 || r.height < 36) continue;            // too small to feature
      if (r.top > vh*0.82 || r.bottom < vh*0.18) continue;        // not really in view
      if (r.width >= vw*0.99 && r.height >= vh*0.92) continue;    // basically the whole page
      var cy=(r.top+r.bottom)/2; var dist=Math.abs(cy-vh/2);
      var area=Math.min(r.width,vw)*Math.min(r.height,vh);
      var score=area - dist*vw;                                   // big AND near centre
      if (score>bestScore){ bestScore=score; best=r; }
    }
    if(!best) return null;
    var x=Math.max(0,best.left), y=Math.max(0,best.top);
    return { x:x, y:y, width:Math.min(best.width, vw-x), height:Math.min(best.height, vh-y) };
  })()`;
  return (await page.evaluate(expr).catch(() => null)) as BBox | null;
}

async function moveCursorTo(page: Page, x: number, y: number): Promise<void> {
  // __tessMoveTo animates over a distance-scaled duration and resolves on arrival;
  // page.evaluate awaits that promise, so the pointer has landed before we click.
  await page
    .evaluate(([px, py]) => (window as unknown as { __tessMoveTo?: (a: number, b: number) => Promise<void> }).__tessMoveTo?.(px, py), [x, y])
    .catch(() => {});
  await sleep(70);
}

// Instant (non-animated) placement — used to restore cursor continuity after a page
// load re-injects the cursor at its default corner.
async function placeCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([px, py]) => (window as unknown as { __tessMove?: (a: number, b: number) => void }).__tessMove?.(px, py), [x, y]).catch(() => {});
}

async function pulse(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __tessPulse?: () => void }).__tessPulse?.());
}

// Scroll an element to the viewport CENTER within its REAL scroll container (short
// elements) or align its top (tall ones). Native scrollIntoView so it moves the
// console's inner <main>, not the window (document.body has maxScroll=0).
async function scrollCenter(loc: Locator): Promise<void> {
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await loc
    .evaluate((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const vh = window.innerHeight;
      const block: ScrollLogicalPosition = r.height > vh * 0.7 ? "start" : "center";
      (el as HTMLElement).scrollIntoView({ block, inline: "nearest", behavior: "auto" });
    })
    .catch(() => {});
}

// srcOffsetsMs[i] = the ACTUAL position (ms from recording start) where scene i began,
// so compose can cut each segment from where its content really is — not from a planned
// offset that drifts when a scroll/load runs long. This is what keeps footage in sync
// with the narration.
export type RecordResult = { videoPath: string; offsetMs: number; bboxes: (BBox | null)[]; shots: string[]; srcOffsetsMs: number[] };

// Record one format. The body timeline (per-scene durMs) is identical across formats
// — page load happens in an UNTIMED pre-roll, then each scene is held to exactly its
// budgeted duration — so the single VO/caption track lines up in all three outputs.
export async function recordFormat(
  scenario: { url: string; scenes: TimedScene[] },
  fmt: FormatKey,
  workDir: string,
  opts: { primary: boolean; mediaRoot: string; shotRelDir: string; jobId: string; cookies?: { name: string; value: string }[]; grade?: boolean; noRedact?: boolean; panelCollapsed?: boolean },
): Promise<RecordResult> {
  const F = FORMATS[fmt];
  const dsf = F.dsf ?? 1;
  const framesDir = path.join(workDir, `frames_${fmt.replace(":", "x")}`);
  await fs.mkdir(framesDir, { recursive: true });

  // Capture via CDP screencast at `dsf`× device pixels (crisp) — Playwright's video
  // recorder ignores deviceScaleFactor, so this is the only way to get supersampled,
  // non-upscaled footage (esp. the narrow 9:16 mobile layout). We assemble the frames
  // and downscale to w×h afterwards.
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: F.vw, height: F.vh },
    isMobile: F.isMobile,
    hasTouch: F.isMobile,
    deviceScaleFactor: dsf,
  });
  await context.addInitScript(CURSOR_SCRIPT);
  await context.addInitScript(CAPTURE_FLAG_SCRIPT);
  if (opts.noRedact) await context.addInitScript(NO_REDACT_FLAG_SCRIPT);
  if (opts.panelCollapsed) await context.addInitScript(PANEL_COLLAPSE_SCRIPT);
  await context.addInitScript(HIDE_ADS_SCRIPT);

  // Authenticated capture (console showcase tours): session cookie minted by the
  // app is set before any navigation, so the tour opens straight into the console.
  if (opts.cookies?.length) {
    await context.addCookies(opts.cookies.map((c) => ({ name: c.name, value: c.value, url: scenario.url })));
  }

  // Adblock + capture signal. Block ad/tracker networks; tag the page navigation
  // with x-tess-capture so the site can hide ads/banners/widgets in capture mode.
  // The header rides only on document loads (no CORS preflight on those), never on
  // third-party XHR/fetch, so it can't break the page's own API calls.
  await context.route("**/*", (route) => {
    const req = route.request();
    if (AD_HOSTS.some((h) => req.url().includes(h))) {
      route.abort().catch(() => {});
      return;
    }
    if (req.resourceType() === "document") {
      route.continue({ headers: { ...req.headers(), "x-tess-capture": "1" } }).catch(() => {});
      return;
    }
    route.continue().catch(() => {});
  });

  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  const bboxes: (BBox | null)[] = [];
  const shots: string[] = [];
  const srcOffsetsMs: number[] = [];
  const lastCur = { x: 40, y: 40 }; // last cursor position, for continuity across navigations

  // Screencast frames: ack every frame so the stream keeps flowing; while `capturing`,
  // write each to disk and record its CDP timestamp (for variable-rate assembly). Writes
  // are serialized to avoid an fd storm.
  const tsArr: number[] = [];
  let frameIdx = 0;
  let capturing = false;
  let firstWall = 0;
  let writeChain: Promise<void> = Promise.resolve();
  client.on("Page.screencastFrame", (e) => {
    const ev = e as unknown as { data: string; sessionId: number; metadata: { timestamp?: number } };
    if (capturing) {
      const i = frameIdx++;
      if (i === 0) firstWall = Date.now();
      // Timestamp by WALL-CLOCK arrival, NOT the CDP metadata clock. Headless rAF
      // throttling compresses the CDP timestamps (~half real time), which made the
      // assembled body ~half the wall-clock length and threw the per-scene cuts (which
      // use wall-clock offsets) out of sync — wrong footage + truncated voiceover.
      tsArr.push(Date.now() / 1000);
      const buf = Buffer.from(ev.data, "base64");
      const out = path.join(framesDir, `f_${String(i).padStart(6, "0")}.jpg`);
      writeChain = writeChain.then(() => fs.writeFile(out, buf));
    }
    client.send("Page.screencastFrameAck", { sessionId: ev.sessionId }).catch(() => {});
  });

  try {
    // ── Pre-roll (untimed, NOT captured): navigate, dismiss consent, settle ──
    await page.goto(scenario.url, { waitUntil: "load", timeout: 60000 }).catch(() => {});
    await sleep(2500); // let delayed cookie/consent banners render before dismissing
    await dismissConsent(page);
    await sleep(800);
    await dismissConsent(page); // second pass in case a banner appeared late
    await sleep(600);

    // ── Start crisp capture, then run the timed body ──
    capturing = true;
    await client.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: Math.round(F.vw * dsf), maxHeight: Math.round(F.vh * dsf), everyNthFrame: 1 });
    for (let w = 0; w < 60 && frameIdx === 0; w++) await sleep(20); // wait for the first frame (anchors the timeline)
    const t0 = firstWall || Date.now();

    // Start the body at the very top so the opening scene always shows the page
    // header/title (and, on calculator pages, the input form right below it).
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    for (const scene of scenario.scenes) {
      const sceneStart = Date.now();
      // Position on the captured timeline (video t=0 = first frame). compose cuts here.
      const srcOffset = sceneStart - t0;
      srcOffsetsMs.push(srcOffset);
      const drift = srcOffset - scene.startMs;
      if (Math.abs(drift) > 600) console.log(`[rec ${fmt}] scene ${scene.id}: timeline drift ${drift > 0 ? "+" : ""}${drift}ms (cutting at the real position)`);
      let bbox: BBox | null = null;

      if (scene.action === "scroll") {
        // URL-tour scroll: smoothly move to a fraction of the page so the section
        // glides into view while the voice describes it.
        const frac = Math.max(0, Math.min(1, parseFloat(scene.value ?? "0.5") || 0.5));
        await page.evaluate((f) => {
          const max = Math.max(0, document.body.scrollHeight - window.innerHeight);
          window.scrollTo({ top: f * max, behavior: "auto" });
        }, frac);
        await sleep(scene.settleMs);
        // Emphasis zoom on flagged scroll scenes: target a prominent element (or centre).
        if (scene.focus) bbox = (await findEmphasisBox(page)) ?? centerBox(F);
      } else if (scene.action === "goto") {
        // Navigate to a new URL when the step provides one (multi-page guided tours);
        // otherwise this is just the opener and the page is already loaded. Either way
        // force the top — some pages auto-scroll to a computed result on load, so we
        // want the title/form in view, not the result.
        const dest = scene.value && /^https?:\/\//i.test(scene.value) ? scene.value : null;
        if (dest) {
          await page.goto(dest, { waitUntil: "load", timeout: 60000 }).catch(() => {});
          await sleep(500);
          // Mid-tour navigations (e.g. glimpsing a live external site) can surface a
          // cookie/consent banner the pre-roll dismissal never saw — and it often appears
          // on a short delay (calculatry's shows at ~900ms). Poll and dismiss for up to
          // ~4s so it never covers the footage. External hosts only; the console has none.
          const external = !/(app:3000|localhost|127\.0\.0\.1)/.test(dest);
          const tries = external ? 8 : 1;
          for (let a = 0; a < tries; a++) {
            if (await dismissConsent(page)) break;
            if (a < tries - 1) await sleep(450);
          }
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" })).catch(() => {});
        // A fresh navigation re-injects the cursor at its default corner; restore it to
        // where it last was so the next glide is continuous instead of a corner teleport.
        if (dest) await placeCursor(page, lastCur.x, lastCur.y);
        await sleep(scene.settleMs);
        if (scene.focus) bbox = (await findEmphasisBox(page)) ?? centerBox(F);
      } else if (scene.action === "key") {
        // Press a key with no target (e.g. Escape) — used to close an open menu/popover
        // so it doesn't linger over the UI or its backdrop swallow the next click. A
        // Base-UI Select/Menu popup left open will time-out the following click (the
        // backdrop intercepts pointer events), which is exactly what silently killed the
        // theme toggle. No cursor move, no zoom for this beat.
        await page.keyboard.press(scene.value || "Escape").catch(() => {});
        await sleep(scene.settleMs);
      } else if (scene.action !== "wait") {
        const requireVisible = scene.action !== "reveal" && scene.action !== "highlight";
        const loc = scene.target ? await resolveLocator(page, scene.target, requireVisible) : null;
        if (loc) {
          // Which element the zoom bbox comes from at the end of the scene. Normally the
          // interacted element; a `revealAfter` click retargets it to the content it opened.
          let bboxSrc = loc;
          try {
            await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
            if (scene.action === "reveal" || scene.action === "highlight") {
              // Scroll the mentioned element to the viewport CENTER for clear visibility
              // (owner's general rule). scrollCenter uses the element's REAL scroll
              // container (the console scrolls an inner <main>; window.scrollTo is a no-op).
              await scrollCenter(loc);
              await sleep(450);
            }
            bbox = await loc.boundingBox();
            if (bbox) {
              const tx = bbox.x + bbox.width / 2, ty = bbox.y + bbox.height / 2;
              await moveCursorTo(page, tx, ty);
              lastCur.x = tx; lastCur.y = ty;
            }

            if (scene.action === "fill") {
              await loc.click({ timeout: 5000 });
              await pulse(page);
              await loc.fill("");
              await loc.pressSequentially(String(scene.value ?? ""), { delay: 90 });
            } else if (scene.action === "select") {
              await pulse(page);
              if (scene.value === "[change]") {
                // Demo interaction: pick a meaningful NON-default option so the result
                // visibly changes. Prefer the highest "(N pts)" option (calculators),
                // else the first option different from the current selection.
                const idx = await loc.evaluate((el) => {
                  const sel = el as HTMLSelectElement;
                  const opts = Array.from(sel.options);
                  let best = -1, bestPts = -1;
                  opts.forEach((o, i) => {
                    const m = (o.textContent || "").match(/\((\d+)\s*pts?\)/i);
                    const p = m ? Number(m[1]) : -1;
                    if (p > bestPts) { bestPts = p; best = i; }
                  });
                  if (best >= 0 && bestPts > 0 && best !== sel.selectedIndex) return best;
                  for (let i = 0; i < opts.length; i++) if (i !== sel.selectedIndex) return i;
                  return sel.selectedIndex;
                });
                await loc.selectOption({ index: idx }).catch(() => {});
              } else {
                try {
                  await loc.selectOption({ label: String(scene.value ?? "") });
                } catch {
                  await loc.selectOption(String(scene.value ?? "")).catch(() => {});
                }
              }
            } else if (scene.action === "click") {
              await loc.click({ timeout: 5000 });
              await pulse(page);
              // revealAfter: the click opened content that renders BELOW the fold (e.g.
              // an Analytics tab whose panel is under the persistent header). Scroll that
              // content to center and glide the cursor to it, EARLY in the beat, so it is
              // visible while the narration describes it (Action↔VO). The zoom then frames
              // the content, not the tab that was clicked.
              if (scene.revealAfter) {
                await sleep(450); // let the panel mount
                const rl = await resolveLocator(page, scene.revealAfter, false);
                if (rl) {
                  await scrollCenter(rl);
                  const rb = await rl.boundingBox().catch(() => null);
                  if (rb) {
                    const tx = rb.x + rb.width / 2, ty = rb.y + rb.height / 2;
                    await moveCursorTo(page, tx, ty);
                    lastCur.x = tx; lastCur.y = ty;
                    bboxSrc = rl;
                  }
                }
              }
            } else {
              // reveal / highlight — draw an attention box around the element
              if (bbox) {
                const b = bbox;
                await page.evaluate(
                  ([x, y, w, h]) => (window as unknown as { __tessFlash?: (a: number, b: number, c: number, d: number) => void }).__tessFlash?.(x, y, w, h),
                  [b.x, b.y, b.width, b.height],
                );
              }
            }
            await sleep(scene.settleMs);
            // Short timeout: after a click that navigates (e.g. an SPA link), this
            // locator is detached and boundingBox would otherwise block for the full
            // default timeout (~30s), wrecking the capture timeline. bboxSrc is the
            // revealAfter content when set, else the interacted element.
            bbox = (await bboxSrc.boundingBox({ timeout: 1200 }).catch(() => null)) ?? bbox;
          } catch {
            /* graceful: keep going, no bbox → no zoom for this scene */
          }
        } else if ((scene.action === "reveal" || scene.action === "highlight") && Number.isFinite(parseFloat(scene.value ?? ""))) {
          // URL-tour content fallback: the named section/tool wasn't found, so scroll
          // to its planned fraction of the page so the tour still moves to that region.
          const frac = Math.max(0, Math.min(1, parseFloat(scene.value!)));
          await page.evaluate((f) => {
            const max = Math.max(0, document.body.scrollHeight - window.innerHeight);
            window.scrollTo({ top: f * max, behavior: "auto" });
          }, frac);
          await sleep(scene.settleMs);
          if (scene.focus) bbox = (await findEmphasisBox(page)) ?? centerBox(F);
        } else {
          console.log(`[rec ${fmt}] scene ${scene.id}: target not found, skipping interaction`);
        }
      }

      // Screenshot a couple of key moments on the primary (desktop) pass.
      if (opts.primary && shots.length < 2 && (scene.id === "result" || scene.action === "reveal" || scene.action === "scroll")) {
        const rel = path.posix.join(opts.shotRelDir, `${opts.jobId}_${scene.id}.png`);
        const abs = path.join(opts.mediaRoot, rel);
        await page.screenshot({ path: abs }).catch(() => {});
        if (await fileExists(abs)) shots.push(rel);
      }

      // Focus scene with no usable zoom target — the locator didn't resolve (e.g. a
      // label that changed) or the element is taller than the viewport, so it can't be
      // a sane zoom center. Fall back to a prominent emphasis box so the zoom ALWAYS has
      // a target and HOLDS for the whole scene, instead of that scene rendering flat.
      if (scene.focus && (!bbox || bbox.height > F.vh * 0.95)) {
        bbox = (await findEmphasisBox(page)) ?? centerBox(F);
      }

      // Diagnostic: where did this scene actually land? (cheap to log; helps confirm
      // the right section is on screen without re-rendering to inspect frames.)
      const scrolledY = await page.evaluate(() => Math.round(window.scrollY)).catch(() => -1);
      console.log(`[rec ${fmt}] scene ${scene.id} (${scene.action}) scrollY=${scrolledY}${bbox ? ` bboxY=${Math.round(bbox.y)}` : ""}`);

      bboxes.push(bbox);

      // Hold the scene to its budgeted duration so every format shares one timeline.
      // If the scene carries extra `clicks` (e.g. the Analytics traffic toggles), fire
      // them spread across the FIRST ~65% of the remaining hold — so several UI changes
      // happen UNDER one continuous narration clip (no per-toggle beat splitting, which
      // sliced the voiceover mid-phrase and clipped words), and the tail (a concluding
      // sentence) plays with the UI at rest.
      const elapsed = Date.now() - sceneStart;
      const remaining = scene.durMs - elapsed;
      if (scene.clicks?.length && remaining > 800) {
        const span = remaining * 0.65;
        const gap = span / scene.clicks.length;
        for (const t of scene.clicks) {
          await sleep(gap * 0.45);
          const cl = await resolveLocator(page, t, true);
          if (cl) {
            const cb = await cl.boundingBox().catch(() => null);
            if (cb) {
              const tx = cb.x + cb.width / 2, ty = cb.y + cb.height / 2;
              await moveCursorTo(page, tx, ty);
              lastCur.x = tx; lastCur.y = ty;
            }
            await cl.click({ timeout: 4000 }).catch(() => {});
            await pulse(page);
          }
          await sleep(gap * 0.55);
        }
        await sleep(Math.max(0, scene.durMs - (Date.now() - sceneStart)));
      } else {
        await sleep(remaining);
      }
    }

    // Tail buffer: keep capturing ~1.2s after the last scene so the footage comfortably
    // overruns the body timeline (the final scene's segment — and its voiceover — is
    // never cut short).
    await sleep(1200);

    capturing = false;
    await client.send("Page.stopScreencast").catch(() => {});
    await writeChain; // flush queued frame writes
    await context.close();
    await browser.close();

    // ── Assemble frames → body video at output res, variable-rate by CDP timestamps ──
    const n = tsArr.length;
    if (n === 0) throw new Error(`screencast produced no frames for ${fmt}`);
    // Screencast only emits a frame when the screen CHANGES, so when the page sits static
    // at the end the capture stops early — and by a DIFFERENT amount per format. That made
    // the three formats end at different times and let `-shortest` clip the voiceover.
    // Fix: hold the last (static) frame until a fixed, format-independent target length =
    // the planned body end + 1.5s, so every format's body is identical and always long
    // enough to carry the full voiceover.
    const plannedEndMs = Math.max(0, ...scenario.scenes.map((s) => s.startMs + s.durMs));
    const targetSpanSec = (plannedEndMs + 1500) / 1000;
    const capturedSpanSec = n > 1 ? tsArr[n - 1] - tsArr[0] : 0;
    const padSec = Math.max(0.1, targetSpanSec - capturedSpanSec); // clone the last frame to reach the fixed target
    const list: string[] = [];
    for (let i = 0; i < n; i++) {
      const dur = i < n - 1 ? Math.max(0.001, tsArr[i + 1] - tsArr[i]) : 0.1;
      list.push(`file '${path.join(framesDir, `f_${String(i).padStart(6, "0")}.jpg`)}'`);
      list.push(`duration ${dur.toFixed(4)}`);
    }
    list.push(`file '${path.join(framesDir, `f_${String(n - 1).padStart(6, "0")}.jpg`)}'`); // repeat last (concat quirk)
    const listPath = path.join(framesDir, "list.txt");
    await fs.writeFile(listPath, list.join("\n"));
    const videoPath = path.join(workDir, `body_${fmt.replace(":", "x")}.mp4`);
    // CFR 30 + tpad clone-hold to a FIXED, format-independent length. (The vfr concat
    // did not reliably honor a last-frame hold, so the 3 formats ended at different
    // times and the VO got clipped. tpad deterministically pads to targetSpan, and CFR
    // makes the downstream per-scene cuts frame-accurate → identical bodies every time.)
    // Grade (showcase/bare only): the CDP frames are full-range JPEG; convert with
    // explicit in_range=full so shadow detail isn't crushed on the yuv420p squeeze, then
    // a gentle lift (gamma/brightness) + a touch of contrast & saturation so the dark
    // theme reads with depth on camera instead of muddy black. Normal demos keep the
    // original path. Slightly higher quality (crf 16) for the portfolio render.
    // Grade: the range fix (in_range=full) is the essential part — it stops the shadow
    // crush on the JPEG→yuv420p squeeze. A mild gamma opens the darks without a global
    // brightness bump (the "less dark" now comes from the lifted capture-mode background,
    // which is targeted and keeps text contrast); contrast/saturation live in compose.
    const vf = opts.grade
      ? `scale=${F.w}:${F.h}:flags=lanczos:in_range=full:out_range=tv,eq=gamma=1.05,fps=30,tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)},format=yuv420p`
      : `scale=${F.w}:${F.h}:flags=lanczos,fps=30,tpad=stop_mode=clone:stop_duration=${padSec.toFixed(3)},format=yuv420p`;
    const gradeArgs = opts.grade
      ? ["-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]
      : [];
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-vf", vf, ...gradeArgs, "-r", "30", "-c:v", "libx264", "-crf", opts.grade ? "16" : "18", "-preset", "veryfast", videoPath]);

    const recDur = await ffprobeDuration(videoPath).catch(() => -1);
    console.log(`[rec ${fmt}] DIAG frames=${n} capturedSpan=${capturedSpanSec.toFixed(1)}s pad=${padSec.toFixed(1)}s targetSpan=${targetSpanSec.toFixed(1)}s recording=${recDur.toFixed(1)}s srcOffsets=[${srcOffsetsMs.map((m) => (m / 1000).toFixed(1)).join(",")}] durMs=[${scenario.scenes.map((s) => (s.durMs / 1000).toFixed(1)).join(",")}]`);

    return { videoPath, offsetMs: 0, bboxes, shots, srcOffsetsMs };
  } catch (e) {
    await browser.close().catch(() => {});
    throw e;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const fs = await import("node:fs/promises");
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
