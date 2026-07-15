// Tess Console brand mark — the official stacked-layers logo (public/logo.png,
// transparent so it reads on any background). Size it with className (e.g. "size-6").
export function BrandMark({ className }: { className?: string }) {
  // The logo is portrait; object-contain inside the (often square) sizing box keeps its
  // aspect ratio instead of squishing it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.png" alt="Tess Console" className={`object-contain ${className ?? ""}`} draggable={false} />;
}
