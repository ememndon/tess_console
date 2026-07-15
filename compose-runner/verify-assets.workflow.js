export const meta = {
  name: 'verify-showcase-assets',
  description: 'Adversarially verify all 18 sections of staged 4K assets before renting a GPU',
  whenToUse: 'After staging captions/cards/arch, as the go/no-go gate before the billed GPU pass',
  phases: [
    { title: 'Verify', detail: 'independent lenses hunt for defects in the staged assets' },
    { title: 'Synthesize', detail: 'one gate: GO / NO-GO with per-section status' },
  ],
}

// args = { facts: {<sec>: {...}}, beatCounts: {<sec>: n} }
const facts = args.facts
const beatCounts = args.beatCounts
const factsStr = JSON.stringify(facts, null, 1)
const beatStr = JSON.stringify(beatCounts)

const FINDINGS = {
  type: 'object',
  required: ['lens', 'blockers', 'warnings', 'sectionsChecked'],
  properties: {
    lens: { type: 'string' },
    sectionsChecked: { type: 'integer' },
    blockers: { type: 'array', items: { type: 'object', required: ['section', 'detail'],
      properties: { section: { type: 'integer' }, detail: { type: 'string' } } } },
    warnings: { type: 'array', items: { type: 'object', required: ['section', 'detail'],
      properties: { section: { type: 'integer' }, detail: { type: 'string' } } } },
  },
}

const COMMON = `You are verifying staged 4K video overlay assets before a paid GPU render. Be
adversarial: assume something is wrong and try to prove it. Default an item to a BLOCKER if
you cannot confirm it is correct. Every value below is machine-collected ground truth.

FACTS (per section):
${factsStr}

Field meanings:
- body: dimensions of the 4K capture mezzanine — MUST be 3840x2160.
- sceneCount / srcOffsetsLen: must be equal (one cut offset per scene).
- cuesCount: number of caption cues built from the bundle's word timings.
- pngCount: number of caption PNGs actually rendered — MUST equal cuesCount.
- captionSample.{first,mid,last}: {w,h,pix} of sampled caption PNGs — MUST be 3840x2160 and
  an alpha pixel format (rgba / *a* — transparent).
- firstCueStart / lastCueEnd: caption timeline bounds in seconds.
- totalSec: the section's composed duration.
- cuesMonotonic: caption starts non-decreasing.
- cueOverEnd: true if the last caption ends after the section does (a BUG).
- silentScenes: scenes with no narration (clicks/waits) — these correctly produce no captions,
  so cuesCount < (words) is fine; do NOT flag silent scenes as missing captions.`

const LENSES = [
  { key: 'dims', prompt: `${COMMON}

YOUR LENS: dimensions & transparency. For every section confirm body is 3840x2160, and every
captionSample entry is 3840x2160 with an alpha pixel format. Any None sample, wrong dimension,
or non-alpha pix_fmt is a blocker.` },
  { key: 'counts', prompt: `${COMMON}

YOUR LENS: count integrity. For every section confirm pngCount == cuesCount (else caption PNGs
are missing or extra) and sceneCount == srcOffsetsLen. Also cross-check sceneCount against the
EXPECTED beat-map scene counts below — a mismatch means the wrong bundle was staged:
${beatStr}` },
  { key: 'timing', prompt: `${COMMON}

YOUR LENS: caption timing. For every section: cuesMonotonic must be true; cueOverEnd must be
false; firstCueStart should be >= 0 and small (< ~4s); lastCueEnd must be <= totalSec. Flag any
section whose caption cadence looks implausible for its duration (e.g. cuesCount far too low or
high for totalSec). A section with cuesCount 0 but non-silent scenes is a blocker.` },
  { key: 's18', prompt: `${COMMON}

YOUR LENS: section 18 extras ONLY. In facts["18"], confirm: card_A and card_B are 3840x2160
with an alpha pix_fmt; arch is present, 3840x2160, alpha pix_fmt, and its dur is ~34.4s (the
architecture animation spans s05+s06). Missing/None arch or cards, wrong size, non-alpha, or a
duration off by more than ~1s is a blocker. Only report on section 18.` },
]

phase('Verify')
const lensResults = await parallel(LENSES.map((l) => () =>
  agent(l.prompt, { label: `lens:${l.key}`, phase: 'Verify', schema: FINDINGS, effort: 'high' })
))

// Visual spot-check: actually LOOK at sampled pixels (numbers can't catch a blank/corrupt render).
const visual = await agent(
  `Visually spot-check staged assets. Run these to pull samples out of the container, then Read
each image and confirm it renders correctly (not blank, not corrupt, text legible, alpha correct):

  docker exec tess-media sh -c 'D=/app/media/showcase-stage; \\
    cp "$D/section-04/captions-4k/$(ls $D/section-04/captions-4k | sed -n 20p)" /tmp/vchk-cap04.png; \\
    cp "$D/section-16/captions-4k/$(ls $D/section-16/captions-4k | sed -n 30p)" /tmp/vchk-cap16.png; \\
    cp "$D/section-18/card-A-4k.png" /tmp/vchk-cardA.png; \\
    cp "$D/section-18/card-B-4k.png" /tmp/vchk-cardB.png; \\
    ffmpeg -y -v error -ss 12 -i "$D/section-18/arch-4k.mov" -frames:v 1 /tmp/vchk-arch.png'
  for f in vchk-cap04 vchk-cap16 vchk-cardA vchk-cardB vchk-arch; do docker cp tess-media:/tmp/$f.png /tmp/$f.png; done

Then Read each /tmp/vchk-*.png. A caption PNG should show one dark rounded pill with white Inter
text on a transparent field. cardA/cardB should show the full contact card (name, four rows incl.
GitHub, portrait). arch should show the "Five systems" graphic with capability cards. Report what
you actually see; flag anything blank, corrupt, wrong-text, or missing alpha.`,
  { label: 'visual-spotcheck', phase: 'Verify',
    schema: { type: 'object', required: ['samples', 'anomalies'], properties: {
      samples: { type: 'array', items: { type: 'object', required: ['file', 'ok', 'sawText'],
        properties: { file: { type: 'string' }, ok: { type: 'boolean' }, sawText: { type: 'string' } } } },
      anomalies: { type: 'array', items: { type: 'string' } } } },
    effort: 'high' })

phase('Synthesize')
const gate = await agent(
  `You are the go/no-go gate before a PAID GPU render of an 18-section showcase video. Below are
adversarial verification findings from independent lenses plus a visual spot-check. Produce a
single verdict. GO only if there are zero blockers across all lenses AND the visual check saw no
corruption. List every blocker (must-fix before renting) and every warning (proceed but note).
Give a one-line status per section 1..18. Flag anything that needs a human decision.

LENS FINDINGS:
${JSON.stringify(lensResults.filter(Boolean), null, 1)}

VISUAL SPOT-CHECK:
${JSON.stringify(visual, null, 1)}`,
  { label: 'go-no-go', phase: 'Synthesize', effort: 'high', schema: {
    type: 'object', required: ['verdict', 'blockers', 'warnings', 'perSection'],
    properties: {
      verdict: { type: 'string', enum: ['GO', 'NO-GO'] },
      blockers: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      perSection: { type: 'array', items: { type: 'object', required: ['section', 'ok', 'note'],
        properties: { section: { type: 'integer' }, ok: { type: 'boolean' }, note: { type: 'string' } } } },
      humanDecisions: { type: 'array', items: { type: 'string' } },
    } } })

return { gate, lensResults: lensResults.filter(Boolean), visual }
