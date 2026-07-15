// Tess's profile photo — her face wherever she appears in the console (the
// Overview greeting, the Agent page header + activity feed, the chat panel).
// Source is square (1024×1024); rendered rounded with object-cover. Size it
// with className, e.g. "size-8".
export function TessAvatar({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src="/Tess_Agent.png"
      alt="Tess"
      className={`rounded-full object-cover ${className ?? ""}`}
      draggable={false}
    />
  );
}
