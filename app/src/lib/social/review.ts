// Pre-publish quality guard for generated social posts. Pure (no deps) so it can
// run at generation time (to flag drafts) and at publish time (to hold a hard-
// broken post back). Soft flags surface in Social Studio for review; hard flags
// (ok=false) block auto-publish.
export type Review = { ok: boolean; flags: string[] };

// Words that can't legitimately END a complete thought. Copy ending on one of
// these is almost certainly truncated ("...make sense of", "...seekers in").
// Deliberately NOT terminal punctuation: good ad copy often has no end period.
const DANGLING = new Set([
  "a", "an", "the", "and", "or", "but", "so", "to", "of", "in", "on", "at", "for", "with",
  "from", "by", "as", "is", "are", "was", "were", "be", "been", "being", "that", "this",
  "these", "those", "your", "you", "our", "my", "we", "it", "its", "their", "his", "her",
  "if", "when", "while", "into", "about", "over", "under", "than", "then", "because",
  "can", "will", "would", "could", "should", "may", "might", "must", "do", "does", "did",
  "via", "per", "vs", "between", "without", "within", "upon",
]);

// True when a line looks cut off: ends on dangling connector punctuation, on a
// connector/preposition/article word, or on a stray single-letter fragment.
function looksTruncated(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/[,;:–—-]$/.test(t)) return true;
  const last = (t.split(/\s+/).pop() ?? "").toLowerCase().replace(/[^a-z']/g, "");
  if (!last) return false;
  if (last.length === 1 && last !== "a" && last !== "i") return true;
  return DANGLING.has(last);
}

export function reviewPost(input: {
  caption: string; // the caption WITHOUT the appended URL
  headline?: string;
  subhead?: string;
  image: string; // outcome: "ai" | "stock" | "banner" | "none"
  numericOk: boolean; // from the numeric guard (no invented figures)
}): Review {
  const flags: string[] = [];
  let hard = false;

  const caption = input.caption.trim();
  if (!caption) {
    flags.push("empty caption");
    hard = true;
  } else if (looksTruncated(caption)) {
    flags.push("caption looks cut off");
  }

  if (input.headline !== undefined && !input.headline.trim()) {
    flags.push("empty headline");
    hard = true;
  }
  if (input.subhead && looksTruncated(input.subhead)) {
    flags.push("subhead looks cut off");
  }

  if (!input.numericOk) flags.push("uses numbers not in the source data");

  if (input.image === "none") {
    flags.push("no image was rendered");
    hard = true;
  }

  return { ok: !hard, flags };
}
