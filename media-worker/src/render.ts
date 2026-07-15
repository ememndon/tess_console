import path from "node:path";
import fs from "node:fs/promises";
import { CFG, FORMATS, BRAND, TIMING, speakable, type FormatKey } from "./config.js";
import type { MediaJob, MediaOut, TimedScene } from "./types.js";
import { synthesizeBatch, synthesizeOneTake, type TtsResult } from "./tts.js";
import { buildBodyVo, resolveMusic } from "./audio.js";
import { genSlide } from "./slides.js";
import { renderRemotionSlide } from "./remotion-render.js";
import { recordFormat } from "./recorder.js";
import { captureSession } from "./api.js";
import { composeFormat } from "./compose.js";
import { renderBRoll, brollDurMs } from "./broll.js";
import { writeCaptureBundle } from "./bundle.js";

const VALID = Object.keys(FORMATS) as FormatKey[];
const log = (m: string) => console.log(`${new Date().toISOString()} [render] ${m}`);

// Render one demo job end-to-end → the media list to hand back to the app.
export async function renderJob(job: MediaJob): Promise<{ media: MediaOut[]; caption: string; durationSec: number }> {
  const sc = job.scenario;
  const voice = job.voice || CFG.voiceDefault;
  const brand = BRAND[job.site] ?? BRAND.calculatry;
  const workDir = path.join("/tmp/tess-media", job.id);
  const audioDir = path.join(workDir, "audio");
  await fs.mkdir(audioDir, { recursive: true });
  await fs.mkdir(path.join(CFG.mediaRoot, "videos", job.site), { recursive: true });

  // 1) Voiceover — synthesize intro, every scene and outro in ONE batch (Kokoro
  // loads its model once per batch).
  log(`job ${job.id} (${job.site}/${sc.recipeId}) — synthesizing voiceover (${voice})`);
  const bRoll = sc.bRoll ?? [];
  // VO text is run through speakable() for correct brand pronunciation; the captions
  // (built in compose from the original scene.say) keep the real spelling.
  const say = (t: string) => speakable(job.site, t);
  const items = [
    { id: "intro", text: say(sc.intro.say) },
    ...sc.scenes.map((s, i) => ({ id: `sc_${i}`, text: say(s.say) })),
    ...bRoll.map((b) => ({ id: b.id, text: say(b.say) })),
    { id: "outro", text: say(sc.outro.say) },
  ];
  // Showcase (bare) + ElevenLabs: synthesize the whole section as ONE continuous take,
  // then slice it per-beat, so volume/expressiveness stay consistent across beats (esp.
  // at the low-stability, expressive showcase settings). Everything else keeps the
  // per-line batch (with its VO cache). One-take falls back to the batch on any mismatch.
  const useOneTake = !!sc.bare && voice.startsWith("eleven:");
  const voMap = useOneTake
    ? await synthesizeOneTake(voice, items, audioDir, { ttsKey: job.ttsKey, style: sc.delivery, voiceSettings: sc.voiceSettings })
    : await synthesizeBatch(voice, items, audioDir, { ttsKey: job.ttsKey, style: sc.delivery, voiceSettings: sc.voiceSettings });
  const silent: TtsResult = { path: "", durMs: 0 };
  const introVo = voMap.get("intro") ?? silent;
  const outroVo = voMap.get("outro") ?? silent;

  const timed: TimedScene[] = [];
  let cumulative = 0;
  let scrollIdx = 0;
  for (let i = 0; i < sc.scenes.length; i++) {
    const s = sc.scenes[i];
    const settleMs = Number.isFinite(s.settleMs) ? s.settleMs : 600;
    const vo = voMap.get(`sc_${i}`) ?? silent;
    const voDurMs = Number.isFinite(vo.durMs) ? vo.durMs : 0;
    // The LAST scene gets an extra tail so its narration ALWAYS finishes (plus the
    // body→outro cross-dissolve overlap) before we cut away — fixes the recurring
    // "last words clipped at the jump to the outro" issue.
    const isLast = i === sc.scenes.length - 1;
    const durMs =
      Math.max(
        voDurMs + TIMING.prePadMs + TIMING.postPadMs,
        TIMING.actionMinMs + settleMs,
        TIMING.minSceneMs,
      ) + (isLast ? 900 : 0);
    // Emphasis zoom: gently push into a feature on every other scroll scene so the tour
    // isn't static (the recorder finds the prominent element; compose does the push-in).
    // Interaction scenes keep their own focus flag. SHOWCASE (bare) tours have a curated
    // beat map where focus is set intentionally per scene, so we respect it literally and
    // do NOT auto-focus scroll scenes — otherwise a short scroll beat zooms to a random
    // spot (e.g. the header) and flashes. The override stays on for public URL tours.
    let focus = s.focus;
    if (!sc.bare && s.action === "scroll") {
      focus = scrollIdx % 2 === 0;
      scrollIdx++;
    }
    const need = voDurMs + TIMING.prePadMs + TIMING.postPadMs;
    console.log(`[render] scene ${s.id}: voDur=${voDurMs}ms budget=${durMs}ms${need > durMs ? ` ⚠ VO EXCEEDS BUDGET by ${need - durMs}ms` : ""}`);
    timed.push({ ...s, focus, settleMs, startMs: cumulative, durMs, voPath: vo.path || undefined, voDurMs, voWords: vo.words });
    cumulative += durMs;
  }
  const totalBodyMs = cumulative;

  // 2) Body VO track + music bed.
  const bodyVoPath = path.join(audioDir, "bodyVo.wav");
  await buildBodyVo(timed, totalBodyMs, bodyVoPath);

  // Bare mode (console-showcase sections): body only — no slides, no music.
  const bare = !!sc.bare;
  const introDurMs = Math.max(introVo.durMs + 800, 2600);
  // Hold the outro ~11s so viewers can read + remember the site URL (owner request),
  // while still fitting a longer outro VO if there is one.
  const outroDurMs = Math.max(outroVo.durMs + 1500, 11000);
  const brollTotalMs = bRoll.reduce((sum, b) => sum + brollDurMs((voMap.get(b.id) ?? silent).durMs), 0);
  const grandMs = bare ? totalBodyMs : introDurMs + brollTotalMs + totalBodyMs + outroDurMs;

  const musicPath = bare ? "" : await resolveMusic(job.music || "auto", grandMs / 1000, path.join(workDir, "music.wav"));

  // 3) Per format: slides → record → compose.
  const formats = (job.formats?.length ? job.formats : VALID).filter((f): f is FormatKey => VALID.includes(f as FormatKey));
  const primary: FormatKey = formats.includes("16:9") ? "16:9" : formats[0];

  const media: MediaOut[] = [];
  let shots: string[] = [];

  for (const fmt of formats) {
    log(`job ${job.id} — format ${fmt}: slides`);
    const introPath = path.join(workDir, `intro_${fmt.replace(":", "x")}.mp4`);
    const outroPath = path.join(workDir, `outro_${fmt.replace(":", "x")}.mp4`);
    // Remotion-composed brand intro/outro (per-site bespoke motion graphics); fall
    // back to the ffmpeg slide only if a render fails. Bare mode ships body-only,
    // so the slides are skipped entirely.
    if (!bare) {
      try {
        await renderRemotionSlide("intro", job.site, fmt, brand, { title: sc.feature, voPath: introVo.path || undefined, durMs: introDurMs }, workDir, introPath);
        await renderRemotionSlide("outro", job.site, fmt, brand, { voPath: outroVo.path || undefined, durMs: outroDurMs }, workDir, outroPath);
      } catch (e) {
        log(`remotion slide failed (${e instanceof Error ? e.message : e}); using ffmpeg slide`);
        await genSlide("intro", fmt, brand, { title: sc.intro.title, voPath: introVo.path || undefined, durMs: introDurMs }, workDir, introPath);
        await genSlide("outro", fmt, brand, { voPath: outroVo.path || undefined, durMs: outroDurMs }, workDir, outroPath);
      }
    }

    log(`job ${job.id} — format ${fmt}: recording`);
    // Console showcase tours film behind auth: mint a fresh short-lived session
    // per format (cheap; a long tour can outlive a single recording's start).
    const cookies = sc.consoleAuth
      ? await captureSession().then((s) => [{ name: s.cookieName, value: s.token }])
      : undefined;
    const recording = await recordFormat({ url: sc.url, scenes: timed }, fmt, workDir, {
      primary: fmt === primary,
      mediaRoot: CFG.mediaRoot,
      shotRelDir: path.posix.join("videos", job.site),
      jobId: job.id,
      cookies,
      grade: bare, // showcase renders get the brightness/color grade
      noRedact: sc.noRedact, // Inbox/Outreach sections: lift PII blur for fake sample data
      panelCollapsed: sc.panelCollapsed, // content-heavy sections: collapse the chat panel for a wider view
    });
    if (recording.shots.length) shots = recording.shots;

    // Capture-only: the VPS half of the capture→GPU-compose split. Stop at the
    // near-lossless 4K mezzanine + metadata bundle; the compose-runner finishes the
    // heavy zoompan/composite/final-encode elsewhere (NVENC on a rented GPU). This
    // implies bare, so there is no B-roll or compose to run for this section here.
    if (sc.captureOnly) {
      const { relDir } = await writeCaptureBundle({
        mediaRoot: CFG.mediaRoot,
        site: job.site,
        jobId: job.id,
        fmt,
        recording,
        scenes: timed,
        bodyVoPath,
        bare,
      });
      media.push({ type: "video", path: path.posix.join(relDir, "body.mp4"), width: FORMATS[fmt].w, height: FORMATS[fmt].h });
      log(`job ${job.id} — format ${fmt}: capture-only bundle at ${relDir} (compose deferred to GPU)`);
      continue;
    }

    // Stock B-roll clips for this format (skipped individually on failure so a bad
    // clip never sinks the render).
    const preBodyClips: string[] = [];
    const postBodyClips: string[] = [];
    for (const b of bRoll) {
      const bvo = voMap.get(b.id) ?? silent;
      const clipPath = path.join(workDir, `broll_${b.id}_${fmt.replace(":", "x")}.mp4`);
      try {
        await renderBRoll(b, fmt, brand, { voPath: bvo.path || undefined, voDurMs: bvo.durMs }, workDir, clipPath);
        (b.place === "beforeOutro" ? postBodyClips : preBodyClips).push(clipPath);
      } catch (e) {
        log(`broll ${b.id} (${fmt}) failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    log(`job ${job.id} — format ${fmt}: compose`);
    const outRel = path.posix.join("videos", job.site, `${job.id}_${fmt.replace(":", "x")}.mp4`);
    const outAbs = path.join(CFG.mediaRoot, outRel);
    const { width, height } = await composeFormat({
      fmt,
      recording,
      scenes: timed,
      bodyVoPath,
      musicPath,
      introPath,
      outroPath,
      preBodyClips,
      postBodyClips,
      workDir,
      outAbs,
      bare,
    });
    media.push({ type: "video", path: outRel, width, height });
  }

  for (const rel of shots) media.push({ type: "image", path: rel });

  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});

  return { media, caption: sc.caption, durationSec: Math.round(grandMs / 1000) };
}
