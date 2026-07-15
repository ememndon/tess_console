import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// Vibrant gradient stat tile (Pulse-style): a solid color box with white text and a
// soft circle accent, used for the summary counters at the top of console pages. Cycle
// TILE_COLORS by index so a row of tiles comes alive with different colors.
// Three-stop jewel gradients: bright → saturated mid → deep dark for a premium depth.
const GRADIENTS = {
  violet: "from-violet-500 via-fuchsia-700 to-purple-900",
  orange: "from-amber-400 via-orange-600 to-red-900",
  emerald: "from-emerald-400 via-teal-600 to-teal-900",
  cyan: "from-sky-400 via-cyan-600 to-blue-900",
  pink: "from-fuchsia-400 via-pink-600 to-rose-900",
  blue: "from-blue-500 via-indigo-700 to-blue-950",
  amber: "from-yellow-400 via-amber-600 to-orange-900",
  rose: "from-rose-400 via-pink-700 to-fuchsia-900",
} as const;

export type TileColor = keyof typeof GRADIENTS;
export const TILE_COLORS: TileColor[] = ["violet", "orange", "emerald", "cyan", "pink", "blue"];
export const tileGradientClass = (color: TileColor): string => GRADIENTS[color];

// A radiant glow in each tile's own hue, so the counter strips match the Site
// Overview KPI tiles instead of a flat grey drop shadow.
const TILE_GLOW: Record<TileColor, string> = {
  violet: "#8b5cf6", orange: "#f97316", emerald: "#10c98a", cyan: "#06b6d4",
  pink: "#ec4899", blue: "#3b82f6", amber: "#f59e0b", rose: "#fb7185",
};
// The hex for a tile's glow, and a ready-to-use box-shadow string so every gradient
// counter tile (the shared StatTile + the per-page local tiles) glows identically.
export const tileGlow = (color: TileColor = "violet"): string => TILE_GLOW[color] ?? TILE_GLOW.violet;
export const tileGlowShadow = (color: TileColor = "violet"): string => `0 10px 30px -10px ${tileGlow(color)}`;

export function StatTile({
  icon: Icon,
  label,
  value,
  color = "violet",
  hint,
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  color?: TileColor;
  hint?: ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${GRADIENTS[color]} p-4 text-white ring-1 ring-white/10`} style={{ boxShadow: `0 10px 30px -10px ${TILE_GLOW[color]}` }}>
      <div aria-hidden className="pointer-events-none absolute -right-5 -top-7 size-24 rounded-full bg-white/20" />
      <div aria-hidden className="pointer-events-none absolute right-7 top-7 size-12 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -left-3 bottom-0 size-14 rounded-full bg-black/12" />
      <span className="relative flex items-center gap-1.5 text-xs font-medium text-white/90">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </span>
      <div className="relative mt-1.5 text-2xl font-bold tabular-nums">{value}</div>
      {hint ? <div className="relative mt-0.5 text-[11px] font-medium text-white/80">{hint}</div> : null}
    </div>
  );
}
