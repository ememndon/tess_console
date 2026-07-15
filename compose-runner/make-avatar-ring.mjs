import { chromium } from "/app/node_modules/playwright/index.mjs";
import fs from "node:fs";
const FACE=fs.readFileSync("/tmp/face.b64","utf8");
const D=400;
const html=`<style>*{margin:0}body{background:transparent}
 .ring{width:${D}px;height:${D}px;border-radius:50%;padding:6px;box-sizing:border-box;
  background:conic-gradient(from 210deg,#ff6300,#ff8a3d,#e164ff,#7c3aed,#ff6300)}
 .ring img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;border:8px solid #07060e}</style>
 <div class="ring"><img src="data:image/png;base64,${FACE}"/></div>`;
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:D,height:D},deviceScaleFactor:1});
const p=await c.newPage();
await p.setContent(html); await p.waitForTimeout(200);
await p.screenshot({path:"/tmp/avatar-ring.png",omitBackground:true});
console.log("ok"); await b.close();
