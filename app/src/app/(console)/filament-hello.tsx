"use client";

import { useEffect, useState } from "react";

// Cinematic greeting for the Filament Overview. Time-of-day comes from the admin's
// own browser clock (correct regardless of server/UTC); empty on first paint so the
// local-time read never trips a hydration mismatch.
function greet(h: number): string {
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Still up";
}

export function FilamentHello({ name }: { name: string }) {
  const [word, setWord] = useState("");
  useEffect(() => setWord(greet(new Date().getHours())), []);
  return (
    <h1 className="min-h-[26px] text-[22px] font-semibold tracking-tight text-white">
      {word ? `${word}, ${name}.` : " "}
    </h1>
  );
}
