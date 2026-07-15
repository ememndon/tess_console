// The "format vault" — the ~20 short-form video formats that reliably go viral.
// Each carries WHY it works and a reusable structure template, so the analysis
// layer can map winning videos onto a format and the grid builder can hand the
// creator a ready scaffold (not just a topic). Pure data.

export type VideoFormat = {
  id: string;
  name: string;
  what: string; // one-line description
  whyItWorks: string; // the psychological hook
  template: string; // the reusable structure / beat sheet
  bestFor: string; // when to reach for it
};

export const FORMAT_VAULT: VideoFormat[] = [
  { id: "listicle", name: "Listicle", what: "A numbered rundown ('5 X that…').", whyItWorks: "A clear count promises a finite, skimmable payoff and sets a completion loop.", template: "Hook with the number + payoff → rapid-fire items, one beat each → strongest item last → CTA.", bestFor: "Packing many quick wins into one share-worthy post." },
  { id: "howto", name: "How-To / Tutorial", what: "Step-by-step to a concrete result.", whyItWorks: "High save-rate: people bookmark utility they'll need again.", template: "State the outcome → show steps in order → reveal the finished result → 'try it'.", bestFor: "Demonstrating a tool or a repeatable process." },
  { id: "rapid", name: "Rapid Tutorial", what: "Do the whole thing in under ~30s.", whyItWorks: "Speed is the spectacle; satisfying and re-watchable.", template: "'Watch me do X in 30 seconds' → fast cuts → land the result with a beat of payoff.", bestFor: "A task with a visibly satisfying finish." },
  { id: "myth", name: "Myth-Buster", what: "Corrects a widely-held wrong belief.", whyItWorks: "Pattern interrupt + the dopamine of 'I was doing it wrong'.", template: "'You're doing X wrong' → the common belief → why it's false → the right way → CTA.", bestFor: "Topics riddled with bad advice." },
  { id: "problem_solution", name: "Problem → Solution", what: "Name a pain, then resolve it.", whyItWorks: "Opens an open loop on a felt frustration the viewer wants closed.", template: "Dramatize the pain → agitate briefly → reveal the fix → show it working.", bestFor: "A feature that removes a specific annoyance." },
  { id: "case_study", name: "Case Study / Result", what: "'I did X, here's what happened.'", whyItWorks: "Proof and story; specific numbers earn trust.", template: "Tease the result → the setup → what you did → the (verified) outcome → the lesson.", bestFor: "Showing real outcomes without giving advice." },
  { id: "day_in_life", name: "Day In The Life", what: "A real day/workflow montage.", whyItWorks: "Relatable, aspirational, parasocial; high completion.", template: "Timestamped beats → one genuine struggle → resolve → soft brand moment.", bestFor: "Humanizing the brand or a use-case in context." },
  { id: "storytime", name: "Story Time", what: "A short narrative with a turn.", whyItWorks: "Story keeps attention to the payoff; built-in retention.", template: "Cold-open with the stakes → escalate → twist → takeaway.", bestFor: "Lessons that land better as a story than a list." },
  { id: "tier_list", name: "Tier List / Ranking", what: "Rank options S→F.", whyItWorks: "Opinion invites debate in the comments (engagement engine).", template: "Show the field → rank with a reason each → defend the spicy pick → ask 'agree?'.", bestFor: "Categories people have strong opinions about." },
  { id: "comparison", name: "This vs That", what: "Head-to-head comparison.", whyItWorks: "Decision-stage viewers searching 'X or Y' convert.", template: "Frame the choice → criteria → score each → verdict + 'who it's for'.", bestFor: "Helping the audience choose between options." },
  { id: "hypothetical", name: "What Would Happen If…", what: "A curiosity-driven hypothetical.", whyItWorks: "Pure curiosity gap; the question alone earns the click.", template: "Pose the 'what if' → reason/simulate → reveal the surprising answer.", bestFor: "Making a dry topic feel like an experiment." },
  { id: "hot_take", name: "Hot Take / Contrarian", what: "A bold, against-the-grain opinion.", whyItWorks: "Controversy + identity; people share to signal agreement.", template: "State the take plainly → the mainstream view → your evidence → stand your ground.", bestFor: "Cutting through a saturated topic with a fresh angle." },
  { id: "spotlight", name: "Tool / Product Spotlight", what: "Show one feature and its payoff.", whyItWorks: "Demonstrated value beats described value.", template: "The problem it kills → live demo → the 'wow' moment → where to get it.", bestFor: "Driving trial of a specific feature." },
  { id: "mistakes", name: "Stop Doing This", what: "Common mistakes to avoid.", whyItWorks: "Loss-aversion: people fear doing it wrong more than missing a win.", template: "'Stop doing X' → the mistake → the cost → the fix.", bestFor: "Reframing a how-to as a warning." },
  { id: "explainer", name: "Explainer (ELI5)", what: "Make something complex simple.", whyItWorks: "Clarity is shareable; 'finally someone explained it'.", template: "The confusing thing → a plain analogy → the simple model → why it matters.", bestFor: "Jargon-heavy topics (finance, tech)." },
  { id: "bts", name: "Behind The Scenes", what: "Build-in-public / process reveal.", whyItWorks: "Authenticity and curiosity; insider access feels exclusive.", template: "What you're building → the messy middle → a real decision → the reveal.", bestFor: "Trust-building and founder-led brands." },
  { id: "qa", name: "Q&A / Answer a Comment", what: "Reply to a real question on camera.", whyItWorks: "Algorithm loves comment-driven content; signals community.", template: "Read the question → quick credible answer → one extra tip → invite more.", bestFor: "Turning audience questions into a content engine." },
  { id: "trendjack", name: "Trend-Jack / Format Remix", what: "Apply a trending format/sound to your niche.", whyItWorks: "Rides existing reach; familiar format lowers friction.", template: "Adopt the trending beat → swap in your niche's substance → keep it native.", bestFor: "Catching a wave while it's hot." },
  { id: "transformation", name: "Before & After", what: "Show a transformation.", whyItWorks: "Visual contrast is instantly legible and satisfying.", template: "Show 'before' → the intervention → reveal 'after' → how to get there.", bestFor: "Anything with a visible improvement." },
  { id: "challenge", name: "Challenge / Experiment", what: "Attempt something with a constraint.", whyItWorks: "Stakes + a clock create suspense to the payoff.", template: "Set the challenge + rules → attempt with tension → result → reflection.", bestFor: "Making a routine topic feel like an event." },
  { id: "mini_doc", name: "Mini-Documentary", what: "A tight, narrated deep-dive.", whyItWorks: "Depth signals authority; high watch-time rewards reach.", template: "Bold thesis → 3 evidence beats with visuals → a 'so what' conclusion.", bestFor: "Establishing expertise on a meaty subtopic." },
];

export const FORMAT_VAULT_BRIEF = FORMAT_VAULT.map((f) => `${f.id}: ${f.name} — ${f.what}`).join("\n");
export const formatById = (id: string): VideoFormat | undefined => FORMAT_VAULT.find((f) => f.id === id);

// Natural medium per format (used to auto-assign image vs video in the 30-day
// grid). Motion/demo formats → video; graphic-friendly formats → image. Never text.
const VIDEO_FORMATS = new Set(["howto", "rapid", "day_in_life", "storytime", "hypothetical", "spotlight", "explainer", "bts", "trendjack", "challenge", "mini_doc"]);
export function formatKind(formatId: string): "image" | "video" {
  return VIDEO_FORMATS.has(formatId) ? "video" : "image";
}
