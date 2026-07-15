// Render one transparent caption PNG per cue, in the console's real Inter webfont, at the
// approved "clean" style (60% scale => 26px at 1080p). Reads cues.json (from
// `run.py --dump-cues`), writes cNNN.png. Runs inside tess-media (Playwright + console).
//   node caption-pngs.mjs <cues.json> <outDir> <height>
import { chromium } from "/app/node_modules/playwright/index.mjs";
import fs from "node:fs";

const APP = process.env.APP_URL, KEY = process.env.INTERNAL_SYNC_KEY;
const [cuesPath, outDir, heightArg] = process.argv.slice(2);
const H = Number(heightArg || 1080), W = Math.round(H * 16 / 9), k = H / 1080;
const cues = JSON.parse(fs.readFileSync(cuesPath, "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const css = `*{box-sizing:border-box;margin:0;padding:0}
 #cap{position:fixed;inset:0;pointer-events:none;
   font-family:var(--font-inter),Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
 .stack{position:absolute;left:50%;bottom:${Math.round((96 * 0.6 + 48) * k)}px;transform:translateX(-50%);
   display:flex;flex-direction:column;align-items:center;max-width:${Math.round(1400 * 0.6 * k)}px;text-align:center}
 .row{background:rgba(6,5,14,.82);border:1px solid rgba(255,255,255,.08);
   border-radius:${12 * 0.6 * k}px;padding:${10 * 0.6 * k}px ${26 * 0.6 * k}px}
 .row span{font-size:${44 * 0.6 * k}px;font-weight:600;letter-spacing:-.015em;color:#fff;line-height:1.32}`;

const s = await (await fetch(`${APP}/api/internal/capture-session`, { method: "POST", headers: { "x-internal-key": KEY } })).json();
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: "dark" });
await c.addCookies([{ name: s.cookieName, value: s.token, url: APP }]);
const p = await c.newPage();
await p.goto(`${APP}/`, { waitUntil: "networkidle" });
await p.waitForTimeout(1000);
await p.evaluate((cssText) => {
  document.documentElement.style.background = "transparent"; document.body.style.background = "transparent";
  for (const e of Array.from(document.body.children)) e.style.visibility = "hidden";
  const st = document.createElement("style"); st.textContent = cssText; document.head.append(st);
  const d = document.createElement("div"); d.id = "cap";
  d.innerHTML = '<div class="stack"><div class="row"><span id="cap-t"></span></div></div>';
  document.body.append(d);
}, css);
for (let i = 0; i < cues.length; i++) {
  await p.evaluate((t) => { document.getElementById("cap-t").textContent = t; }, cues[i].text);
  await p.waitForTimeout(50);
  await p.screenshot({ path: `${outDir}/c${String(i).padStart(3, "0")}.png`, omitBackground: true });
}
fs.copyFileSync(cuesPath, `${outDir}/cues.json`);
console.log(`rendered ${cues.length} caption PNGs @ ${W}x${H}`);
await b.close();
